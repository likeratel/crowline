use std::collections::HashMap;

use serde::Deserialize;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Connection, Discovery, Provider, Target},
};

use super::{cloudflare, support};

const LABEL: &str = "Cloudflare Wrangler";

#[derive(Deserialize)]
struct ProjectRow {
    #[serde(rename = "Project Name")]
    name: String,
    #[serde(rename = "Project Domains")]
    domains: String,
}

#[derive(Deserialize)]
struct DeploymentDisplayRow {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Status")]
    status: String,
}

pub async fn connection(cli: Option<&CliInvocation>, account: &Account) -> Connection {
    cloudflare::connection(cli, account).await
}

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let Some(cli) = cli else {
        return support::discovery_from_connection(support::missing_cli(
            account, LABEL, "wrangler",
        ));
    };
    let version = cli.version().await;
    let identity = match cloudflare::identity(cli).await {
        Ok(identity) => identity,
        Err(error) => return support::failed_discovery(account, LABEL, error, version),
    };
    let connection = cloudflare::connected(account, version, &identity);
    let [cloudflare_account] = identity.accounts.as_slice() else {
        return Discovery {
            connection,
            targets: Vec::new(),
            aws_profiles: Vec::new(),
            issues: vec![support::issue(
                Provider::CloudflarePages,
                &account.id,
                None,
                "Wrangler Pages project JSON omits the account ID and provides no account selector. Automatic discovery is disabled when the login can access multiple accounts.",
            )],
        };
    };
    let projects: Vec<ProjectRow> = match cli.json(&["pages", "project", "list", "--json"]).await {
        Ok(projects) => projects,
        Err(error) => {
            return support::failed_discovery(account, LABEL, error, connection.cli_version);
        }
    };
    let mut targets = Vec::new();
    let mut issues = Vec::new();
    for project in projects {
        match project_target(project, cloudflare_account, &account.id) {
            Ok(target) => targets.push(target),
            Err(_) => issues.push(support::issue(
                Provider::CloudflarePages,
                &account.id,
                None,
                "Wrangler returned a Pages project with an invalid name.",
            )),
        }
    }
    issues.push(support::issue(
        Provider::CloudflarePages,
        &account.id,
        None,
        "Pages projects can be selected, but Wrangler's deployment JSON removes deployment timestamps and replaces successful raw status with display text. crowline cannot safely show Pages deployment activity from this CLI contract.",
    ));
    Discovery {
        connection,
        targets,
        aws_profiles: Vec::new(),
        issues,
    }
}

fn project_target(
    project: ProjectRow,
    cloudflare_account: &cloudflare::CloudflareAccount,
    connection_id: &str,
) -> Result<Target, CliError> {
    support::validate_id(&project.name)?;
    if project.domains.len() > 1024 || project.domains.contains('\0') {
        return Err(CliError::InvalidOutput);
    }
    Ok(Target {
        id: format!("{}:{}", cloudflare_account.id, project.name),
        provider: Provider::CloudflarePages,
        connection_id: connection_id.to_owned(),
        name: project.name.clone(),
        description: Some(format!("{} · {}", cloudflare_account.name, project.domains)),
        metadata: HashMap::from([
            ("accountId".into(), cloudflare_account.id.clone()),
            ("projectName".into(), project.name),
        ]),
    })
}

pub async fn page(
    cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    support::reject_cursor(cursor)?;
    let project_name = support::metadata(target, "projectName")?;
    support::metadata(target, "accountId")?;
    let args = deployment_args(project_name);
    let rows: Vec<DeploymentDisplayRow> = cli.json(&args).await?;
    if rows.iter().any(|row| {
        support::validate_id(&row.id).is_err() || support::validate_text(&row.status, 512).is_err()
    }) {
        return Err(CliError::InvalidOutput);
    }
    Ok(ActivityPage {
        activities: Vec::new(),
        next_cursor: None,
        issues: vec![support::issue(
            Provider::CloudflarePages,
            &target.connection_id,
            Some(&target.id),
            format!(
                "Wrangler returned {} Pages deployment row(s), but its JSON omits deployment timestamps and raw successful status. No activity was inferred.",
                rows.len()
            ),
        )],
    })
}

fn deployment_args(project_name: &str) -> [&str; 6] {
    [
        "pages",
        "deployment",
        "list",
        "--project-name",
        project_name,
        "--json",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wranger_display_json_without_treating_it_as_activity() {
        let rows: Vec<DeploymentDisplayRow> = serde_json::from_str(
            r#"[{"Id":"deployment-1","Environment":"Production","Branch":"main","Source":"abcdef1","Deployment":"https://demo.pages.dev","Status":"2 minutes ago","Build":"https://dash.cloudflare.com/account-1/pages/view/demo/deployment-1"}]"#,
        )
        .unwrap();
        assert_eq!(rows[0].id, "deployment-1");
        assert_eq!(rows[0].status, "2 minutes ago");
    }

    #[test]
    fn builds_single_account_target_from_synthetic_project_response() {
        let project: ProjectRow = serde_json::from_str(
            r#"{"Project Name":"demo-pages","Project Domains":"demo.pages.dev","Git Provider":"Yes","Last Modified":"2 minutes ago"}"#,
        )
        .unwrap();
        let target = project_target(
            project,
            &cloudflare::CloudflareAccount {
                id: "account-1".into(),
                name: "Example Account".into(),
            },
            "cloudflare-pages:local",
        )
        .unwrap();
        assert_eq!(target.metadata["projectName"], "demo-pages");
        assert_eq!(target.metadata["accountId"], "account-1");
        assert_eq!(
            deployment_args("demo-pages"),
            [
                "pages",
                "deployment",
                "list",
                "--project-name",
                "demo-pages",
                "--json"
            ]
        );
    }
}
