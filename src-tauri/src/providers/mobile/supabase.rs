use serde::Deserialize;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Discovery, Provider, Target},
};

use super::{
    failed_connection, missing_cli, unavailable_connection, unavailable_discovery, unavailable_page,
};

const UNAVAILABLE: &str = "Supabase Edge Function deployment monitoring is unavailable: the CLI and Management API list only each function's current ACTIVE status, version, and update time. They do not provide deployment attempts or immutable deployment history, so failed and superseded deployments cannot be represented reliably. Use the GitHub or GitLab CI provider for deployment history.";

#[derive(Debug, Deserialize, Eq, PartialEq)]
struct SupabaseProject {
    id: String,
    name: String,
}

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let connection = connection(cli, account).await;
    unavailable_discovery(connection, account, UNAVAILABLE)
}

pub async fn connection(
    cli: Option<&CliInvocation>,
    account: &Account,
) -> crate::models::Connection {
    if account.provider != Provider::Supabase {
        return failed_connection(account, None, "Supabase", CliError::InvalidOutput);
    }
    let Some(cli) = cli else {
        return missing_cli(account, "Supabase");
    };
    let version = cli.version().await;
    match cli.json::<Vec<SupabaseProject>>(projects_list_args()).await {
        Ok(projects) if valid_projects_response(&projects) => {
            unavailable_connection(account, version, None, UNAVAILABLE)
        }
        Ok(_) => failed_connection(account, version, "Supabase", CliError::InvalidOutput),
        Err(error) => failed_connection(account, version, "Supabase", error),
    }
}

pub async fn page(
    _cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    if target.provider != Provider::Supabase {
        return Err(CliError::InvalidOutput);
    }
    unavailable_page(target, cursor, UNAVAILABLE)
}

fn projects_list_args() -> &'static [&'static str] {
    &["projects", "list", "--output", "json"]
}

fn valid_projects_response(projects: &[SupabaseProject]) -> bool {
    projects
        .iter()
        .all(|project| valid_project_ref(&project.id) && valid_name(&project.name))
}

fn valid_project_ref(value: &str) -> bool {
    value.len() == 20
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn valid_name(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512 && !value.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_synthetic_project_list_response() {
        let response: Vec<SupabaseProject> = serde_json::from_str(
            r#"[
                {"id":"abcdefghijklmnopqrst","name":"Sample Edge API"}
            ]"#,
        )
        .expect("synthetic Supabase response");

        assert!(valid_projects_response(&response));
        assert_eq!(response[0].id, "abcdefghijklmnopqrst");
    }

    #[test]
    fn rejects_malformed_project_metadata() {
        let response: Vec<SupabaseProject> =
            serde_json::from_str(r#"[{"id":"../../credentials","name":"Sample"}]"#)
                .expect("synthetic malformed Supabase response");

        assert!(!valid_projects_response(&response));
    }

    #[test]
    fn project_probe_is_read_only_and_machine_readable() {
        assert_eq!(
            projects_list_args(),
            &["projects", "list", "--output", "json"]
        );
    }
}
