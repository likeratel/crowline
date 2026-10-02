use super::*;

fn credential() -> BitbucketCredential {
    BitbucketCredential {
        email: "person@example.invalid".into(),
        token: "token".into(),
        uuid: "{mine}".into(),
        account_id: "mine-id".into(),
        display_name: "Service Person".into(),
    }
}

fn target() -> Target {
    Target {
        id: "workspace/repository".into(),
        provider: Provider::Bitbucket,
        connection_id: format!("bitbucket:{}", uuid::Uuid::new_v4()),
        name: "Repository".into(),
        description: None,
        metadata: HashMap::from([
            ("workspace".into(), "workspace".into()),
            ("repoSlug".into(), "repository".into()),
        ]),
    }
}

#[test]
fn maps_unknown_status_and_missing_actor_without_inventing_ownership() {
    let pipeline: Pipeline = serde_json::from_str(r#"{"uuid":"{pipeline}","build_number":7,"state":{"name":"ALIEN"},"target":{"ref_name":"main","commit":{"message":"Ship"}},"created_on":"2026-09-30T00:00:00Z","links":{"html":{"href":"https://bitbucket.org/workspace/repository/pipelines/results/7"}}}"#).unwrap();
    let activity = pipeline_activity(pipeline, &target(), &credential()).unwrap();
    assert_eq!(activity.status, ActivityStatus::Unknown);
    assert_eq!(activity.actor, None);
    assert_eq!(activity.ownership, Ownership::Unknown);
}

#[test]
fn ownership_uses_uuid_or_account_id_instead_of_display_name() {
    let pipeline: Pipeline = serde_json::from_str(r#"{"uuid":"{pipeline}","build_number":7,"creator":{"uuid":"{other}","account_id":"mine-id","display_name":"Different Label"},"state":{"name":"COMPLETED","result":{"name":"SUCCESSFUL"}},"created_on":"2026-09-30T00:00:00Z","completed_on":"2026-09-30T00:01:00Z","links":{"html":{"href":"https://bitbucket.org/workspace/repository/pipelines/results/7"}}}"#).unwrap();
    let activity = pipeline_activity(pipeline, &target(), &credential()).unwrap();
    assert_eq!(activity.ownership, Ownership::Mine);
    assert_eq!(activity.actor.as_deref(), Some("Different Label"));
}

#[test]
fn cursor_and_remote_next_url_are_strictly_validated() {
    assert_eq!(parse_cursor(Some("2")).unwrap(), 2);
    assert!(parse_cursor(Some("0")).is_err());
    assert!(parse_cursor(Some("2&token=secret")).is_err());
    assert!(validated_next_page(
        Some("https://evil.example/2.0/user/workspaces?page=2"),
        &["user", "workspaces"]
    )
    .is_err());
    assert!(validated_next_page(
        Some("https://api.bitbucket.org/2.0/repositories/other?page=2"),
        &["user", "workspaces"]
    )
    .is_err());
    assert_eq!(
        validated_next_page(
            Some("https://api.bitbucket.org/2.0/user/workspaces?pagelen=100&page=2"),
            &["user", "workspaces"]
        )
        .unwrap()
        .as_deref(),
        Some("2")
    );
}

#[test]
fn in_progress_paused_stage_maps_to_waiting_and_preserves_raw_stage() {
    let state: PipelineState =
        serde_json::from_str(r#"{"name":"IN_PROGRESS","stage":{"name":"PAUSED"}}"#).unwrap();
    assert_eq!(pipeline_status(&state), ActivityStatus::Waiting);
    assert_eq!(raw_pipeline_status(&state), "IN_PROGRESS:PAUSED");
}

#[test]
fn blank_creator_ids_do_not_claim_other_ownership() {
    let pipeline: Pipeline = serde_json::from_str(r#"{"uuid":"{pipeline}","build_number":7,"creator":{"uuid":" ","account_id":"","display_name":"Label"},"state":{"name":"PENDING"},"created_on":"2026-09-30T00:00:00Z","links":{"html":{"href":"https://bitbucket.org/workspace/repository/pipelines/results/7"}}}"#).unwrap();
    assert_eq!(
        pipeline_activity(pipeline, &target(), &credential())
            .unwrap()
            .ownership,
        Ownership::Unknown
    );
}

#[test]
fn paginated_response_requires_values_instead_of_false_empty_success() {
    assert!(serde_json::from_str::<Page<Repository>>(r#"{"page":1}"#).is_err());
}

#[test]
fn active_status_filters_use_supported_api_values() {
    let statuses = ["BUILDING", "PENDING", "PAUSED", "HALTED"];
    assert!(!statuses.contains(&"IN_PROGRESS"));
}
#[test]
fn only_custom_selectors_supply_pipeline_names() {
    for (selector, expected) in [
        (
            serde_json::json!({"type":"custom", "pattern":" Deploy production "}),
            Some("Deploy production"),
        ),
        (
            serde_json::json!({"type":"branches", "pattern":"release/*"}),
            None,
        ),
        (serde_json::json!({"type":"custom", "pattern":" "}), None),
        (serde_json::Value::Null, None),
    ] {
        let pipeline: Pipeline = serde_json::from_value(serde_json::json!({
            "uuid":"{pipeline}", "build_number":7, "state":{"name":"PENDING"},
            "target":{"ref_name":"main", "selector":selector, "commit":{"message":"Ship checkout"}},
            "created_on":"2026-09-30T00:00:00Z",
            "links":{"html":{"href":"https://bitbucket.org/workspace/repository/pipelines/results/7"}}
        })).unwrap();
        let activity = pipeline_activity(pipeline, &target(), &credential()).unwrap();
        assert_eq!(activity.workflow_name.as_deref(), expected);
        assert_eq!(activity.title, "Ship checkout");
    }
}

#[test]
fn pipeline_pages_without_html_links_still_open_the_run() {
    for links in [
        serde_json::json!({"self":{"href":"https://api.bitbucket.org/2.0/repositories/workspace/repository/pipelines/example"},"steps":{"href":"https://api.bitbucket.org/2.0/repositories/workspace/repository/pipelines/example/steps"}}),
        serde_json::json!({}),
        serde_json::Value::Null,
    ] {
        let response = serde_json::json!({"values":[{
            "uuid":"{pipeline}","build_number":7,
            "state":{"name":"IN_PROGRESS","stage":{"name":"HALTED"}},
            "created_on":"2026-10-02T00:00:00Z","links":links
        }]});
        let page: Page<Pipeline> = serde_json::from_value(response).unwrap();
        let activity = pipeline_activity(
            page.values.into_iter().next().unwrap(),
            &target(),
            &credential(),
        )
        .unwrap();
        assert_eq!(
            activity.url,
            "https://bitbucket.org/workspace/repository/pipelines/results/7"
        );
        assert_eq!(activity.status, ActivityStatus::Waiting);
    }
}

#[test]
fn an_unsafe_supplied_pipeline_link_is_not_replaced_by_a_fallback() {
    let pipeline: Pipeline = serde_json::from_value(serde_json::json!({
        "uuid":"{pipeline}","build_number":7,"state":{"name":"PENDING"},
        "created_on":"2026-10-02T00:00:00Z",
        "links":{"html":{"href":"https://untrusted.invalid/run"}}
    }))
    .unwrap();
    assert!(pipeline_activity(pipeline, &target(), &credential()).is_err());
}

#[test]
fn pipeline_pagination_accepts_only_the_selected_repository_uuid_alias() {
    let mut target = target();
    target.metadata.insert(
        "uuid".into(),
        "{22222222-2222-4222-8222-222222222222}".into(),
    );
    let path = "https://api.bitbucket.org/2.0/repositories/%7B11111111-1111-4111-8111-111111111111%7D/%7B22222222-2222-4222-8222-222222222222%7D/pipelines/?page=2&pagelen=20";
    assert_eq!(
        validated_pipeline_next_page(Some(path), &target)
            .unwrap()
            .as_deref(),
        Some("2")
    );
    for invalid in [
        path.replace("22222222", "33333333"),
        path.replace("api.bitbucket.org", "untrusted.invalid"),
        path.replace("/pipelines/", "/downloads/"),
        path.replace("page=2", "page=invalid"),
        path.replace(
            "%7B11111111-1111-4111-8111-111111111111%7D",
            "unrelated-workspace",
        ),
    ] {
        assert!(validated_pipeline_next_page(Some(&invalid), &target).is_err());
    }
    assert_eq!(
        validated_pipeline_next_page(
            Some(
                "https://api.bitbucket.org/2.0/repositories/workspace/repository/pipelines?page=3"
            ),
            &target
        )
        .unwrap()
        .as_deref(),
        Some("3")
    );
}
