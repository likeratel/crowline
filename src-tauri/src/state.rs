use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use chrono::Utc;
use futures::future::join_all;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{Mutex, RwLock, Semaphore};

use crate::{
    cli::Toolchain,
    models::{
        Account, AccountMode, Activity, ActivityStatus, Connection, ConnectionStatus, Issue,
        LoginStatus, Ownership, Provider, Scope, Settings, Snapshot, Target, LOCAL_GITHUB_ID,
        LOCAL_VERCEL_ID,
    },
    providers::{aws, github, vercel},
    settings::SettingsStore,
};

const ACTIVE_POLL_INTERVAL: Duration = Duration::from_secs(30);
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(120);
const ERROR_POLL_INTERVAL: Duration = Duration::from_secs(240);
const COLLECTION_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_CONCURRENT_ACCOUNTS: usize = 6;

pub(crate) trait SnapshotPublisher {
    fn publish_snapshot(&self, snapshot: &Snapshot);
}

impl<R: Runtime> SnapshotPublisher for AppHandle<R> {
    fn publish_snapshot(&self, snapshot: &Snapshot) {
        let _ = self.emit("snapshot-updated", snapshot.clone());
        update_tray(self, snapshot);
    }
}

#[cfg(test)]
struct NoopPublisher;

#[cfg(test)]
impl SnapshotPublisher for NoopPublisher {
    fn publish_snapshot(&self, _snapshot: &Snapshot) {}
}

pub struct AppState {
    pub tools: Toolchain,
    store: SettingsStore,
    snapshot: RwLock<Snapshot>,
    refresh_lock: Mutex<()>,
    publish_lock: Mutex<()>,
    settings_revision: AtomicU64,
    pub login_statuses: Mutex<HashMap<String, LoginStatus>>,
}

struct AccountRefresh {
    connection: Connection,
    targets: Vec<Target>,
    activities: Vec<Activity>,
    issues: Vec<Issue>,
}

impl AppState {
    pub async fn initialize(app_data_dir: std::path::PathBuf, resource_dir: Option<&Path>) -> Self {
        let store = SettingsStore::new(app_data_dir.clone());
        let (settings, initial_issue) = match store.load().await {
            Ok(settings) => (settings, None),
            Err(message) => (
                Settings::default(),
                Some(Issue {
                    provider: Provider::Github,
                    connection_id: None,
                    message,
                    target_id: None,
                }),
            ),
        };
        let mut snapshot = Snapshot::initial(settings);
        snapshot.issues.extend(initial_issue);
        Self {
            tools: Toolchain::discover(resource_dir, &app_data_dir).await,
            store,
            snapshot: RwLock::new(snapshot),
            refresh_lock: Mutex::new(()),
            publish_lock: Mutex::new(()),
            settings_revision: AtomicU64::new(0),
            login_statuses: Mutex::new(HashMap::new()),
        }
    }

    pub async fn snapshot(&self) -> Snapshot {
        self.snapshot.read().await.clone()
    }

    pub async fn account(
        &self,
        connection_id: &str,
        provider: Provider,
    ) -> Result<Account, String> {
        self.snapshot
            .read()
            .await
            .settings
            .accounts
            .iter()
            .find(|account| account.id == connection_id && account.provider == provider)
            .cloned()
            .ok_or_else(|| "The selected account does not exist for this provider.".to_owned())
    }

    pub async fn register_login_attempt(
        &self,
        connection_id: &str,
        provider: Provider,
        waiting: LoginStatus,
    ) -> Result<(Account, LoginStatus, bool), String> {
        let _publish_guard = self.publish_lock.lock().await;
        let account = self
            .snapshot
            .read()
            .await
            .settings
            .accounts
            .iter()
            .find(|account| account.id == connection_id && account.provider == provider)
            .cloned()
            .ok_or_else(|| "The selected account does not exist for this provider.".to_owned())?;
        let mut statuses = self.login_statuses.lock().await;
        if let Some(existing) = statuses
            .get(connection_id)
            .filter(|status| status.state == crate::models::LoginState::Waiting)
        {
            return Ok((account, existing.clone(), false));
        }
        statuses.insert(connection_id.to_owned(), waiting.clone());
        Ok((account, waiting, true))
    }

