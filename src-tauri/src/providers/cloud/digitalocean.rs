use std::collections::HashMap;

use serde::Deserialize;
use uuid::Uuid;

use crate::{
    cli::{CliError, CliInvocation},
    models::{
        Account, Activity, ActivityPage, ActivityStatus, Connection, ConnectionStatus, Discovery,
        Ownership, Provider, Target,
    },
};

use super::support::{
    capped_targets, discovery_from_connection, failed_connection, issue, metadata, missing_cli,
    parse_timestamp, provider_url, terminal_time, validate_target, PAGE_SIZE,
};

const PROVIDER: Provider = Provider::Digitalocean;
const LABEL: &str = "DigitalOcean";

#[derive(Deserialize)]
struct DoAccount {
    email: String,
}

#[derive(Deserialize)]
struct App {
    id: String,
    spec: AppSpec,
    #[serde(default)]
    default_ingress: Option<String>,
}

#[derive(Deserialize)]
struct AppSpec {
    name: String,
}

#[derive(Deserialize)]
struct Deployment {
    id: String,
    cause: String,
    phase: String,
    created_at: String,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    phase_last_updated_at: Option<String>,
}

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let Some(cli) = cli else {
        return missing_cli(account, PROVIDER, LABEL);
    };
    let connection = connection(Some(cli), account).await;
    if connection.status != ConnectionStatus::Connected {
        return discovery_from_connection(connection);
    }
    let apps: Vec<App> = match cli.json(&["apps", "list", "--output", "json"]).await {
        Ok(apps) => apps,
        Err(error) => {
            return discovery_from_connection(failed_connection(
                account,
                PROVIDER,
                LABEL,
                connection.cli_version,
                error,
            ))
        }
    };
    let mut issues = Vec::new();
    let targets = apps
        .into_iter()
        .filter_map(|app| match app_target(app, &account.id) {
            Ok(target) => Some(target),
            Err(_) => {
                issues.push(issue(
                    PROVIDER,
                    &account.id,
                    None,
                    "DigitalOcean returned an App Platform app with invalid metadata; it was skipped.",
                ));
                None
            }
        })
        .collect();
    let (targets, issues) = capped_targets(PROVIDER, account, targets, issues);
    Discovery {
        connection,
        targets,
        aws_profiles: Vec::new(),
        issues,
    }
}

pub async fn connection(cli: Option<&CliInvocation>, account: &Account) -> Connection {
    let Some(cli) = cli else {
        return missing_cli(account, PROVIDER, LABEL).connection;
    };
    let version = cli.version().await;
    match cli
        .json::<DoAccount>(&["account", "get", "--output", "json"])
        .await
    {
        Ok(user) if !user.email.trim().is_empty() => Connection {
            connection_id: account.id.clone(),
            provider: PROVIDER,
            status: ConnectionStatus::Connected,
            account: Some(user.email),
            message: Some(
                "DigitalOcean App Platform uses the existing doctl context. doctl may fetch full deployment history before crowline keeps the latest 20."
                    .into(),
            ),
            cli_version: version,
        },
        Ok(_) => failed_connection(
            account,
            PROVIDER,
            LABEL,
            version,
            CliError::InvalidOutput,
        ),
        Err(error) => failed_connection(account, PROVIDER, LABEL, version, error),
    }
}

pub async fn page(
    cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    validate_target(target, PROVIDER)?;
    if cursor.is_some() {
        return Err(CliError::InvalidOutput);
    }
    let app_id = metadata(target, "app_id")?;
    let app_name = metadata(target, "app_name")?;
    if Uuid::parse_str(app_id).is_err() || app_name.trim().is_empty() {
        return Err(CliError::InvalidOutput);
    }
    let args = deployment_args(app_id);
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let deployments: Vec<Deployment> = cli.json(&refs).await?;
    map_deployments(deployments, target, app_id, app_name)
}

fn deployment_args(app_id: &str) -> Vec<String> {
    vec![
        "apps".into(),
        "list-deployments".into(),
        app_id.into(),
        "--output".into(),
        "json".into(),
    ]
}

fn app_target(app: App, connection_id: &str) -> Result<Target, CliError> {
    if Uuid::parse_str(&app.id).is_err() || app.spec.name.trim().is_empty() {
        return Err(CliError::InvalidOutput);
    }
    Ok(Target {
        id: format!("digitalocean:{}", app.id),
        provider: PROVIDER,
        connection_id: connection_id.into(),
        name: app.spec.name.clone(),
        description: app.default_ingress,
        metadata: HashMap::from([
            ("app_id".into(), app.id),
            ("app_name".into(), app.spec.name),
        ]),
    })
}

fn map_deployments(
    deployments: Vec<Deployment>,
    target: &Target,
    app_id: &str,
    app_name: &str,
) -> Result<ActivityPage, CliError> {
    let mut issues = Vec::new();
    let mut activities = deployments
        .into_iter()
        .map(|deployment| map_deployment(deployment, target, app_id, app_name, &mut issues))
        .collect::<Result<Vec<_>, _>>()?;
    activities.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    let truncated = activities.len() > PAGE_SIZE;
    activities.truncate(PAGE_SIZE);
    issues.push(issue(
        PROVIDER,
        &target.connection_id,
        Some(&target.id),
        if truncated {
            "doctl list-deployments may fetch the full deployment history and exposes no limit or cursor; crowline kept the latest 20 returned deployments, so older deployments are omitted."
        } else {
            "doctl list-deployments may fetch the full deployment history and exposes no limit or cursor; the read remains subject to crowline's CLI timeout and output-size limits."
        },
    ));
    Ok(ActivityPage {
        activities,
        next_cursor: None,
        issues,
    })
}

