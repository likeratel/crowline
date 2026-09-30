use serde::Deserialize;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Discovery, Provider, Target},
};

use super::{
    failed_connection, missing_cli, unavailable_connection, unavailable_discovery, unavailable_page,
};

const UNAVAILABLE: &str = "Firebase deployment monitoring is unavailable through the standard Firebase CLI session. The CLI can discover projects, Hosting sites/channels, and App Hosting backends, but it does not expose Hosting release history or App Hosting rollout history as read-only list commands. crowline does not extract CLI credentials to call those REST APIs directly.";

#[derive(Debug, Deserialize, Eq, PartialEq)]
struct ProjectsEnvelope {
    status: String,
    result: Vec<FirebaseProject>,
}

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct FirebaseProject {
    project_id: String,
    display_name: String,
}

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let connection = connection(cli, account).await;
    unavailable_discovery(connection, account, UNAVAILABLE)
}

pub async fn connection(
    cli: Option<&CliInvocation>,
    account: &Account,
) -> crate::models::Connection {
    if account.provider != Provider::Firebase {
        return failed_connection(account, None, "Firebase", CliError::InvalidOutput);
    }
    let Some(cli) = cli else {
        return missing_cli(account, "Firebase");
    };
    let version = cli.version().await;
    match cli.json::<ProjectsEnvelope>(projects_list_args()).await {
        Ok(response) if valid_projects_response(&response) => {
            unavailable_connection(account, version, None, UNAVAILABLE)
        }
        Ok(_) => failed_connection(account, version, "Firebase", CliError::InvalidOutput),
        Err(error) => failed_connection(account, version, "Firebase", error),
    }
}

pub async fn page(
    _cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    if target.provider != Provider::Firebase {
        return Err(CliError::InvalidOutput);
    }
    unavailable_page(target, cursor, UNAVAILABLE)
}

fn projects_list_args() -> &'static [&'static str] {
    &["projects:list", "--json", "--non-interactive"]
}

fn valid_projects_response(response: &ProjectsEnvelope) -> bool {
    response.status == "success"
        && response.result.iter().all(|project| {
            valid_project_id(&project.project_id)
                && !project.display_name.trim().is_empty()
                && !project.display_name.contains('\0')
        })
}

fn valid_project_id(value: &str) -> bool {
    (6..=63).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b':' | b'.')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_synthetic_project_list_response() {
        let response: ProjectsEnvelope = serde_json::from_str(
            r#"{
                "status": "success",
                "result": [
                    {"projectId": "sample-mobile-123", "displayName": "Sample Mobile"}
                ]
            }"#,
        )
        .expect("synthetic Firebase response");

        assert!(valid_projects_response(&response));
        assert_eq!(response.result[0].project_id, "sample-mobile-123");
    }

    #[test]
    fn rejects_failed_or_malformed_project_responses() {
        let failed: ProjectsEnvelope = serde_json::from_str(r#"{"status":"error","result":[]}"#)
            .expect("synthetic Firebase error response");
        let malformed: ProjectsEnvelope = serde_json::from_str(
            r#"{
                "status":"success",
                "result":[{"projectId":"../secret","displayName":"Bad"}]
            }"#,
        )
        .expect("synthetic malformed Firebase response");

        assert!(!valid_projects_response(&failed));
        assert!(!valid_projects_response(&malformed));
    }

    #[test]
    fn project_probe_uses_only_read_only_flags() {
        assert_eq!(
            projects_list_args(),
            &["projects:list", "--json", "--non-interactive"]
        );
    }
}
