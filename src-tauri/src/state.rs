use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, RwLock};

use crate::{
    cli::Toolchain,
    models::{
        Activity, ActivityStatus, Connection, ConnectionStatus, Issue, LoginStatus, Ownership,
        Provider, Scope, Settings, Snapshot, Target,
    },
    providers::{aws, github, vercel},
    settings::SettingsStore,
};

const ACTIVE_POLL_INTERVAL: Duration = Duration::from_secs(30);
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(120);
const ERROR_POLL_INTERVAL: Duration = Duration::from_secs(240);
const COLLECTION_TIMEOUT: Duration = Duration::from_secs(90);

pub struct AppState {
    pub tools: Toolchain,
    store: SettingsStore,
    snapshot: RwLock<Snapshot>,
    refresh_lock: Mutex<()>,
    publish_lock: Mutex<()>,
    settings_revision: AtomicU64,
    pub login_statuses: Mutex<HashMap<Provider, LoginStatus>>,
}

impl AppState {
    pub async fn initialize(app_data_dir: std::path::PathBuf, resource_dir: Option<&Path>) -> Self {
        let store = SettingsStore::new(app_data_dir);
        let (settings, initial_issue) = match store.load().await {
            Ok(settings) => (settings, None),
            Err(message) => (
                Settings::default(),
                Some(Issue {
                    provider: Provider::Github,
                    message,
                    target_id: None,
                }),
            ),
        };
        let mut snapshot = Snapshot::initial(settings);
        snapshot.issues.extend(initial_issue);
        Self {
            tools: Toolchain::discover(resource_dir).await,
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

    pub async fn save_settings(
        &self,
        settings: Settings,
        app: &AppHandle,
    ) -> Result<Settings, String> {
        let _publish_guard = self.publish_lock.lock().await;
        let saved = self.store.save(settings).await?;
        self.settings_revision.fetch_add(1, Ordering::SeqCst);
        let previous = self.snapshot.read().await.clone();
        let updated = Snapshot {
            settings: saved.clone(),
            ..previous
        };
        *self.snapshot.write().await = updated.clone();
        let _ = app.emit("snapshot-updated", updated.clone());
        update_tray(app, &updated);
        Ok(saved)
    }

    pub async fn refresh(&self, app: &AppHandle) -> Snapshot {
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
                let _ = app.emit("snapshot-updated", refreshing);
                (previous, revision)
            };
            let completed = self.refresh_snapshot(previous).await;
            let _publish_guard = self.publish_lock.lock().await;
            if self.settings_revision.load(Ordering::SeqCst) != revision {
                continue;
            }
            *self.snapshot.write().await = completed.clone();
            let _ = app.emit("snapshot-updated", completed.clone());
            update_tray(app, &completed);
            return completed;
        }
    }

