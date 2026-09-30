use super::*;
use std::sync::Mutex as StdMutex;

fn target(name: &str) -> Target {
    Target {
        id: format!("sample/{name}"),
        provider: Provider::Github,
        connection_id: "github:local".into(),
        name: name.into(),
        description: None,
        metadata: HashMap::new(),
    }
}
fn activity(target: &Target, id: &str, status: ActivityStatus) -> Activity {
    Activity {
        id: id.into(),
        provider: target.provider,
        connection_id: target.connection_id.clone(),
        target_id: target.id.clone(),
        kind: "workflow".into(),
        title: "Deploy".into(),
        project: target.name.clone(),
        branch: None,
        url: "https://github.com/sample/project/actions/runs/1".into(),
        status,
        raw_status: "fixture".into(),
        actor: None,
        ownership: Ownership::Unknown,
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
        updated_at: Utc::now().to_rfc3339(),
    }
}
fn state() -> AppState {
    let directory = std::env::temp_dir().join(format!("crowline-stream-{}", uuid::Uuid::new_v4()));
    AppState {
        tools: Toolchain::unavailable_for_test(&directory),
        store: SettingsStore::new(directory),
        snapshot: RwLock::new(Snapshot::initial(Settings::default())),
        refresh_lock: Mutex::new(()),
        publish_lock: Mutex::new(()),
        settings_revision: AtomicU64::new(0),
        refresh_epoch: AtomicU64::new(1),
        history_lock: Mutex::new(()),
        login_statuses: Mutex::new(HashMap::new()),
    }
}
#[derive(Default)]
struct Recorder(StdMutex<Vec<Snapshot>>);
impl SnapshotPublisher for Recorder {
    fn publish_snapshot(&self, snapshot: &Snapshot) {
        self.0.lock().unwrap().push(snapshot.clone());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn synthetic_slow_target_does_not_block_first_page_publication() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("crowline-stream-bench-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let script = root.join("fake-cli");
    std::fs::write(&script, r#"#!/bin/sh
printf '%s\n' "$*" >> "$0.calls"
case "$*" in
  *--version*) printf 'fixture 1.0.0\n';;
  *' user') printf '{"login":"synthetic-user"}';;
  *'repos/sample/slow/actions/runs?per_page=20'*) sleep 0.3; printf '{"total_count":0,"workflow_runs":[]}';;
  *) printf '{"total_count":0,"workflow_runs":[]}';;
