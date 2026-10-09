use super::*;
const PROJECT: &str = "11111111-1111-4111-8111-111111111111";
const RUN: &str = "22222222-2222-4222-8222-222222222222";
const RUN_TWO: &str = "33333333-3333-4333-8333-333333333333";
const RUN_THREE: &str = "44444444-4444-4444-8444-444444444444";
#[cfg(unix)]
const FIXTURE_DEADLINE: Duration = Duration::from_secs(15);
#[cfg(unix)]
const TIMEOUT_FIXTURE_DEADLINE: Duration = Duration::from_secs(10);
fn target(kind: &str) -> Target {
    Target {
        id: format!("{PROJECT}:{kind}"),
        provider: Provider::Eas,
        connection_id: "eas:local".into(),
        name: "Example app".into(),
        description: None,
        metadata: HashMap::from([
            ("projectId".into(), PROJECT.into()),
            ("owner".into(), "example-team".into()),
            ("slug".into(), "example-app".into()),
            ("kind".into(), kind.into()),
        ]),
    }
}

fn account() -> Account {
    Account {
        id: "eas:local".into(),
        provider: Provider::Eas,
        label: "Example".into(),
        mode: crate::models::AccountMode::Local,
        profile: None,
        cli_username: None,
    }
}

#[test]
fn validates_static_project_fields_and_target_bound_cursors() {
    assert!(validate_project(PROJECT, "example-team", "example-app").is_ok());
    for value in [
        "../secret",
        "--config",
        "name/other",
        "name.js",
        "",
        "hello world",
    ] {
        assert!(validate_project(PROJECT, value, "app").is_err());
    }
    assert!(validate_project("not-uuid", "team", "app").is_err());
    assert_eq!(
        parse_cursor(&target("build"), Some(&format!("{PROJECT}:build:10"))).unwrap(),
        10
    );
    assert!(parse_cursor(&target("update"), Some(&format!("{PROJECT}:build:10"))).is_err());
    assert!(parse_cursor(&target("build"), Some(&format!("{PROJECT}:build:999999"))).is_err());
}
#[test]
fn static_context_has_no_user_code_and_cleans_up() {
    let cli = CliInvocation::for_test(std::path::PathBuf::from("unused"));
    let context = ProjectContext::new(&cli, PROJECT, "example-team", "example-app").unwrap();
    let path = context.directory.path().to_path_buf();
    let config: Value =
        serde_json::from_slice(&std::fs::read(path.join("app.json")).unwrap()).unwrap();
    assert_eq!(config["expo"]["extra"]["eas"]["projectId"], PROJECT);
    assert_eq!(std::fs::read_dir(&path).unwrap().count(), 2);
    assert!(config["expo"].get("plugins").is_none());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o077,
            0
        );
    }
    drop(context);
    assert!(!path.exists());
}
#[test]
fn parses_results_without_fabricating_ownership_or_deployment() {
    for (raw, expected) in [
        ("FINISHED", ActivityStatus::Success),
        ("ERRORED", ActivityStatus::Failed),
        ("CANCELED", ActivityStatus::Canceled),
        ("IN_PROGRESS", ActivityStatus::Running),
    ] {
        let activity = parsing::build(&target("build"), &json!({"id":RUN,"status":raw,"platform":"IOS","createdAt":"2026-10-06T01:00:00Z","updatedAt":"2026-10-06T01:01:00Z","initiatingActor":{"displayName":"example-user"}})).unwrap();
        assert_eq!(activity.status, expected);
        assert_eq!(activity.kind, "build");
        assert_eq!(activity.ownership, crate::models::Ownership::Unknown);
    }
    let update = parsing::update(&target("update"), RUN, &[json!({"group":RUN,"createdAt":"2026-10-06T01:00:00Z","branch":"production","message":"Example update"})]).unwrap();
    assert_eq!(update.raw_status, "PUBLISHED");
    assert!(update.actor.is_none());
    assert!(parsing::update(
        &target("update"),
        RUN,
        &[json!({"group":RUN,"createdAt":"2 minutes ago"})]
    )
    .is_err());
    assert!(parsing::update(&target("update"), RUN, &[]).is_err());
    assert!(parsing::update(
        &target("update"),
        RUN,
        &[
            json!({"group":RUN,"createdAt":"2026-10-06T01:00:00Z"}),
            json!({"group":RUN,"createdAt":"not-a-timestamp"}),
        ]
    )
    .is_err());

    let offset_order = parsing::update(
        &target("update"),
        RUN,
        &[
            json!({"group":RUN,"createdAt":"2026-10-06T02:00:00+02:00","message":"earlier"}),
            json!({"group":RUN,"createdAt":"2026-10-06T01:30:00Z","message":"later"}),
        ],
    )
    .unwrap();
    assert_eq!(offset_order.title, "later");
    assert!(parsing::build(
        &target("build"),
        &json!({"id":RUN,"status":"FINISHED","createdAt":"2026-10-06T01:00:00Z","updatedAt":"2026-10-06T01:01:00Z","message":"x".repeat(2049)})
    )
    .is_err());
}