    pub async fn save_settings<P: SnapshotPublisher>(
        &self,
        settings: Settings,
        publisher: &P,
    ) -> Result<Settings, String> {
        settings.validate()?;
        let _publish_guard = self.publish_lock.lock().await;
        let previous = self.snapshot.read().await.clone();
        if settings.accounts != previous.settings.accounts {
            return Err("Account definitions can only be changed with account commands.".into());
        }
        self.publish_settings_locked(settings, previous, publisher)
            .await
    }

    async fn publish_settings_locked<P: SnapshotPublisher>(
        &self,
        settings: Settings,
        previous: Snapshot,
        publisher: &P,
    ) -> Result<Settings, String> {
        for account in &settings.accounts {
            self.tools.prepare_account(account)?;
        }
        let saved = self.store.save(settings).await?;
        self.settings_revision.fetch_add(1, Ordering::SeqCst);
        let account_ids: HashSet<&str> = saved
            .accounts
            .iter()
            .map(|account| account.id.as_str())
            .collect();
        let target_keys: HashSet<(&str, Provider, &str)> = saved
            .targets
            .iter()
            .map(|target| {
                (
                    target.connection_id.as_str(),
                    target.provider,
                    target.id.as_str(),
                )
            })
            .collect();
        let updated = Snapshot {
            settings: saved.clone(),
            connections: previous
                .connections
                .into_iter()
                .filter(|connection| account_ids.contains(connection.connection_id.as_str()))
                .collect(),
            activities: previous
                .activities
                .into_iter()
                .filter(|activity| {
                    target_keys.contains(&(
                        activity.connection_id.as_str(),
                        activity.provider,
                        activity.target_id.as_str(),
                    ))
                })
                .collect(),
            issues: previous
                .issues
                .into_iter()
                .filter(|issue| {
                    issue
                        .connection_id
                        .as_deref()
                        .is_none_or(|id| account_ids.contains(id))
                })
                .collect(),
            ..previous
        };
        *self.snapshot.write().await = updated.clone();
        publisher.publish_snapshot(&updated);
        Ok(saved)
    }

