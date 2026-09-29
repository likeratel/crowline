use super::*;

fn test_directory(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "crowline-{name}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ))
}

fn test_state(directory: &Path) -> AppState {
    AppState {
        tools: Toolchain::unavailable_for_test(directory),
        store: SettingsStore::new(directory.to_owned()),
        snapshot: RwLock::new(Snapshot::initial(Settings::default())),
        refresh_lock: Mutex::new(()),
        publish_lock: Mutex::new(()),
        settings_revision: AtomicU64::new(0),
        login_statuses: Mutex::new(HashMap::new()),
    }
}

fn target(connection_id: &str, project: &str) -> Target {
    Target {
        id: format!("org/{project}"),
        provider: Provider::Github,
        connection_id: connection_id.into(),
        name: project.into(),
        description: None,
        metadata: HashMap::new(),
    }
}

fn activity(connection_id: &str, project: &str) -> Activity {
    Activity {
        id: format!("id-{project}"),
        provider: Provider::Github,
        connection_id: connection_id.into(),
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

fn connection(connection_id: &str, account: Option<&str>, status: ConnectionStatus) -> Connection {
    Connection {
        connection_id: connection_id.into(),
        provider: Provider::Github,
        status,
        account: account.map(str::to_owned),
        message: None,
        cli_version: None,
    }
}

#[test]
fn same_external_target_isolated_by_connection() {
    let targets = [target("github-one", "a")];
    let issues = [Issue {
        provider: Provider::Github,
        connection_id: Some("github-one".into()),
        message: "failed".into(),
        target_id: Some("org/a".into()),
    }];
    let cached = [activity("github-one", "a"), activity("github-two", "a")];
    let merged = merge_with_cache(
        &connection("github-one", Some("one"), ConnectionStatus::Connected),
        &targets,
        Vec::new(),
        &issues,
        &cached,
        &mut Vec::new(),
    );
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].connection_id, "github-one");
}

#[test]
fn account_change_clears_only_that_accounts_cache() {
    let cached = [activity("github-one", "a"), activity("github-two", "a")];
    let filtered = partition_cache_by_account(
        &cached,
        &[
            connection("github-one", Some("old"), ConnectionStatus::Connected),
            connection("github-two", Some("stable"), ConnectionStatus::Connected),
        ],
        &[
            connection("github-one", Some("new"), ConnectionStatus::Connected),
            connection("github-two", Some("stable"), ConnectionStatus::Connected),
        ],
    );
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].connection_id, "github-two");
}

#[test]
fn failed_account_does_not_slow_healthy_idle_account() {
    let mut snapshot = Snapshot::initial(Settings::default());
    snapshot.connections = vec![
        connection("github:local", Some("person"), ConnectionStatus::Connected),
        connection("github-work", None, ConnectionStatus::SignedOut),
    ];
    snapshot.issues.push(Issue {
        provider: Provider::Github,
        connection_id: Some("github-work".into()),
        message: "Sign in".into(),
        target_id: None,
    });
    assert_eq!(poll_interval(&snapshot), IDLE_POLL_INTERVAL);
    snapshot.activities = vec![Activity {
        status: ActivityStatus::Running,
        ..activity("github:local", "a")
    }];
    assert_eq!(poll_interval(&snapshot), ACTIVE_POLL_INTERVAL);
    snapshot.connections[0].status = ConnectionStatus::Error;
    snapshot.activities.clear();
    assert_eq!(poll_interval(&snapshot), ERROR_POLL_INTERVAL);
}

#[test]
fn tray_deduplication_key_ignores_connection() {
    let activities = [activity("github-one", "a"), activity("github-two", "a")];
    let unique = activities
        .iter()
        .map(|activity| (activity.provider, activity.id.as_str()))
        .collect::<HashSet<_>>();
    assert_eq!(unique.len(), 1);
}