    async fn refresh_snapshot(&self, previous: Snapshot) -> Snapshot {
        let settings = previous.settings.clone();
        let aws_context = aws_context(&settings.targets);
        let (github_connection, vercel_connection, aws_connection) = tokio::join!(
            github::connection(self.tools.github.as_ref()),
            vercel::connection(self.tools.vercel.as_ref()),
            aws::connection(aws_context.0, aws_context.1),
        );
        let connections = retain_last_confirmed_accounts(
            &previous.connections,
            vec![github_connection, vercel_connection, aws_connection],
        );
        let cached =
            partition_cache_by_account(&previous.activities, &previous.connections, &connections);
        let github_targets = provider_targets(&settings.targets, Provider::Github);
        let vercel_targets = provider_targets(&settings.targets, Provider::Vercel);
        let aws_targets = provider_targets(&settings.targets, Provider::Aws);
        let github_account = connections[0].account.as_deref();
        let (github_result, vercel_result, aws_result) = tokio::join!(
            tokio::time::timeout(
                COLLECTION_TIMEOUT,
                github::collect(
                    self.tools.github.as_ref(),
                    &github_targets,
                    settings.history_hours,
                    github_account
                )
            ),
            tokio::time::timeout(
                COLLECTION_TIMEOUT,
                vercel::collect(
                    self.tools.vercel.as_ref(),
                    &vercel_targets,
                    settings.history_hours
                )
            ),
            tokio::time::timeout(
                COLLECTION_TIMEOUT,
                aws::collect(&aws_targets, settings.history_hours)
            ),
        );
        let provider_results = [
            (
                Provider::Github,
                github_targets,
                collection_result(Provider::Github, github_result),
            ),
            (
                Provider::Vercel,
                vercel_targets,
                collection_result(Provider::Vercel, vercel_result),
            ),
            (
                Provider::Aws,
                aws_targets,
                collection_result(Provider::Aws, aws_result),
            ),
        ];
        let mut activities = Vec::new();
        let mut issues = Vec::new();
        let mut any_selected_success = false;
        for (provider, targets, (fresh, mut provider_issues)) in provider_results {
            any_selected_success |= provider_refresh_succeeded(&targets, &fresh, &provider_issues);
            activities.extend(merge_with_cache(
                provider,
                &targets,
                fresh,
                &provider_issues,
                &cached,
                &mut issues,
            ));
            issues.append(&mut provider_issues);
        }
        activities.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let mut seen = HashSet::new();
        activities.retain(|activity| seen.insert((activity.provider, activity.id.clone())));
        let connection_success = connections
            .iter()
            .any(|connection| connection.status == crate::models::ConnectionStatus::Connected);
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
}

fn collection_result(
    provider: Provider,
    result: Result<(Vec<Activity>, Vec<Issue>), tokio::time::error::Elapsed>,
) -> (Vec<Activity>, Vec<Issue>) {
    result.unwrap_or_else(|_| {
        (
            Vec::new(),
            vec![Issue {
                provider,
                message: format!(
                    "{} activity collection timed out. Cached activity is retained when available.",
                    provider.as_str()
                ),
                target_id: None,
            }],
        )
    })
}

fn provider_targets(targets: &[Target], provider: Provider) -> Vec<Target> {
    targets
        .iter()
        .filter(|target| target.provider == provider)
        .cloned()
        .collect()
}

fn aws_context(targets: &[Target]) -> (Option<String>, Option<String>) {
    targets
        .iter()
        .find(|target| target.provider == Provider::Aws)
        .map(|target| {
            (
                target.metadata.get("profile").cloned(),
                target.metadata.get("region").cloned(),
            )
        })
        .unwrap_or((None, None))
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
    provider: Provider,
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
            activity.provider == provider
                && selected_ids.contains(activity.target_id.as_str())
                && !fresh_ids.contains(&(activity.target_id.as_str(), activity.id.as_str()))
                && (global_failure || failed_target_ids.contains(activity.target_id.as_str()))
        })
        .cloned()
        .collect();
    if !retained.is_empty() {
        aggregate_issues.push(Issue {
            provider,
            message: format!(
                "Some {} requests failed; the last known activity is retained and may be stale.",
                provider.as_str()
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
                    .find(|item| item.provider == connection.provider)
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
        .filter_map(|activity| {
            let previous = previous_connections
                .iter()
                .find(|item| item.provider == activity.provider);
            let current = connections
                .iter()
                .find(|item| item.provider == activity.provider);
            if previous.and_then(|item| item.account.as_ref())
                != current.and_then(|item| item.account.as_ref())
            {
                None
            } else {
                Some(activity.clone())
            }
        })
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
    if !snapshot.issues.is_empty() {
        ERROR_POLL_INTERVAL
    } else if snapshot.activities.iter().any(|activity| {
        matches!(
            activity.status,
            ActivityStatus::Queued | ActivityStatus::Running | ActivityStatus::Waiting
        )
    }) {
        ACTIVE_POLL_INTERVAL
    } else {
        IDLE_POLL_INTERVAL
    }
}

fn update_tray(app: &AppHandle, snapshot: &Snapshot) {
    let active = snapshot
        .activities
        .iter()
        .filter(|activity| {
            (snapshot.settings.scope == Scope::All || activity.ownership == Ownership::Mine)
                && snapshot.settings.targets.iter().any(|target| {
                    target.provider == activity.provider && target.id == activity.target_id
                })
                && matches!(
                    activity.status,
                    ActivityStatus::Queued | ActivityStatus::Running | ActivityStatus::Waiting
                )
        })
        .count();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ActivityStatus, Ownership};

    fn activity(project: &str) -> Activity {
        Activity {
            id: format!("id-{project}"),
            provider: Provider::Github,
            target_id: format!("org/{project}"),
            kind: "push".into(),
            title: "Deploy".into(),
            project: project.into(),
            branch: None,
            url: "https://github.com/example/project/actions/runs/1".into(),
            status: ActivityStatus::Success,
            raw_status: "success".into(),
            actor: Some("person".into()),
            ownership: Ownership::Mine,
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn partial_failure_retains_only_failed_target_cache() {
        let targets = vec![
            Target {
                id: "org/a".into(),
                provider: Provider::Github,
                name: "a".into(),
                description: None,
                metadata: HashMap::new(),
            },
            Target {
                id: "org/b".into(),
                provider: Provider::Github,
                name: "b".into(),
                description: None,
                metadata: HashMap::new(),
            },
        ];
        let issues = vec![Issue {
            provider: Provider::Github,
            message: "failed".into(),
            target_id: Some("org/a".into()),
        }];
        let mut aggregate = Vec::new();
        let merged = merge_with_cache(
            Provider::Github,
            &targets,
            vec![activity("b")],
            &issues,
            &[activity("a"), activity("b")],
            &mut aggregate,
        );
        assert_eq!(
            merged
                .iter()
                .filter(|activity| activity.project == "a")
                .count(),
            1
        );
        assert_eq!(
            merged
                .iter()
                .filter(|activity| activity.project == "b")
                .count(),
            1
        );
        assert_eq!(aggregate.len(), 1);
    }

    #[test]
    fn account_change_clears_cached_provider_data() {
        let connection = |account: &str| Connection {
            provider: Provider::Github,
            status: crate::models::ConnectionStatus::Connected,
            account: Some(account.into()),
            message: None,
            cli_version: None,
        };
        let cached = partition_cache_by_account(
            &[activity("a")],
            &[connection("old-user")],
            &[connection("new-user")],
        );
        assert!(cached.is_empty());
    }

    #[test]
    fn identity_outage_keeps_cache_but_later_account_switch_clears_it() {
        let connected = Connection {
            provider: Provider::Github,
            status: ConnectionStatus::Connected,
            account: Some("old-user".into()),
            message: None,
            cli_version: None,
        };
        let failed = Connection::disconnected(
            Provider::Github,
            ConnectionStatus::Error,
            "Network unavailable",
        );
        let first =
            retain_last_confirmed_accounts(std::slice::from_ref(&connected), vec![failed.clone()]);
        let second = retain_last_confirmed_accounts(&first, vec![failed]);
        let cached = partition_cache_by_account(&[activity("a")], &first, &second);
        assert_eq!(cached.len(), 1);
        assert_eq!(second[0].status, ConnectionStatus::Error);
        let switched = retain_last_confirmed_accounts(
            &second,
            vec![Connection {
                account: Some("new-user".into()),
                ..connected
            }],
        );
        assert!(partition_cache_by_account(&cached, &second, &switched).is_empty());
    }

    #[test]
    fn fresh_completion_replaces_cached_progress_on_partial_failure() {
        let target = Target {
            id: "org/a".into(),
            provider: Provider::Github,
            name: "a".into(),
            description: None,
            metadata: HashMap::new(),
        };
        let issues = [Issue {
            provider: Provider::Github,
            message: "Later page failed".into(),
            target_id: Some(target.id.clone()),
        }];
        let cached = Activity {
            status: ActivityStatus::Running,
            ..activity("a")
        };
        let merged = merge_with_cache(
            Provider::Github,
            &[target],
            vec![activity("a")],
            &issues,
            &[cached],
            &mut Vec::new(),
        );
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].status, ActivityStatus::Success);
    }

    #[test]
    fn polling_is_fast_for_active_and_backs_off_on_errors() {
        let mut snapshot = Snapshot::initial(Settings::default());
        snapshot.activities = vec![Activity {
            status: ActivityStatus::Running,
            ..activity("a")
        }];
        assert_eq!(poll_interval(&snapshot), ACTIVE_POLL_INTERVAL);
        snapshot.activities.clear();
        snapshot.issues.push(Issue {
            provider: Provider::Github,
            message: "temporary failure".into(),
            target_id: None,
        });
        assert_eq!(poll_interval(&snapshot), ERROR_POLL_INTERVAL);
        snapshot.activities = vec![Activity {
            status: ActivityStatus::Running,
            ..activity("a")
        }];
        assert_eq!(poll_interval(&snapshot), ERROR_POLL_INTERVAL);
        snapshot.activities.clear();
        snapshot.issues.clear();
        assert_eq!(poll_interval(&snapshot), IDLE_POLL_INTERVAL);
    }
}
