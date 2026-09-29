use std::collections::HashSet;

use crate::models::{ActivityStatus, Ownership};

use super::support::{
    normalize_cloudformation_status, normalize_ecs_status, ownership_from_observed_actor,
    profile_section, record_latest_stack_operation, selected_profile,
};

#[test]
fn normalizes_cloudformation_and_ecs_deployment_statuses() {
    assert_eq!(
        normalize_cloudformation_status("UPDATE_IN_PROGRESS"),
        ActivityStatus::Running
    );
    assert_eq!(
        normalize_cloudformation_status("UPDATE_ROLLBACK_COMPLETE"),
        ActivityStatus::Failed
    );
    assert_eq!(
        normalize_cloudformation_status("CREATE_COMPLETE"),
        ActivityStatus::Success
    );
    assert_eq!(normalize_ecs_status("IN_PROGRESS"), ActivityStatus::Running);
    assert_eq!(normalize_ecs_status("COMPLETED"), ActivityStatus::Success);
    assert_eq!(normalize_ecs_status("FAILED"), ActivityStatus::Failed);
    assert_eq!(normalize_ecs_status("PRIMARY"), ActivityStatus::Unknown);
}

#[test]
fn shared_iam_role_does_not_establish_activity_ownership() {
    assert_eq!(
        ownership_from_observed_actor(Some(
            "arn:aws:sts::123456789012:assumed-role/Deploy/shared-session"
        )),
        Ownership::Unknown
    );
}

#[test]
fn completed_stack_update_replaces_its_older_running_event() {
    let mut operations = HashSet::new();
    let events = [
        ("update-42", "UPDATE_COMPLETE"),
        ("update-42", "UPDATE_IN_PROGRESS"),
    ];
    let statuses = events
        .into_iter()
        .filter_map(|(operation, status)| {
            record_latest_stack_operation(&mut operations, operation).then_some(status)
        })
        .collect::<Vec<_>>();

    assert_eq!(statuses, vec!["UPDATE_COMPLETE"]);
    assert_eq!(
        normalize_cloudformation_status(statuses[0]),
        ActivityStatus::Success
    );
}

#[test]
fn parses_only_profile_sections_from_shared_config() {
    assert_eq!(
        profile_section("[profile engineering]", true).as_deref(),
        Some("engineering")
    );
    assert_eq!(
        profile_section("[default]", true).as_deref(),
        Some("default")
    );
    assert_eq!(profile_section("[sso-session crowline]", true), None);
    assert_eq!(
        profile_section("[production]", false).as_deref(),
        Some("production")
    );
}

#[test]
fn discovery_requires_an_explicit_profile_selection() {
    assert_eq!(selected_profile(None).expect("optional profile"), None);
    assert_eq!(
        selected_profile(Some("engineering".into())).expect("valid profile"),
        Some("engineering".into())
    );
}