    pub async fn create_connection<P: SnapshotPublisher>(
        &self,
        provider: Provider,
        label: String,
        profile: Option<String>,
        publisher: &P,
    ) -> Result<Account, String> {
        let account = match provider {
            Provider::Github | Provider::Vercel => {
                if profile.is_some() {
                    return Err("Only AWS connections accept a profile.".into());
                }
                Account {
                    id: format!("{}-{}", provider.as_str(), uuid::Uuid::new_v4()),
                    provider,
                    label,
                    mode: AccountMode::Isolated,
                    profile: None,
                }
            }
            Provider::Aws => {
                let profile = profile
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "Select an AWS profile.".to_owned())?;
                if !aws::profile_names()?.contains(&profile) {
                    return Err("The selected AWS profile was not found.".into());
                }
                Account {
                    id: format!("aws-{}", uuid::Uuid::new_v4()),
                    provider,
                    label,
                    mode: AccountMode::Local,
                    profile: Some(profile),
                }
            }
        };
        account.validate()?;
        self.tools.prepare_account(&account)?;
        let _publish_guard = self.publish_lock.lock().await;
        let previous = self.snapshot.read().await.clone();
        let mut settings = previous.settings.clone();
        if account.provider == Provider::Aws
            && settings.accounts.iter().any(|existing| {
                existing.provider == Provider::Aws && existing.profile == account.profile
            })
        {
            return Err("That AWS profile already has a connection.".into());
        }
        settings.accounts.push(account.clone());
        settings.validate()?;
        self.publish_settings_locked(settings, previous, publisher)
            .await?;
        Ok(account)
    }

    pub async fn remove_connection<P: SnapshotPublisher>(
        &self,
        connection_id: &str,
        publisher: &P,
    ) -> Result<Settings, String> {
        if matches!(connection_id, LOCAL_GITHUB_ID | LOCAL_VERCEL_ID) {
            return Err("The default local CLI accounts cannot be removed.".into());
        }
        let _publish_guard = self.publish_lock.lock().await;
        let previous = self.snapshot.read().await.clone();
        let mut settings = previous.settings.clone();
        let before = settings.accounts.len();
        settings
            .accounts
            .retain(|account| account.id != connection_id);
        if settings.accounts.len() == before {
            return Err("The selected account does not exist.".into());
        }
        settings
            .targets
            .retain(|target| target.connection_id != connection_id);
        let saved = self
            .publish_settings_locked(settings, previous, publisher)
            .await?;
        self.login_statuses.lock().await.remove(connection_id);
        Ok(saved)
    }

    pub async fn publish_login_status_if_account_exists(
        &self,
        connection_id: &str,
        provider: Provider,
        status: LoginStatus,
    ) -> bool {
        let _publish_guard = self.publish_lock.lock().await;
        let exists = self
            .snapshot
            .read()
            .await
            .settings
            .accounts
            .iter()
            .any(|account| account.id == connection_id && account.provider == provider);
        if exists {
            self.login_statuses
                .lock()
                .await
                .insert(connection_id.to_owned(), status);
        }
        exists
    }

    pub async fn refresh<P: SnapshotPublisher>(&self, publisher: &P) -> Snapshot {
        let Ok(_refresh_guard) = self.refresh_lock.try_lock() else {
            return self.snapshot().await;
        };
        loop {
            let (previous, revision) = {
                let _publish_guard = self.publish_lock.lock().await;
                let previous = self.snapshot().await;
                let revision = self.settings_revision.load(Ordering::SeqCst);
                let refreshing = Snapshot {
                    refreshing: true,
                    ..previous.clone()
                };
                *self.snapshot.write().await = refreshing.clone();
                publisher.publish_snapshot(&refreshing);
                (previous, revision)
            };
            let completed = self.refresh_snapshot(previous).await;
            let _publish_guard = self.publish_lock.lock().await;
            if self.settings_revision.load(Ordering::SeqCst) != revision {
                continue;
            }
            *self.snapshot.write().await = completed.clone();
            publisher.publish_snapshot(&completed);
            return completed;
        }
    }

    async fn refresh_snapshot(&self, previous: Snapshot) -> Snapshot {
        let settings = previous.settings.clone();
        let concurrency = Arc::new(Semaphore::new(MAX_CONCURRENT_ACCOUNTS));
        let accounts = settings.accounts.clone();
        let targets = &settings.targets;
        let history_hours = settings.history_hours;
        let futures = accounts.into_iter().map(|account| {
            let concurrency = concurrency.clone();
            async move {
                let _permit = concurrency.acquire_owned().await.ok();
                self.refresh_account(&account, targets, history_hours).await
            }
        });
        let results = join_all(futures).await;
        let probed_connections: Vec<Connection> = results
            .iter()
            .map(|result| result.connection.clone())
            .collect();
        let connections = retain_last_confirmed_accounts(&previous.connections, probed_connections);
        let cached =
            partition_cache_by_account(&previous.activities, &previous.connections, &connections);

        let mut activities = Vec::new();
        let mut issues = Vec::new();
        let mut any_selected_success = false;
        for result in results {
            any_selected_success |=
                provider_refresh_succeeded(&result.targets, &result.activities, &result.issues);
            activities.extend(merge_with_cache(
                &result.connection,
                &result.targets,
                result.activities,
                &result.issues,
                &cached,
                &mut issues,
            ));
            issues.extend(result.issues);
        }
        activities.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let mut seen = HashSet::new();
        activities.retain(|activity| {
            seen.insert((
                activity.connection_id.clone(),
                activity.provider,
                activity.id.clone(),
            ))
        });
        let connection_success = connections
            .iter()
            .any(|connection| connection.status == ConnectionStatus::Connected);
        let refresh_succeeded =
            any_selected_success || (settings.targets.is_empty() && connection_success);
        Snapshot {
            settings,
            connections,
            activities,
            issues,
            refreshing: false,
            last_updated_at: refresh_succeeded
                .then(|| Utc::now().to_rfc3339())
                .or(previous.last_updated_at),
        }
    }

    async fn refresh_account(
        &self,
        account: &Account,
        all_targets: &[Target],
        history_hours: u32,
    ) -> AccountRefresh {
        let targets = all_targets
            .iter()
            .filter(|target| target.connection_id == account.id)
            .cloned()
            .collect::<Vec<_>>();
        let cli = match self.tools.invocation_for(account) {
            Ok(cli) => cli,
            Err(message) => return failed_account_refresh(account, targets, message),
        };
        let connection = match account.provider {
            Provider::Github => github::connection(cli.as_ref(), &account.id).await,
            Provider::Vercel => vercel::connection(cli.as_ref(), &account.id).await,
            Provider::Aws => {
                let region = targets
                    .first()
                    .and_then(|target| target.metadata.get("region"))
                    .cloned();
                aws::connection(account.profile.clone(), region, &account.id).await
            }
        };
        if targets.is_empty() {
            return AccountRefresh {
                connection,
                targets,
                activities: Vec::new(),
                issues: Vec::new(),
            };
        }
        if connection.status != ConnectionStatus::Connected {
            let message = connection.message.clone().unwrap_or_else(|| {
                format!("{} connection is unavailable.", account.provider.as_str())
            });
            return AccountRefresh {
                connection,
                targets,
                activities: Vec::new(),
                issues: vec![Issue {
                    provider: account.provider,
                    connection_id: Some(account.id.clone()),
                    message,
                    target_id: None,
                }],
            };
        }
        let identity = connection.account.as_deref();
        let collection = match account.provider {
            Provider::Github => {
                tokio::time::timeout(
                    COLLECTION_TIMEOUT,
                    github::collect(cli.as_ref(), &targets, history_hours, identity, &account.id),
                )
                .await
            }
            Provider::Vercel => {
                tokio::time::timeout(
                    COLLECTION_TIMEOUT,
                    vercel::collect(cli.as_ref(), &targets, history_hours, &account.id),
                )
                .await
            }
            Provider::Aws => {
                tokio::time::timeout(COLLECTION_TIMEOUT, aws::collect(&targets, history_hours))
                    .await
            }
        };
        let (activities, issues) = collection_result(account, collection);
        AccountRefresh {
            connection,
            targets,
            activities,
            issues,
        }
    }
}