#[test]
fn tray_uses_latest_status_and_combined_ownership_for_duplicate_runs() {
    let mut snapshot = Snapshot::initial(Settings {
        targets: vec![target("github-one", "a"), target("github-two", "a")],
        ..Settings::default()
    });
    let stale_mine = Activity {
        status: ActivityStatus::Running,
        updated_at: "2026-09-29T10:00:00Z".into(),
        ..activity("github-one", "a")
    };
    let current_other = Activity {
        status: ActivityStatus::Success,
        ownership: Ownership::Other,
        updated_at: "2026-09-29T10:01:00Z".into(),
        ..activity("github-two", "a")
    };
    snapshot.activities = vec![stale_mine, current_other];

    assert_eq!(active_tray_count(&snapshot), 0);

    snapshot.activities[1].status = ActivityStatus::Running;
    assert_eq!(active_tray_count(&snapshot), 1);

    snapshot.activities[1].updated_at = snapshot.activities[0].updated_at.clone();
    snapshot.activities[1].status = ActivityStatus::Unknown;
    assert_eq!(active_tray_count(&snapshot), 1);

    snapshot.activities[1].status = ActivityStatus::Success;
    assert_eq!(active_tray_count(&snapshot), 0);
}

#[tokio::test]
async fn settings_save_rejects_forged_account_definitions() {
    let directory = test_directory("forged-settings");
    let state = test_state(&directory);
    let mut forged = Settings::default();
    forged.accounts.push(Account {
        id: "github-forged".into(),
        provider: Provider::Github,
        label: "Forged".into(),
        mode: AccountMode::Isolated,
        profile: None,
    });

    let result = state.save_settings(forged, &NoopPublisher).await;

    assert_eq!(
        result.expect_err("forged account must be rejected"),
        "Account definitions can only be changed with account commands."
    );
    assert_eq!(state.snapshot().await.settings, Settings::default());
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn unknown_connection_is_rejected_before_cli_resolution() {
    let directory = test_directory("unknown-connection");
    let state = test_state(&directory);

    let result = state.account("github-unknown", Provider::Github).await;

    assert_eq!(
        result.expect_err("unknown account must be rejected"),
        "The selected account does not exist for this provider."
    );
    assert!(!directory.join("accounts/github-unknown").exists());
}

#[tokio::test]
async fn removed_account_rejects_late_login_publication() {
    let directory = test_directory("late-login");
    let state = test_state(&directory);
    let account = state
        .create_connection(Provider::Vercel, "Work".into(), None, &NoopPublisher)
        .await
        .expect("create account");
    state.login_statuses.lock().await.insert(
        account.id.clone(),
        LoginStatus {
            connection_id: account.id.clone(),
            provider: Provider::Vercel,
            state: crate::models::LoginState::Waiting,
            message: "Waiting".into(),
            url: None,
            code: None,
        },
    );
    state
        .remove_connection(&account.id, &NoopPublisher)
        .await
        .expect("remove account");

    let published = state
        .publish_login_status_if_account_exists(
            &account.id,
            Provider::Vercel,
            LoginStatus {
                connection_id: account.id.clone(),
                provider: Provider::Vercel,
                state: crate::models::LoginState::Complete,
                message: "Complete".into(),
                url: None,
                code: None,
            },
        )
        .await;

    assert!(!published);
    assert!(!state.login_statuses.lock().await.contains_key(&account.id));
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn simultaneous_account_mutations_do_not_lose_updates() {
    let directory = test_directory("concurrent-mutations");
    let state = test_state(&directory);

    let (first, second) = tokio::join!(
        state.create_connection(Provider::Vercel, "One".into(), None, &NoopPublisher),
        state.create_connection(Provider::Vercel, "Two".into(), None, &NoopPublisher)
    );
    let first = first.expect("create first account");
    let second = second.expect("create second account");
    let snapshot = state.snapshot().await;

    assert!(snapshot
        .settings
        .accounts
        .iter()
        .any(|account| account.id == first.id));
    assert!(snapshot
        .settings
        .accounts
        .iter()
        .any(|account| account.id == second.id));
    assert_eq!(snapshot.settings.accounts.len(), 4);
    assert_eq!(
        state.store.load().await.expect("load persisted settings"),
        snapshot.settings
    );
    let _ = std::fs::remove_dir_all(directory);
}
