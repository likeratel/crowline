use super::*;
use crate::{
    cli::CliInvocation,
    models::{ActivityPage, TargetHistory},
    providers::catalog,
};
use futures::{stream, StreamExt};

const ACCOUNT_CONCURRENCY: usize = 3;
const TARGET_CONCURRENCY: usize = 2;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_HISTORY_ACTIVITIES: usize = 10_000;

impl AppState {
    pub async fn refresh<P: SnapshotPublisher + Sync>(&self, publisher: &P) -> Snapshot {
        let Ok(_guard) = self.refresh_lock.try_lock() else {
            return self.snapshot().await;
        };
        loop {
            let (settings, revision, epoch) = {
                let _publish = self.publish_lock.lock().await;
                let current = self.snapshot().await;
                let revision = self.settings_revision.load(Ordering::SeqCst);
                let epoch = self.refresh_epoch.fetch_add(1, Ordering::SeqCst) + 1;
                let next = Snapshot {
                    refreshing: true,
                    history: Vec::new(),
                    pending_targets: current.settings.targets.iter().map(Target::key).collect(),
                    ..current
                };
                let settings = next.settings.clone();
                self.emit(next, publisher).await;
                (settings, revision, epoch)
            };
            stream::iter(settings.accounts.clone())
                .map(|account| {
                    let settings = &settings;
                    async move {
                        self.refresh_account(&account, settings, revision, epoch, publisher)
                            .await
                    }
                })
                .buffer_unordered(ACCOUNT_CONCURRENCY)
                .collect::<Vec<_>>()
                .await;
            let _publish = self.publish_lock.lock().await;
            if !self.current_generation(revision, epoch) {
                continue;
            }
            let current = self.snapshot().await;
            let done = Snapshot {
                refreshing: false,
                pending_targets: Vec::new(),
                ..current
            };
            self.emit(done.clone(), publisher).await;
            return done;
        }
    }

    async fn emit<P: SnapshotPublisher>(&self, snapshot: Snapshot, publisher: &P) {
        *self.snapshot.write().await = snapshot.clone();
        publisher.publish_snapshot(&snapshot);
    }

    fn current_generation(&self, revision: u64, epoch: u64) -> bool {
        self.settings_revision.load(Ordering::SeqCst) == revision
            && self.refresh_epoch.load(Ordering::SeqCst) == epoch
    }

    async fn refresh_account<P: SnapshotPublisher + Sync>(
        &self,
        account: &Account,
        settings: &Settings,
        revision: u64,
        epoch: u64,
        publisher: &P,
    ) {
        let targets: Vec<_> = settings
            .targets
            .iter()
            .filter(|t| t.connection_id == account.id)
            .cloned()
            .collect();
        // Unselected providers are checked explicitly during discovery, not on every poll.
        if targets.is_empty() {
            return;
        }
        let cli = self.tools.invocation_for(account);
        let connection = match &cli {
            Ok(cli) => tokio::time::timeout(
                REQUEST_TIMEOUT,
                catalog::connection(cli.as_ref(), account, targets.first()),
            )
            .await
            .unwrap_or_else(|_| {
                Connection::disconnected(
                    &account.id,
                    account.provider,
                    ConnectionStatus::Error,
                    "Connection check timed out. Last known results may be stale.",
                )
            }),
            Err(message) => Connection::disconnected(
                &account.id,
                account.provider,
                ConnectionStatus::Error,
                message,
            ),
        };
        if !self
            .publish_connection(connection.clone(), &targets, revision, epoch, publisher)
            .await
        {
            return;
        }
        if connection.status != ConnectionStatus::Connected {
            return;
        }
        let invocation = cli.ok().flatten();
        let identity = connection.account.as_deref();
        // Queue every recent page ahead of active scans. Once recent requests
        // have started, spare slots can scan active runs without a global barrier.
        let mut pending: std::collections::VecDeque<_> = targets
            .into_iter()
            .map(|target| (target, PageKind::Recent))
            .collect();
        let mut inflight = stream::FuturesUnordered::new();
        loop {
            while inflight.len() < TARGET_CONCURRENCY && self.current_generation(revision, epoch) {
                let Some((target, kind)) = pending.pop_front() else {
                    break;
                };
                let invocation = &invocation;
                inflight.push(async move {
                    let result = if kind == PageKind::Recent {
                        bounded_page(
                            invocation.as_ref(),
                            &target,
                            None,
                            identity,
                            settings.history_hours,
                        )
                        .await
                    } else {
                        bounded_active(invocation.as_ref(), &target, identity).await
                    };
                    self.publish_page(&target, result, kind, revision, epoch, publisher)
                        .await;
                    (target, kind)
                });
            }
            let Some((target, kind)) = inflight.next().await else {
                break;
            };
            if kind == PageKind::Recent && catalog::has_active_scan(account.provider) {
                pending.push_back((target, PageKind::Active));
            }
        }
    }