#[test]
fn eas_operation_futures_are_send() {
    fn assert_send<T: Send>(future: T) {
        drop(future);
    }

    let cli = CliInvocation::for_test(std::path::PathBuf::from("unused"));
    let build = target("build");
    let update = target("update");
    let account = account();
    assert_send(page(&cli, &build, None));
    assert_send(active(&cli, &build));
    assert_send(register_project(
        &cli,
        &account,
        PROJECT,
        "example-team",
        "example-app",
    ));
    assert_send(update_page(&cli, &update, 0, tokio::time::Instant::now()));
}

#[cfg(unix)]
fn fixture_cli(source: String) -> (tempfile::TempDir, CliInvocation) {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().unwrap();
    let script = directory.path().join("eas");
    std::fs::write(&script, source).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let cli = CliInvocation::for_test(script);
    (directory, cli)
}

use crate::models::ActivityStatus;

#[cfg(unix)]
#[tokio::test]
async fn fixture_cli_checks_safe_context_read_commands_and_long_running_builds() {
    let source = format!(
        r#"#!/usr/bin/env python3
import glob, json, os, sys, time
args = sys.argv[1:]
if args == ['account:view']:
 print('example-user'); sys.exit(0)
assert os.environ.get('EAS_NO_VCS') == '1'
assert os.environ.get('EXPO_NO_DOTENV') == '1'
with open('app.json') as f: config = json.load(f)['expo']
assert config['extra']['eas']['projectId'] == '{PROJECT}'
assert config['owner'] == 'example-team'
assert config['slug'] == 'example-app'
assert args[0] == 'build:list' and '--json' in args and '--non-interactive' in args
if '--status' in args:
 status = args[args.index('--status')+1]
 open('.started-' + status, 'w').close()
 deadline = time.monotonic() + 2
 while len(glob.glob('.started-*')) < 4 and time.monotonic() < deadline:
  time.sleep(0.01)
 if len(glob.glob('.started-*')) < 4:
  print('commands were not concurrent', file=sys.stderr); sys.exit(2)
 if status == 'pending-cancel':
  print('api-token-super-secret', file=sys.stderr); sys.exit(2)
 if status == 'in-progress':
  print(json.dumps([{{'id':'{RUN}','status':'IN_PROGRESS','createdAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z'}}]))
 else:
  print('[]')
else:
 print('[]')
"#
    );
    let (_directory, cli) = fixture_cli(source);
    let registered = register_project(&cli, &account(), PROJECT, "example-team", "example-app")
        .await
        .unwrap();
    assert_eq!(registered.len(), 2);
    assert!(page(&cli, &target("build"), None)
        .await
        .unwrap()
        .activities
        .is_empty());
    let active = active(&cli, &target("build")).await.unwrap();
    assert_eq!(active.activities.len(), 1);
    assert_eq!(active.activities[0].status, ActivityStatus::Running);
    assert_eq!(active.issues.len(), 1);
    assert!(active.issues[0].message.contains("pending-cancel"));
    assert!(!active.issues[0].message.contains("api-token-super-secret"));
}