esac
"#).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let state = AppState {
        tools: Toolchain::github_for_test(&root, CliInvocation::for_test(script.clone())),
        ..state()
    };
    let fast = target("fast");
    let slow = target("slow");
    state.snapshot.write().await.settings.targets = vec![fast.clone(), slow];
    struct TimedRecorder {
        started: std::time::Instant,
        pages: StdMutex<Vec<(u128, Snapshot)>>,
    }
    impl SnapshotPublisher for TimedRecorder {
        fn publish_snapshot(&self, snapshot: &Snapshot) {
            self.pages
                .lock()
                .unwrap()
                .push((self.started.elapsed().as_millis(), snapshot.clone()));
        }
    }
    let recorder = TimedRecorder {
        started: std::time::Instant::now(),
        pages: StdMutex::new(Vec::new()),
    };
    let done = state.refresh(&recorder).await;
    assert!(!done.refreshing);
    let pages = recorder.pages.lock().unwrap();
    let first = pages
        .iter()
        .find(|(_, s)| s.history.iter().any(|h| h.target_id == fast.id))
        .unwrap();
    assert_eq!(
        first.1.history.len(),
        1,
        "fast result must publish before slow target finishes"
    );
    assert!(first.1.refreshing);
    let fast_complete = pages
        .iter()
        .find(|(_, snapshot)| {
            snapshot.refreshing
                && snapshot.history.iter().any(|h| h.target_id == fast.id)
                && !snapshot.pending_targets.contains(&fast.key())
        })
        .expect("fast target must complete its active scan during refresh");
    assert_eq!(
        fast_complete.1.history.len(),
        1,
        "slow recent lookup must not block the fast target's active scan"
    );
    let calls = std::fs::read_to_string(script.with_extension("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.contains("per_page=20"))
            .count(),
        2
    );
    assert!(!calls.contains("&page=2"));
    eprintln!("synthetic streaming: first_page={}ms fast_active={}ms all_targets={}ms recent_calls=2 active_calls=10 (slow request=300ms)",first.0,fast_complete.0,recorder.started.elapsed().as_millis());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn recent_page_preserves_other_targets_and_active_until_scan_finishes() {
    let a = target("a");
    let b = target("b");
    let current = Snapshot {
        activities: vec![
            activity(&a, "old", ActivityStatus::Success),
            activity(&a, "active", ActivityStatus::Running),
            activity(&b, "other", ActivityStatus::Success),
        ],
        pending_targets: vec![a.key(), b.key()],
        ..Snapshot::initial(Settings::default())
    };
    let next = apply_page(
        current,
        &a,
        Ok(ActivityPage {
            activities: vec![activity(&a, "recent", ActivityStatus::Success)],
            next_cursor: Some("2".into()),
            issues: vec![],
        }),
        PageKind::Recent,
        1,
    );
    assert_eq!(next.activities.len(), 3);
    assert!(!next.activities.iter().any(|a| a.id == "old"));
    assert_eq!(next.pending_targets.len(), 2);
    assert_eq!(next.history[0].next_cursor.as_deref(), Some("2"));
    let done = apply_page(next, &a, Ok(ActivityPage::default()), PageKind::Active, 1);
    assert!(!done.activities.iter().any(|a| a.id == "active"));
    assert_eq!(done.pending_targets, vec![b.key()]);
}

#[test]
fn blocked_observation_replaces_cached_running_even_if_active_scan_fails() {
    let t = Target {
        provider: Provider::Vercel,
        ..target("a")
    };
    let old = activity(&t, "deployment", ActivityStatus::Running);
    let blocked = Activity {
        status: ActivityStatus::Skipped,
        raw_status: "BLOCKED".into(),
        ..old.clone()
    };
    let current = Snapshot {
        activities: vec![old],
        ..Snapshot::initial(Settings::default())
    };
    let recent = apply_page(
        current,
        &t,
        Ok(ActivityPage {
            activities: vec![blocked],
            ..ActivityPage::default()
        }),
        PageKind::Recent,
        1,
    );
    let next = apply_page(
        recent,
        &t,
        Err("synthetic network failure".into()),
        PageKind::Active,
        1,
    );
    assert_eq!(next.activities[0].raw_status, "BLOCKED");
    assert!(!crate::panel::visible_activity(
        &next.activities[0],
        Utc::now()
    ));
}

#[test]
fn failed_scan_preserves_cache_and_reports_partial_result() {
    let t = target("a");
    let current = Snapshot {
        activities: vec![activity(&t, "active", ActivityStatus::Running)],
        ..Snapshot::initial(Settings::default())
    };
    let next = apply_page(
        current,
        &t,
        Err("synthetic timeout".into()),
        PageKind::Active,
        1,
    );
    assert_eq!(next.activities.len(), 1);
    assert_eq!(next.issues.len(), 1);
    assert!(next.last_updated_at.is_none());
}

#[tokio::test]
async fn results_publish_before_all_targets_finish_and_stale_epochs_are_discarded() {
    let state = state();
    let recorder = Recorder::default();
    let a = target("a");
    let b = target("b");
    state.snapshot.write().await.pending_targets = vec![a.key(), b.key()];
    state
        .publish_page(
            &a,
            Ok(ActivityPage {
                activities: vec![activity(&a, "first", ActivityStatus::Success)],
                ..ActivityPage::default()
            }),
            PageKind::Recent,
            0,
            1,
            &recorder,
        )
        .await;
    let published = recorder.0.lock().unwrap().clone();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].activities[0].id, "first");
    assert!(published[0].pending_targets.contains(&b.key()));
    state.settings_revision.fetch_add(1, Ordering::SeqCst);
    state
        .publish_page(
            &b,
            Ok(ActivityPage {
                activities: vec![activity(&b, "stale", ActivityStatus::Success)],
                ..ActivityPage::default()
            }),
            PageKind::Recent,
            0,
            1,
            &recorder,
        )
        .await;
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
    assert!(!state
        .snapshot()
        .await
        .activities
        .iter()
        .any(|a| a.id == "stale"));
}

#[tokio::test]
async fn forged_or_expired_history_cursor_is_rejected_before_any_cli_call() {
    let state = state();
    let recorder = Recorder::default();
    let error = state
        .load_more(
            "github:local",
            "sample/a",
            "https://invalid.example",
            1,
            &recorder,
        )
        .await
        .unwrap_err();
    assert!(error.contains("history page has changed"));
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn queued_recent_pages_start_before_slow_active_scans() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("crowline-priority-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let script = root.join("fake-cli");
    std::fs::write(
        &script,
        r#"#!/bin/sh
printf '%s\n' "$*" >> "$0.calls"
case "$*" in
  *--version*) printf 'fixture 1.0.0\n';;
  *' user') printf '{"login":"synthetic-user"}';;
  *'status='*) sleep 0.3; printf 'active-finished\n' >> "$0.calls"; printf '{"total_count":0,"workflow_runs":[]}';;
  *) printf '{"total_count":0,"workflow_runs":[]}';;
esac
"#,
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let state = AppState {
        tools: Toolchain::github_for_test(&root, CliInvocation::for_test(script.clone())),
        ..state()
    };
    let targets = vec![target("first"), target("second"), target("third")];
    state.snapshot.write().await.settings.targets = targets.clone();
    let recorder = Recorder::default();
    let done = state.refresh(&recorder).await;
    assert!(!done.refreshing);
    let pages = recorder.0.lock().unwrap();
    let all_recent = pages.iter().find(|s| s.history.len() == 3).unwrap();
    assert_eq!(
        all_recent.pending_targets.len(),
        3,
        "queued recent pages must publish before slow active scans finish"
    );
    let calls = std::fs::read_to_string(script.with_extension("calls")).unwrap();
    let third_recent = calls
        .find("repos/sample/third/actions/runs?per_page=20")
        .unwrap();
    let first_active_done = calls.find("active-finished").unwrap();
    assert!(
        third_recent < first_active_done,
        "queued recent lookup must start before slow active probes complete"
    );
    assert!(done.issues.is_empty());
    std::fs::remove_dir_all(root).unwrap();
}