    async fn publish_connection<P: SnapshotPublisher>(
        &self,
        connection: Connection,
        targets: &[Target],
        revision: u64,
        epoch: u64,
        publisher: &P,
    ) -> bool {
        let _publish = self.publish_lock.lock().await;
        if !self.current_generation(revision, epoch) {
            return false;
        }
        let current = self.snapshot().await;
        let connection =
            retain_last_confirmed_accounts(&current.connections, vec![connection]).remove(0);
        let connections: Vec<_> = current
            .connections
            .iter()
            .filter(|c| c.connection_id != connection.connection_id)
            .cloned()
            .chain([connection.clone()])
            .collect();
        let activities =
            partition_cache_by_account(&current.activities, &current.connections, &connections);
        let mut issues: Vec<_> = current
            .issues
            .iter()
            .filter(|issue| issue.connection_id.as_deref() != Some(&connection.connection_id))
            .cloned()
            .collect();
        let pending_targets = if connection.status == ConnectionStatus::Connected {
            current.pending_targets.clone()
        } else {
            issues.push(Issue {
                provider: connection.provider,
                connection_id: Some(connection.connection_id.clone()),
                target_id: None,
                message: connection.message.clone().unwrap_or_else(|| {
                    "Provider connection failed. Last known results may be stale.".into()
                }),
            });
            current
                .pending_targets
                .iter()
                .filter(|key| !targets.iter().any(|t| t.key() == **key))
                .cloned()
                .collect()
        };
        self.emit(
            Snapshot {
                connections,
                activities,
                issues,
                pending_targets,
                ..current
            },
            publisher,
        )
        .await;
        true
    }

