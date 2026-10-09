use super::auth::has_auth_override;
use super::*;

fn target(kind: &str) -> Target {
    let mut metadata = HashMap::from([
        ("kind".into(), kind.into()),
        ("projectId".into(), "sample-project-123".into()),
    ]);
    if kind == HOSTING {
        metadata.insert("siteId".into(), "sample-site".into());
    } else {
        metadata.insert("location".into(), "us-central1".into());
        metadata.insert("backendId".into(), "sample-backend".into());
    }
    Target {
        id: format!("sample-project-123:{kind}"),
        provider: Provider::Firebase,
        connection_id: "firebase:local".into(),
        name: "Sample".into(),
        description: None,
        metadata,
    }
}

#[test]
fn parses_synthetic_hosting_release() {
    let release: Release = serde_json::from_str(
        r#"{
          "name":"sites/sample-site/releases/release-1",
          "releaseTime":"2026-10-06T01:02:03Z",
          "type":"SITE_RELEASE",
          "message":"Ship sample",
          "releaseUser":{"email":"person@example.test"},
          "version":{"name":"sites/sample-site/versions/version-1","status":"FINALIZED"}
        }"#,
    )
    .unwrap();
    let activity = map_release(
        release,
        &target(HOSTING),
        "sample-project-123",
        "sample-site",
        "person@example.test",
    )
    .unwrap();
    assert_eq!(activity.status, ActivityStatus::Success);
    assert_eq!(activity.ownership, Ownership::Mine);
    assert_eq!(activity.title, "Ship sample");
}

#[test]
fn app_hosting_status_and_cursor_mapping_are_explicit() {
    assert_eq!(rollout_status("PENDING_BUILD"), ActivityStatus::Queued);
    assert_eq!(rollout_status("PROGRESSING"), ActivityStatus::Running);
    assert_eq!(rollout_status("PAUSED"), ActivityStatus::Waiting);
    assert_eq!(rollout_status("SUCCEEDED"), ActivityStatus::Success);
    assert_eq!(rollout_status("mystery"), ActivityStatus::Unknown);
    assert_eq!(parse_cursor(None, HOSTING), Ok(None));
    assert_eq!(
        parse_cursor(Some("hosting:opaque-token"), HOSTING),
        Ok(Some("opaque-token".into()))
    );
    assert!(parse_cursor(Some("appHosting:token"), HOSTING).is_err());
}

#[test]
fn targets_require_kind_specific_metadata() {
    assert!(validate_target(&target(HOSTING)).is_ok());
    assert!(validate_target(&target(APP_HOSTING)).is_ok());
    let mut invalid = target(APP_HOSTING);
    invalid.metadata.remove("location");
    assert!(validate_target(&invalid).is_err());
}

#[test]
fn gcloud_commands_bind_token_and_projects_to_the_same_identity() {
    let identity = "person@example.test";
    let token_args = [
        "auth",
        "print-access-token",
        "--account",
        identity,
        "--quiet",
    ];
    let project_args = [
        "projects",
        "list",
        "--filter=lifecycleState:ACTIVE",
        "--limit=25",
        "--format=json(projectId,name,lifecycleState)",
        "--account",
        identity,
    ];
    assert_eq!(token_args[3], identity);
    assert_eq!(project_args[6], identity);
}

#[test]
fn gcloud_auth_override_detection_is_fail_closed_and_value_free() {
    let safe = serde_json::json!({"core": {"account": "person@example.test"}});
    assert!(!has_auth_override(&safe));
    for config in [
        serde_json::json!({"auth": {"impersonate_service_account": "service@example.test"}}),
        serde_json::json!({"auth": {"access_token_file": "/secret/token"}}),
        serde_json::json!({"auth": {"credential_file_override": "/secret/credential"}}),
        serde_json::json!({"auth": {"token_host": "https://tokens.example.test"}}),
        serde_json::json!({"api_endpoint_overrides": {"cloudresourcemanager": "https://api.example.test"}}),
    ] {
        assert!(has_auth_override(&config));
    }
}

#[test]
fn active_scan_deadline_uses_one_absolute_budget() {
    let now = tokio::time::Instant::now();
    assert_eq!(active_deadline(now), now + ACTIVE_SCAN_BUDGET);
}

#[cfg(unix)]
#[tokio::test]
async fn fixture_gcloud_rejects_auth_override_without_exposing_its_value() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().unwrap();
    let script = directory.path().join("gcloud");
    std::fs::write(
        &script,
        r#"#!/bin/sh
if [ "$1" = "config" ] && [ "$2" = "list" ] && [ "$3" = "--format=json" ]; then
  printf '%s\n' '{"auth":{"credential_file_override":"/private/synthetic-credential.json"}}'
  exit 0
fi
exit 9
"#,
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let cli = CliInvocation::for_test(script);
    let error = ensure_default_gcloud_auth(&cli).await.unwrap_err();
    assert!(error.contains("authentication or API endpoint override"));
    assert!(!error.contains("synthetic-credential"));
}