#[cfg(unix)]
#[tokio::test]
async fn update_details_retain_order_and_partial_results_without_leaking_stderr() {
    let source = format!(
        r#"#!/usr/bin/env python3
import json, os, sys, time
args = sys.argv[1:]
assert os.environ.get('EAS_NO_VCS') == '1'
assert os.environ.get('EXPO_NO_DOTENV') == '1'
if args[0] == 'update:list':
 print(json.dumps({{'currentPage':[{{'group':'{RUN}'}},{{'group':'{RUN_TWO}'}},{{'group':'{RUN_THREE}'}}]}})); sys.exit(0)
assert args[0] == 'update:view' and args[-1] == '--json'
group = args[1]
if group == '{RUN}':
 time.sleep(0.1)
 print(json.dumps([{{'group':group,'createdAt':'2026-10-06T01:00:00Z','message':'first'}}])); sys.exit(0)
if group == '{RUN_TWO}':
 print(json.dumps([{{'group':group,'createdAt':'2026-10-06T02:00:00Z','message':'second'}}])); sys.exit(0)
print('api-token-super-secret', file=sys.stderr); sys.exit(2)
"#
    );
    let (_directory, cli) = fixture_cli(source);
    let context = ProjectContext::new(&cli, PROJECT, "example-team", "example-app").unwrap();
    let page = update_page(
        &context.invocation,
        &target("update"),
        0,
        tokio::time::Instant::now() + FIXTURE_DEADLINE,
    )
    .await
    .unwrap();

    assert_eq!(
        page.activities
            .iter()
            .map(|activity| activity.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "update:22222222-2222-4222-8222-222222222222",
            "update:33333333-3333-4333-8333-333333333333"
        ]
    );
    assert_eq!(page.issues.len(), 1);
    assert!(!page.issues[0].message.contains("api-token-super-secret"));
}

#[cfg(unix)]
#[tokio::test]
async fn update_detail_deadline_keeps_completed_records_and_cancels_slow_work() {
    let source = format!(
        r#"#!/usr/bin/env python3
import json, sys, time
args = sys.argv[1:]
if args[0] == 'update:list':
 print(json.dumps({{'currentPage':[{{'group':'{RUN}'}},{{'group':'{RUN_TWO}'}}]}})); sys.exit(0)
if args[1] == '{RUN}':
 print(json.dumps([{{'group':'{RUN}','createdAt':'2026-10-06T01:00:00Z'}}])); sys.exit(0)
time.sleep(30)
print(json.dumps([{{'group':'{RUN_TWO}','createdAt':'2026-10-06T02:00:00Z'}}]))
"#
    );
    let (_directory, cli) = fixture_cli(source);
    let context = ProjectContext::new(&cli, PROJECT, "example-team", "example-app").unwrap();
    let started = tokio::time::Instant::now();
    let page = update_page(
        &context.invocation,
        &target("update"),
        0,
        started + TIMEOUT_FIXTURE_DEADLINE,
    )
    .await
    .unwrap();

    assert!(started.elapsed() < Duration::from_secs(15));
    assert_eq!(page.activities.len(), 1);
    assert_eq!(page.activities[0].id, format!("update:{RUN}"));
    assert_eq!(page.issues.len(), 1);
    assert!(page.issues[0].message.contains("timed out"));
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_invalid_update_list_response() {
    let source = r#"#!/usr/bin/env python3
import json
print(json.dumps({'currentPage':'not-an-array'}))
"#
    .to_owned();
    let (_directory, cli) = fixture_cli(source);
    let context = ProjectContext::new(&cli, PROJECT, "example-team", "example-app").unwrap();
    assert_eq!(
        update_page(
            &context.invocation,
            &target("update"),
            0,
            tokio::time::Instant::now() + FIXTURE_DEADLINE,
        )
        .await,
        Err(CliError::InvalidOutput)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_results_when_cli_identity_changes_during_request() {
    let directory = tempfile::tempdir().unwrap();
    let counter = directory.path().join("identity-count");
    let counter_literal = serde_json::to_string(counter.to_str().unwrap()).unwrap();
    let source = format!(
        r#"#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args == ['account:view']:
 path = {counter_literal}
 count = int(open(path).read()) if os.path.exists(path) else 0
 open(path, 'w').write(str(count + 1))
 print('example-user' if count == 0 else 'other-user'); sys.exit(0)
print('[]')
"#
    );
    let (_script_directory, cli) = fixture_cli(source);
    assert_eq!(
        page(&cli, &target("build"), None).await,
        Err(CliError::SignedOut)
    );
}