fn failed_account_refresh(
    account: &Account,
    targets: Vec<Target>,
    message: String,
) -> AccountRefresh {
    AccountRefresh {
        connection: Connection::disconnected(
            &account.id,
            account.provider,
            ConnectionStatus::Error,
            message.clone(),
        ),
        targets,
        activities: Vec::new(),
        issues: vec![Issue {
            provider: account.provider,
            connection_id: Some(account.id.clone()),
            message,
            target_id: None,
        }],
    }
}

fn collection_result(
    account: &Account,
    result: Result<(Vec<Activity>, Vec<Issue>), tokio::time::error::Elapsed>,
) -> (Vec<Activity>, Vec<Issue>) {
    result.unwrap_or_else(|_| {
        (
            Vec::new(),
            vec![Issue {
                provider: account.provider,
                connection_id: Some(account.id.clone()),
                message: format!(
                    "{} activity collection timed out. Cached activity is retained when available.",
                    account.provider.as_str()
                ),
                target_id: None,
            }],
        )
    })
}

fn provider_refresh_succeeded(targets: &[Target], fresh: &[Activity], issues: &[Issue]) -> bool {
    !targets.is_empty()
        && !issues.iter().any(|issue| issue.target_id.is_none())
        && (!fresh.is_empty()
            || issues.is_empty()
            || issues
                .iter()
                .filter_map(|issue| issue.target_id.as_ref())
                .count()
                < targets.len())
}

fn merge_with_cache(
    connection: &Connection,
    targets: &[Target],
    fresh: Vec<Activity>,
    provider_issues: &[Issue],
    cached: &[Activity],
    aggregate_issues: &mut Vec<Issue>,
) -> Vec<Activity> {
    let global_failure = provider_issues
        .iter()
        .any(|issue| issue.target_id.is_none());
    let failed_target_ids: HashSet<&str> = provider_issues
        .iter()
        .filter_map(|issue| issue.target_id.as_deref())
        .collect();
    let selected_ids: HashSet<&str> = targets.iter().map(|target| target.id.as_str()).collect();
    let fresh_ids: HashSet<(&str, &str)> = fresh
        .iter()
        .map(|activity| (activity.target_id.as_str(), activity.id.as_str()))
        .collect();
    let retained: Vec<Activity> = cached
        .iter()
        .filter(|activity| {
            activity.connection_id == connection.connection_id
                && activity.provider == connection.provider
                && selected_ids.contains(activity.target_id.as_str())
                && !fresh_ids.contains(&(activity.target_id.as_str(), activity.id.as_str()))
                && (global_failure || failed_target_ids.contains(activity.target_id.as_str()))
        })
        .cloned()
        .collect();
    if !retained.is_empty() {
        aggregate_issues.push(Issue {
            provider: connection.provider,
            connection_id: Some(connection.connection_id.clone()),
            message: format!(
                "Some {} requests failed; the last known activity is retained and may be stale.",
                connection.provider.as_str()
            ),
            target_id: None,
        });
    }
    fresh.into_iter().chain(retained).collect()
}