fn map_deployment(
    deployment: Deployment,
    target: &Target,
    app_id: &str,
    app_name: &str,
    issues: &mut Vec<crate::models::Issue>,
) -> Result<Activity, CliError> {
    if Uuid::parse_str(&deployment.id).is_err() || deployment.cause.trim().is_empty() {
        return Err(CliError::InvalidOutput);
    }
    let started_at = parse_timestamp(&deployment.created_at)?;
    let updated_raw = deployment
        .phase_last_updated_at
        .as_deref()
        .or(deployment.updated_at.as_deref())
        .ok_or(CliError::InvalidOutput)?;
    let updated_at = parse_timestamp(updated_raw)?;
    let status = deployment_status(&deployment.phase);
    if status == ActivityStatus::Unknown {
        issues.push(issue(
            PROVIDER,
            &target.connection_id,
            Some(&target.id),
            format!(
                "DigitalOcean deployment {} has an unrecognized phase '{}'.",
                deployment.id, deployment.phase
            ),
        ));
    }
    Ok(Activity {
        id: format!("digitalocean:{}:{}", app_id, deployment.id),
        provider: PROVIDER,
        connection_id: target.connection_id.clone(),
        target_id: target.id.clone(),
        kind: "app-platform-deployment".into(),
        title: deployment.cause,
        project: app_name.into(),
        branch: None,
        url: provider_url(
            "cloud.digitalocean.com",
            &["apps", app_id, "deployments", &deployment.id],
        )?,
        status,
        raw_status: deployment.phase,
        actor: None,
        ownership: Ownership::Unknown,
        started_at,
        finished_at: terminal_time(status, &updated_at),
        updated_at,
    })
}

fn deployment_status(phase: &str) -> ActivityStatus {
    match phase {
        "PENDING_BUILD" | "PENDING_DEPLOY" | "PENDING" => ActivityStatus::Queued,
        "BUILDING" | "DEPLOYING" => ActivityStatus::Running,
        "ACTIVE" => ActivityStatus::Success,
        "ERROR" => ActivityStatus::Failed,
        "CANCELED" | "CANCELLED" | "SUPERSEDED" => ActivityStatus::Canceled,
        _ => ActivityStatus::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> Target {
        Target {
            id: "digitalocean:00000000-0000-4000-8000-000000000001".into(),
            provider: PROVIDER,
            connection_id: "digitalocean:local".into(),
            name: "example-app".into(),
            description: None,
            metadata: HashMap::from([
                (
                    "app_id".into(),
                    "00000000-0000-4000-8000-000000000001".into(),
                ),
                ("app_name".into(), "example-app".into()),
            ]),
        }
    }

    #[test]
    fn parses_app_platform_deployment_fixture() {
        let fixture = r#"[{
          "id":"00000000-0000-4000-8000-000000000002", "cause":"commit abc123",
          "phase":"ACTIVE", "created_at":"2026-09-28T10:00:00Z",
          "phase_last_updated_at":"2026-09-28T10:03:00Z"
        }]"#;
        let deployments: Vec<Deployment> = serde_json::from_str(fixture).expect("fixture");
        let page = map_deployments(
            deployments,
            &target(),
            "00000000-0000-4000-8000-000000000001",
            "example-app",
        )
        .expect("page");
        assert_eq!(page.activities[0].status, ActivityStatus::Success);
        assert_eq!(page.activities[0].ownership, Ownership::Unknown);
        assert!(page.activities[0]
            .url
            .starts_with("https://cloud.digitalocean.com/"));
    }

    #[test]
    fn unpaginated_history_is_reported_without_a_cursor() {
        let fixture = r#"[{
          "id":"00000000-0000-4000-8000-000000000002", "cause":"commit abc123",
          "phase":"ACTIVE", "created_at":"2026-09-28T10:00:00Z",
          "phase_last_updated_at":"2026-09-28T10:03:00Z"
        }]"#;
        let deployments: Vec<Deployment> = serde_json::from_str(fixture).expect("fixture");
        let page = map_deployments(
            deployments,
            &target(),
            "00000000-0000-4000-8000-000000000001",
            "example-app",
        )
        .expect("page");
        assert_eq!(page.activities.len(), 1);
        assert!(page.next_cursor.is_none());
        assert!(page.issues[0]
            .message
            .contains("may fetch the full deployment history"));
        let args = deployment_args("00000000-0000-4000-8000-000000000001");
        assert_eq!(
            args[0..3],
            [
                "apps",
                "list-deployments",
                "00000000-0000-4000-8000-000000000001"
            ]
        );
        assert_eq!(deployment_status("DEPLOYING"), ActivityStatus::Running);
        assert_eq!(
            deployment_status("SERVICE_RUNNING"),
            ActivityStatus::Unknown
        );
    }
}