    async fn publish_page<P: SnapshotPublisher>(
        &self,
        target: &Target,
        result: Result<ActivityPage, String>,
        kind: PageKind,
        revision: u64,
        epoch: u64,
        publisher: &P,
    ) {
        let _publish = self.publish_lock.lock().await;
        if !self.current_generation(revision, epoch) {
            return;
        }
        let current = self.snapshot().await;
        let observed_at = Utc::now();
        let notifications = if kind != PageKind::History {
            match &result {
                Ok(page) if page.issues.is_empty() || !page.activities.is_empty() => {
                    self.notification_engine.lock().await.observe(
                        target,
                        &page.activities,
                        &current.settings.preferences,
                        epoch,
                        observed_at,
                    )
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };
        let mut updated = apply_page(current, target, result, kind, epoch);
        for delivery in notifications {
            if let Err(message) = publisher.publish_notification(&delivery.notification) {
                self.notification_engine
                    .lock()
                    .await
                    .mark_failed(&delivery, epoch);
                updated.issues.retain(|issue| {
                    issue.connection_id.as_deref() != Some(&target.connection_id)
                        || issue.target_id.as_deref() != Some(&target.id)
                        || !issue.message.starts_with("Notification:")
                });
                updated.issues.push(Issue {
                    provider: target.provider,
                    connection_id: Some(target.connection_id.clone()),
                    target_id: Some(target.id.clone()),
                    message: format!("Notification: {message}"),
                });
            } else {
                self.notification_engine.lock().await.acknowledge(&delivery);
            }
        }
        self.emit(updated, publisher).await;
    }

    pub async fn load_more<P: SnapshotPublisher>(
        &self,
        connection_id: &str,
        target_id: &str,
        cursor: &str,
        generation: u64,
        publisher: &P,
    ) -> Result<Snapshot, String> {
        let _history_guard = self.history_lock.lock().await;
        let (current, revision) = {
            let _publish = self.publish_lock.lock().await;
            (
                self.snapshot().await,
                self.settings_revision.load(Ordering::SeqCst),
            )
        };
        let history = current
            .history
            .iter()
            .find(|h| {
                h.connection_id == connection_id
                    && h.target_id == target_id
                    && h.next_cursor.as_deref() == Some(cursor)
                    && h.generation == generation
            })
            .ok_or_else(|| "The history page has changed. Refresh and try again.".to_owned())?;
        if current.activities.len() >= MAX_HISTORY_ACTIVITIES {
            return Err("History limit reached. Narrow the selected targets.".into());
        }
        let target = current
            .settings
            .targets
            .iter()
            .find(|t| {
                t.connection_id == connection_id
                    && t.id == target_id
                    && t.provider == history.provider
            })
            .ok_or_else(|| "The selected target no longer exists.".to_owned())?;
        let account = self.account(connection_id, target.provider).await?;
        let cli = self.tools.invocation_for(&account)?;
        let identity = current
            .connections
            .iter()
            .find(|c| c.connection_id == connection_id)
            .and_then(|c| c.account.as_deref());
        let authenticated = tokio::time::timeout(
            REQUEST_TIMEOUT,
            catalog::connection(cli.as_ref(), &account, Some(target)),
        )
        .await
        .map_err(|_| {
            "Connection check timed out. Refresh before loading more history.".to_owned()
        })?;
        if authenticated.status != ConnectionStatus::Connected
            || authenticated.account.as_deref() != identity
        {
            return Err(
                "The CLI account changed or needs sign-in. Refresh before loading more history."
                    .into(),
            );
        }
        let page = bounded_page(
            cli.as_ref(),
            target,
            Some(cursor),
            identity,
            current.settings.history_hours,
        )
        .await?;
        let _publish = self.publish_lock.lock().await;
        if !self.current_generation(revision, generation) {
            return Err("Settings or refresh changed while loading history. Try again.".into());
        }
        let current = self.snapshot().await;
        let next = apply_page(current, target, Ok(page), PageKind::History, generation);
        self.emit(next.clone(), publisher).await;
        Ok(next)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum PageKind {
    Recent,
    Active,
    History,
}

async fn bounded_page(
    cli: Option<&CliInvocation>,
    target: &Target,
    cursor: Option<&str>,
    identity: Option<&str>,
    hours: u32,
) -> Result<ActivityPage, String> {
    tokio::time::timeout(
        REQUEST_TIMEOUT,
        catalog::page(cli, target, cursor, identity, hours),
    )
    .await
    .map_err(|_| "Deployment lookup timed out. Last known results may be stale.".to_owned())?
}

fn same_target(activity: &Activity, target: &Target) -> bool {
    activity.provider == target.provider
        && activity.connection_id == target.connection_id
        && activity.target_id == target.id
}

fn apply_page(
    current: Snapshot,
    target: &Target,
    result: Result<ActivityPage, String>,
    kind: PageKind,
    epoch: u64,
) -> Snapshot {
    let mut issues = current.issues.clone();
    let mut history = current.history.clone();
    let mut activities = current.activities.clone();
    let mut last_updated_at = current.last_updated_at.clone();
    match result {
        Ok(page) => {
            let succeeded = page.issues.is_empty() || !page.activities.is_empty();
            if kind == PageKind::Recent {
                issues.retain(|i| {
                    i.connection_id.as_deref() != Some(&target.connection_id)
                        || i.target_id.as_deref() != Some(&target.id)
                });
                if page.issues.is_empty() {
                    // Keep old active observations until the dedicated scan completes.
                    activities.retain(|a| {
                        !same_target(a, target)
                            || catalog::has_active_scan(target.provider)
                                && is_active_status(a.status)
                    });
                }
            }
            if kind == PageKind::Active && page.issues.is_empty() {
                let fresh_ids: HashSet<_> = page.activities.iter().map(|a| a.id.as_str()).collect();
                // A disappeared active record is not a fabricated success; remove the stale observation.
                activities.retain(|a| {
                    !same_target(a, target)
                        || !is_active_status(a.status)
                        || fresh_ids.contains(a.id.as_str())
                });
            }
            for activity in page.activities {
                let existing = activities.iter().position(|a| {
                    a.connection_id == activity.connection_id
                        && a.provider == activity.provider
                        && a.id == activity.id
                });
                if let Some(index) = existing {
                    activities[index] = newer_observation(&activities[index], &activity).clone();
                } else {
                    activities.push(activity);
                }
            }
            issues.extend(page.issues);
            if kind != PageKind::Active {
                history.retain(|h| {
                    h.connection_id != target.connection_id
                        || h.target_id != target.id
                        || h.provider != target.provider
                });
                history.push(TargetHistory {
                    provider: target.provider,
                    connection_id: target.connection_id.clone(),
                    target_id: target.id.clone(),
                    next_cursor: page.next_cursor,
                    checked_at: Utc::now().to_rfc3339(),
                    generation: epoch,
                });
            }
            if succeeded {
                last_updated_at = Some(Utc::now().to_rfc3339());
            }
        }
        Err(message) => issues.push(Issue {
            provider: target.provider,
            connection_id: Some(target.connection_id.clone()),
            target_id: Some(target.id.clone()),
            message,
        }),
    }
    activities.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let pending_targets = if kind == PageKind::Active
        || kind == PageKind::Recent && !catalog::has_active_scan(target.provider)
    {
        current
            .pending_targets
            .iter()
            .filter(|key| **key != target.key())
            .cloned()
            .collect()
    } else {
        current.pending_targets.clone()
    };
    Snapshot {
        activities,
        history,
        issues,
        pending_targets,
        last_updated_at,
        ..current
    }
}

async fn bounded_active(
    cli: Option<&CliInvocation>,
    target: &Target,
    identity: Option<&str>,
) -> Result<ActivityPage, String> {
    tokio::time::timeout(REQUEST_TIMEOUT, catalog::active(cli, target, identity))
        .await
        .map_err(|_| "Active deployment lookup timed out; the recent list is partial.".to_owned())?
}

#[cfg(test)]
#[path = "refresh_tests.rs"]
mod tests;