fn retain_last_confirmed_accounts(
    previous: &[Connection],
    connections: Vec<Connection>,
) -> Vec<Connection> {
    connections
        .into_iter()
        .map(|connection| {
            if connection.status == ConnectionStatus::Error && connection.account.is_none() {
                let account = previous
                    .iter()
                    .find(|item| item.connection_id == connection.connection_id)
                    .and_then(|item| item.account.clone());
                Connection {
                    account,
                    ..connection
                }
            } else {
                connection
            }
        })
        .collect()
}

fn partition_cache_by_account(
    cached: &[Activity],
    previous_connections: &[Connection],
    connections: &[Connection],
) -> Vec<Activity> {
    cached
        .iter()
        .filter(|activity| {
            let previous = previous_connections
                .iter()
                .find(|item| item.connection_id == activity.connection_id);
            let current = connections
                .iter()
                .find(|item| item.connection_id == activity.connection_id);
            previous.and_then(|item| item.account.as_ref())
                == current.and_then(|item| item.account.as_ref())
        })
        .cloned()
        .collect()
}

pub fn start_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<AppState>();
            let snapshot = state.refresh(&app).await;
            tokio::time::sleep(poll_interval(&snapshot)).await;
        }
    });
}

fn poll_interval(snapshot: &Snapshot) -> Duration {
    let connected: HashSet<&str> = snapshot
        .connections
        .iter()
        .filter(|connection| connection.status == ConnectionStatus::Connected)
        .map(|connection| connection.connection_id.as_str())
        .collect();
    if snapshot.activities.iter().any(|activity| {
        connected.contains(activity.connection_id.as_str())
            && matches!(
                activity.status,
                ActivityStatus::Queued | ActivityStatus::Running | ActivityStatus::Waiting
            )
    }) {
        ACTIVE_POLL_INTERVAL
    } else if !connected.is_empty() {
        IDLE_POLL_INTERVAL
    } else {
        ERROR_POLL_INTERVAL
    }
}

fn update_tray<R: Runtime>(app: &AppHandle<R>, snapshot: &Snapshot) {
    let active = active_tray_count(snapshot);
    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        let title = (active > 0).then(|| active.to_string());
        let tooltip = if active > 0 {
            format!("crowline — {active} active")
        } else {
            "crowline".to_owned()
        };
        let _ = tray.set_title(title);
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn active_tray_count(snapshot: &Snapshot) -> usize {
    let mut runs = HashMap::<(Provider, &str), (&Activity, bool)>::new();
    for activity in snapshot.activities.iter().filter(|activity| {
        snapshot.settings.targets.iter().any(|target| {
            target.connection_id == activity.connection_id
                && target.provider == activity.provider
                && target.id == activity.target_id
        })
    }) {
        let key = (activity.provider, activity.id.as_str());
        let any_mine =
            activity.ownership == Ownership::Mine || runs.get(&key).is_some_and(|(_, mine)| *mine);
        let latest = runs
            .get(&key)
            .map(|(current, _)| newer_observation(current, activity))
            .unwrap_or(activity);
        runs.insert(key, (latest, any_mine));
    }
    runs.values()
        .filter(|(activity, any_mine)| {
            (snapshot.settings.scope == Scope::All || *any_mine)
                && is_active_status(activity.status)
        })
        .count()
}

fn newer_observation<'a>(current: &'a Activity, candidate: &'a Activity) -> &'a Activity {
    if candidate.updated_at > current.updated_at
        || candidate.updated_at == current.updated_at
            && is_active_status(current.status)
            && is_terminal_status(candidate.status)
    {
        candidate
    } else {
        current
    }
}

fn is_terminal_status(status: ActivityStatus) -> bool {
    matches!(
        status,
        ActivityStatus::Success
            | ActivityStatus::Failed
            | ActivityStatus::Canceled
            | ActivityStatus::Skipped
    )
}

fn is_active_status(status: ActivityStatus) -> bool {
    matches!(
        status,
        ActivityStatus::Queued | ActivityStatus::Running | ActivityStatus::Waiting
    )
}

#[cfg(test)]
mod tests;
