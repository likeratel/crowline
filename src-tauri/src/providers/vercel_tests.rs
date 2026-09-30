use super::*;

#[tokio::test]
async fn unused_provider_never_requires_authentication() {
    let (activities, issues) = collect(None, &[], 24, "vercel:local").await;
    assert!(activities.is_empty());
    assert!(issues.is_empty());
}

#[test]
fn status_mapping_covers_known_vercel_states() {
    assert_eq!(vercel_status("QUEUED"), Ok(ActivityStatus::Queued));
    assert_eq!(vercel_status("BUILDING"), Ok(ActivityStatus::Running));
    assert_eq!(vercel_status("BLOCKED"), Ok(ActivityStatus::Skipped));
    assert_eq!(vercel_status("READY"), Ok(ActivityStatus::Success));
    assert_eq!(vercel_status("ERROR"), Ok(ActivityStatus::Failed));
    assert_eq!(vercel_status("NEW_STATE"), Err(CliError::InvalidOutput));
}

#[test]
fn attribution_requires_comparable_creator_identity() {
    let creator = Creator {
        uid: None,
        username: Some("person".into()),
    };
    assert_eq!(
        deployment_ownership(
            Some(&creator),
            VerifiedIdentity {
                uid: Some("user_123"),
                username: None,
            },
        ),
        Ownership::Unknown
    );
    assert_eq!(
        deployment_ownership(
            Some(&creator),
            VerifiedIdentity {
                uid: None,
                username: Some("person"),
            },
        ),
        Ownership::Mine
    );
    assert_eq!(
        deployment_ownership(
            None,
            VerifiedIdentity {
                uid: None,
                username: Some("person"),
            },
        ),
        Ownership::Unknown
    );
}

#[test]
fn ids_and_cursors_reject_query_injection() {
    assert!(validate_vercel_id("prj_123-Abc").is_ok());
    assert!(validate_vercel_id("prj_123&teamId=other").is_err());
    assert!(validate_scope("demo-team").is_ok());
    assert!(validate_scope("demo-team --token secret").is_err());
    let numeric = Pagination {
        next: Some(serde_json::json!(1_700_000_000_000_i64)),
    };
    let invalid = Pagination {
        next: Some(serde_json::json!("12&teamId=other")),
    };
    assert_eq!(pagination_cursor(numeric), Ok(Some("1700000000000".into())));
    assert_eq!(pagination_cursor(invalid), Err(CliError::InvalidOutput));
}

fn target() -> Target {
    Target {
        id: "team_123:prj_123".into(),
        provider: Provider::Vercel,
        connection_id: "vercel:local".into(),
        name: "rocket".into(),
        description: None,
        metadata: HashMap::from([
            ("projectId".into(), "prj_123".into()),
            ("scopeSlug".into(), "demo-team".into()),
            ("teamId".into(), "team_123".into()),
        ]),
    }
}

#[test]
fn terminal_deployment_without_timestamps_uses_dashboard_and_no_finished_time() {
    let deployment = Deployment {
        uid: "dpl_123".into(),
        name: "rocket".into(),
        inspector_url: None,
        created: 1_700_000_000_000,
        ready: None,
        updated_at: None,
        state: "ERROR".into(),
        creator: None,
        meta: HashMap::new(),
        target: Some("production".into()),
    };
    let activity = map_deployment(
        deployment,
        &target(),
        VerifiedIdentity {
            uid: None,
            username: None,
        },
    )
    .expect("map deployment");
    assert_eq!(activity.finished_at, None);
    assert_eq!(activity.url, "https://vercel.com/demo-team/rocket/dpl_123");
}

#[test]
fn recent_page_uses_v7_until_cursor_and_one_twenty_item_request() {
    assert_eq!(
        deployment_endpoint("prj_123", RECENT_PAGE_SIZE, None, None),
        Ok("/v7/deployments?projectId=prj_123&limit=20".into())
    );
    assert_eq!(
        deployment_endpoint("prj_123", RECENT_PAGE_SIZE, Some("1700000000000"), None),
        Ok("/v7/deployments?projectId=prj_123&limit=20&until=1700000000000".into())
    );
    assert_eq!(
        deployment_endpoint("prj_123", RECENT_PAGE_SIZE, Some("1&state=READY"), None),
        Err(CliError::InvalidOutput)
    );
}

#[test]
fn active_probe_plan_is_three_supported_state_queries_per_round() {
    let endpoints = ACTIVE_STATES
        .iter()
        .map(|state| deployment_endpoint("prj_123", PAGE_SIZE, None, Some(state)))
        .collect::<Result<Vec<_>, _>>()
        .expect("active endpoints");
    assert_eq!(endpoints.len(), 3);
    assert_eq!(MAX_ACTIVE_DEPLOYMENT_PAGES * endpoints.len(), 6);
    assert!(endpoints
        .iter()
        .any(|endpoint| endpoint.ends_with("state=BUILDING")));
    assert!(endpoints
        .iter()
        .all(|endpoint| endpoint.contains("limit=100")));
}

#[test]
fn synthetic_deployment_response_parses_and_rejects_untrusted_console_link() {
    let response: DeploymentsResponse = serde_json::from_value(serde_json::json!({
        "deployments": [{
            "uid": "dpl_456",
            "name": "rocket",
            "inspectorUrl": "https://vercel.com.example.invalid/demo/rocket/dpl_456",
            "created": 1700000000000_i64,
            "ready": 1700000060000_i64,
            "updatedAt": 1700000060000_i64,
            "state": "READY",
            "creator": { "uid": "user_123", "username": "sample-user" },
            "meta": { "githubCommitRef": "main" },
            "target": "production"
        }],
        "pagination": { "next": 1699999999999_i64 }
    }))
    .expect("synthetic response");
    assert_eq!(
        pagination_cursor(response.pagination),
        Ok(Some("1699999999999".into()))
    );
    let activity = map_deployment(
        response.deployments.into_iter().next().expect("deployment"),
        &target(),
        VerifiedIdentity {
            uid: None,
            username: Some("sample-user"),
        },
    )
    .expect("map deployment");
    assert_eq!(activity.status, ActivityStatus::Success);
    assert_eq!(activity.ownership, Ownership::Mine);
    assert_eq!(activity.url, "https://vercel.com/demo-team/rocket/dpl_456");
}
