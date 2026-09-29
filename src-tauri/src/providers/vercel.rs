use std::collections::HashMap;

use chrono::{DateTime, Duration, TimeZone, Utc};
use serde::Deserialize;

use crate::{
    cli::{CliError, CliInvocation},
    models::{
        Activity, ActivityStatus, Connection, ConnectionStatus, Discovery, Issue, Ownership,
        Provider, Target,
    },
};

const MAX_TEAM_PAGES: usize = 3;
const MAX_PROJECT_PAGES: usize = 5;
const MAX_DEPLOYMENT_PAGES: usize = 5;
const PAGE_SIZE: usize = 100;

#[derive(Clone, Deserialize)]
struct UserEnvelope {
    user: VercelUser,
}

#[derive(Clone, Deserialize)]
struct VercelUser {
    id: String,
    username: String,
}

#[derive(Deserialize)]
struct TeamsResponse {
    teams: Vec<Team>,
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
struct Team {
    id: String,
    slug: String,
}

#[derive(Deserialize)]
struct ProjectsResponse {
    projects: Vec<Project>,
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
struct Project {
    id: String,
    name: String,
    #[serde(default)]
    framework: Option<String>,
}

#[derive(Deserialize)]
struct DeploymentsResponse {
    deployments: Vec<Deployment>,
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
struct Pagination {
    next: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Deployment {
    uid: String,
    name: String,
    url: Option<String>,
    inspector_url: Option<String>,
    created: i64,
    ready: Option<i64>,
    updated_at: Option<i64>,
    state: String,
    creator: Option<Creator>,
    #[serde(default)]
    meta: HashMap<String, serde_json::Value>,
    target: Option<String>,
}

#[derive(Deserialize)]
struct Creator {
    uid: Option<String>,
    username: Option<String>,
}

struct ProjectContext {
    project: Project,
    scope_id: Option<String>,
    scope_slug: String,
}

pub async fn discover(cli: Option<&CliInvocation>) -> Discovery {
    let connection = connection(cli).await;
    let Some(cli) = cli.filter(|_| connection.status == ConnectionStatus::Connected) else {
        return Discovery {
            connection,
            targets: Vec::new(),
            aws_profiles: Vec::new(),
            issues: Vec::new(),
        };
    };
    let (teams, teams_truncated) = match discover_teams(cli).await {
        Ok(teams) => teams,
        Err(error) => return failed_discovery(error, connection.cli_version),
    };
    // Current Vercel accounts, including Hobby accounts, keep projects in teams.
    // The CLI explicitly rejects a user's personal username as --scope.
    let contexts = teams.into_iter().map(|team| (Some(team.id), team.slug));
    let mut targets = Vec::new();
    let mut issues = Vec::new();
    if teams_truncated {
        issues.push(Issue {
            provider: Provider::Vercel,
            message: format!(
                "Vercel team discovery reached the {MAX_TEAM_PAGES}-page safety limit."
            ),
            target_id: None,
        });
    }
    for (scope_id, scope_slug) in contexts {
        match discover_projects(cli, scope_id.as_deref(), &scope_slug).await {
            Ok((projects, truncated)) => {
                targets.extend(projects.into_iter().map(project_target));
                if truncated {
                    issues.push(Issue {
                        provider: Provider::Vercel,
                        message: format!(
                            "Vercel project discovery for {scope_slug} reached the {MAX_PROJECT_PAGES}-page safety limit."
                        ),
                        target_id: None,
                    });
                }
            }
            Err(error) => issues.push(Issue {
                provider: Provider::Vercel,
                message: error.user_message("Vercel"),
                target_id: None,
            }),
        }
    }
    Discovery {
        connection,
        targets,
        aws_profiles: Vec::new(),
        issues,
    }
}

pub async fn connection(cli: Option<&CliInvocation>) -> Connection {
    let Some(cli) = cli else {
        return Connection::disconnected(
            Provider::Vercel,
            ConnectionStatus::MissingCli,
            "Vercel CLI 50.29 or newer was not found.",
        );
    };
    let version = cli.version().await;
    match current_user(cli).await {
        Ok(user) => Connection {
            provider: Provider::Vercel,
            status: ConnectionStatus::Connected,
            account: Some(user.username),
            message: None,
            cli_version: version,
        },
        Err(error) => failed_discovery(error, version).connection,
    }
}

async fn discover_teams(cli: &CliInvocation) -> Result<(Vec<Team>, bool), CliError> {
    let mut teams = Vec::new();
    let mut cursor = None;
    for _ in 0..MAX_TEAM_PAGES {
        let mut endpoint = format!("/v2/teams?limit={PAGE_SIZE}");
        if let Some(next) = cursor.as_deref() {
            endpoint.push_str("&until=");
            endpoint.push_str(next);
        }
        // This membership endpoint is account-wide; project/deployment calls below
        // always receive an explicit team scope, independent of currentTeam.
        let response: TeamsResponse = vercel_json(cli, &endpoint, None).await?;
        teams.extend(response.teams);
        cursor = pagination_cursor(response.pagination);
        if cursor.is_none() {
            return Ok((teams, false));
        }
    }
    Ok((teams, cursor.is_some()))
}

async fn discover_projects(
    cli: &CliInvocation,
    scope_id: Option<&str>,
    scope_slug: &str,
) -> Result<(Vec<ProjectContext>, bool), CliError> {
    if let Some(scope) = scope_id {
        validate_vercel_id(scope).map_err(|_| CliError::InvalidOutput)?;
    }
    let mut projects = Vec::new();
    let mut cursor = None;
    for _ in 0..MAX_PROJECT_PAGES {
        let mut endpoint = format!("/v9/projects?limit={PAGE_SIZE}");
        if let Some(next) = cursor.as_deref() {
            endpoint.push_str("&until=");
            endpoint.push_str(next);
        }
        let response: ProjectsResponse = vercel_json(cli, &endpoint, Some(scope_slug)).await?;
        projects.extend(response.projects.into_iter().map(|project| ProjectContext {
            project,
            scope_id: scope_id.map(str::to_owned),
            scope_slug: scope_slug.to_owned(),
        }));
        cursor = pagination_cursor(response.pagination);
        if cursor.is_none() {
            return Ok((projects, false));
        }
    }
    Ok((projects, cursor.is_some()))
}

fn project_target(context: ProjectContext) -> Target {
    let description = Some(match context.project.framework.as_deref() {
        Some(framework) => format!("{} · {framework}", context.scope_slug),
        None => context.scope_slug.clone(),
    });
    let id = match context.scope_id.as_deref() {
        Some(scope) => format!("{scope}:{}", context.project.id),
        None => format!("personal:{}", context.project.id),
    };
    let mut metadata = HashMap::from([
        ("projectId".into(), context.project.id),
        ("scopeSlug".into(), context.scope_slug),
    ]);
    if let Some(scope) = context.scope_id {
        metadata.insert("teamId".into(), scope);
    }
    Target {
        id,
        provider: Provider::Vercel,
        name: context.project.name,
        description,
        metadata,
    }
}

fn failed_discovery(error: CliError, version: Option<String>) -> Discovery {
    let status = match error {
        CliError::SignedOut => ConnectionStatus::SignedOut,
        CliError::Unavailable => ConnectionStatus::MissingCli,
        _ => ConnectionStatus::Error,
    };
    Discovery {
        connection: Connection {
            provider: Provider::Vercel,
            status,
            account: None,
            message: Some(error.user_message("Vercel")),
            cli_version: version,
        },
        targets: Vec::new(),
        aws_profiles: Vec::new(),
        issues: Vec::new(),
    }
}

pub async fn collect(
    cli: Option<&CliInvocation>,
    targets: &[Target],
    history_hours: u32,
) -> (Vec<Activity>, Vec<Issue>) {
    let Some(cli) = cli else {
        return (
            Vec::new(),
            vec![Issue {
                provider: Provider::Vercel,
                message:
                    "Vercel CLI was not found. Cached Vercel activity is shown when available."
                        .into(),
                target_id: None,
            }],
        );
    };
    let identity = match current_user(cli).await {
        Ok(identity) => Some(identity),
        Err(error) => {
            return (
                Vec::new(),
                vec![Issue {
                    provider: Provider::Vercel,
                    message: error.user_message("Vercel"),
                    target_id: None,
                }],
            )
        }
    };
    let cutoff = Utc::now() - Duration::hours(i64::from(history_hours));
    let mut activities = Vec::new();
    let mut issues = Vec::new();
    for target in targets {
        match collect_project(cli, target, cutoff, identity.as_ref()).await {
            Ok((mut target_activities, truncated)) => {
                activities.append(&mut target_activities);
                if truncated {
                    issues.push(Issue {
                        provider: Provider::Vercel,
                        message: format!(
                            "Vercel history for {} reached the {MAX_DEPLOYMENT_PAGES}-page safety limit. Recent results are partial.",
                            target.name
                        ),
                        target_id: Some(target.id.clone()),
                    });
                }
            }
            Err(error) => issues.push(Issue {
                provider: Provider::Vercel,
                message: error.user_message("Vercel"),
                target_id: Some(target.id.clone()),
            }),
        }
    }
    (activities, issues)
}

async fn collect_project(
    cli: &CliInvocation,
    target: &Target,
    cutoff: DateTime<Utc>,
    identity: Option<&VercelUser>,
) -> Result<(Vec<Activity>, bool), CliError> {
    let project_id = target
        .metadata
        .get("projectId")
        .ok_or(CliError::InvalidOutput)?;
    validate_vercel_id(project_id).map_err(|_| CliError::InvalidOutput)?;
    if let Some(team_id) = target.metadata.get("teamId") {
        validate_vercel_id(team_id).map_err(|_| CliError::InvalidOutput)?;
    }
    let mut activities = Vec::new();
    let mut cursor = None;
    for _ in 0..MAX_DEPLOYMENT_PAGES {
        let mut endpoint = format!("/v6/deployments?projectId={project_id}&limit={PAGE_SIZE}");
        if let Some(next) = cursor.as_deref() {
            endpoint.push_str("&until=");
            endpoint.push_str(next);
        }
        let scope = target
            .metadata
            .get("scopeSlug")
            .ok_or(CliError::InvalidOutput)?;
        let response: DeploymentsResponse = vercel_json(cli, &endpoint, Some(scope)).await?;
        for deployment in response.deployments {
            let terminal_time = deployment
                .ready
                .or(deployment.updated_at)
                .and_then(timestamp);
            if !is_terminal(&deployment.state)
                || terminal_time.is_none_or(|finished| finished >= cutoff)
            {
                activities.push(map_deployment(deployment, target, identity)?);
            }
        }
        cursor = pagination_cursor(response.pagination);
        if cursor.is_none() {
            return Ok((activities, false));
        }
    }
    Ok((activities, cursor.is_some()))
}

async fn current_user(cli: &CliInvocation) -> Result<VercelUser, CliError> {
    vercel_json::<UserEnvelope>(cli, "/v2/user", None)
        .await
        .map(|response| response.user)
}

async fn vercel_json<T: for<'de> Deserialize<'de>>(
    cli: &CliInvocation,
    endpoint: &str,
    scope: Option<&str>,
) -> Result<T, CliError> {
    let mut args = vec![
        "api",
        endpoint,
        "--method",
        "GET",
        "--raw",
        "--non-interactive",
    ];
    if let Some(scope) = scope {
        validate_scope(scope).map_err(|_| CliError::InvalidOutput)?;
        args.extend(["--scope", scope]);
    }
    cli.json(&args).await
}

fn validate_scope(value: &str) -> Result<(), ()> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        Ok(())
    } else {
        Err(())
    }
}

fn pagination_cursor(pagination: Option<Pagination>) -> Option<String> {
    pagination
        .and_then(|value| value.next)
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value),
            serde_json::Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| value.chars().all(|character| character.is_ascii_digit()))
}

fn map_deployment(
    deployment: Deployment,
    target: &Target,
    identity: Option<&VercelUser>,
) -> Result<Activity, CliError> {
    let created = timestamp(deployment.created).ok_or(CliError::InvalidOutput)?;
    let terminal_time = deployment
        .ready
        .or(deployment.updated_at)
        .and_then(timestamp);
    let actor = deployment
        .creator
        .as_ref()
        .and_then(|creator| creator.username.clone().or_else(|| creator.uid.clone()));
    let ownership = match (
        deployment
            .creator
            .as_ref()
            .and_then(|creator| creator.uid.as_deref()),
        identity,
    ) {
        (Some(creator), Some(user)) if creator == user.id => Ownership::Mine,
        (Some(_), Some(_)) => Ownership::Other,
        _ => Ownership::Unknown,
    };
    let branch = deployment
        .meta
        .get("githubCommitRef")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let url = deployment
        .inspector_url
        .filter(|url| url.starts_with("https://vercel.com/"))
        .or_else(|| deployment.url.map(|url| format!("https://{url}")))
        .unwrap_or_else(|| deployment_dashboard_url(target, &deployment.uid));
    let status = vercel_status(&deployment.state);
    let finished_at = is_terminal(&deployment.state)
        .then(|| terminal_time.map(|value| value.to_rfc3339()))
        .flatten();
    Ok(Activity {
        id: format!("vercel:{}", deployment.uid),
        provider: Provider::Vercel,
        target_id: target.id.clone(),
        kind: deployment.target.unwrap_or_else(|| "preview".into()),
        title: deployment.name,
        project: target.name.clone(),
        branch,
        url,
        status,
        raw_status: deployment.state,
        actor,
        ownership,
        started_at: created.to_rfc3339(),
        finished_at,
        updated_at: terminal_time.unwrap_or(created).to_rfc3339(),
    })
}

fn deployment_dashboard_url(target: &Target, deployment_id: &str) -> String {
    let encode =
        |value: &str| url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
    let scope = target
        .metadata
        .get("scopeSlug")
        .map(String::as_str)
        .unwrap_or("dashboard");
    format!(
        "https://vercel.com/{}/{}/{}",
        encode(scope),
        encode(&target.name),
        encode(deployment_id)
    )
}

fn timestamp(milliseconds: i64) -> Option<DateTime<Utc>> {
    Utc.timestamp_millis_opt(milliseconds).single()
}

fn is_terminal(state: &str) -> bool {
    matches!(state, "READY" | "ERROR" | "CANCELED")
}

fn vercel_status(state: &str) -> ActivityStatus {
    match state {
        "QUEUED" | "INITIALIZING" => ActivityStatus::Queued,
        "BUILDING" => ActivityStatus::Running,
        "BLOCKED" => ActivityStatus::Waiting,
        "READY" => ActivityStatus::Success,
        "ERROR" => ActivityStatus::Failed,
        "CANCELED" => ActivityStatus::Canceled,
        _ => ActivityStatus::Unknown,
    }
}

fn validate_vercel_id(value: &str) -> Result<(), ()> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        Ok(())
    } else {
        Err(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping_covers_known_vercel_states() {
        assert_eq!(vercel_status("QUEUED"), ActivityStatus::Queued);
        assert_eq!(vercel_status("BUILDING"), ActivityStatus::Running);
        assert_eq!(vercel_status("BLOCKED"), ActivityStatus::Waiting);
        assert_eq!(vercel_status("READY"), ActivityStatus::Success);
        assert_eq!(vercel_status("ERROR"), ActivityStatus::Failed);
    }

    #[test]
    fn attribution_requires_creator_identity() {
        let identity = VercelUser {
            id: "user_123".into(),
            username: "person".into(),
        };
        let creator = Creator {
            uid: None,
            username: Some("person".into()),
        };
        let ownership = match (creator.uid.as_deref(), Some(&identity)) {
            (Some(value), Some(user)) if value == user.id => Ownership::Mine,
            (Some(_), Some(_)) => Ownership::Other,
            _ => Ownership::Unknown,
        };
        assert_eq!(ownership, Ownership::Unknown);
    }

    #[test]
    fn ids_reject_query_injection() {
        assert!(validate_vercel_id("prj_123-Abc").is_ok());
        assert!(validate_vercel_id("prj_123&teamId=other").is_err());
        assert!(validate_scope("demo-team").is_ok());
        assert!(validate_scope("demo-team --token secret").is_err());
    }

    #[test]
    fn pagination_cursor_accepts_only_numeric_tokens() {
        let numeric = Pagination {
            next: Some(serde_json::json!(1_700_000_000_000_i64)),
        };
        let invalid = Pagination {
            next: Some(serde_json::json!("12&teamId=other")),
        };
        assert_eq!(
            pagination_cursor(Some(numeric)).as_deref(),
            Some("1700000000000")
        );
        assert_eq!(pagination_cursor(Some(invalid)), None);
    }

    #[test]
    fn terminal_deployment_without_timestamps_uses_dashboard_and_no_finished_time() {
        let target = Target {
            id: "personal:prj_123".into(),
            provider: Provider::Vercel,
            name: "rocket".into(),
            description: None,
            metadata: HashMap::from([("scopeSlug".into(), "demo-team".into())]),
        };
        let deployment = Deployment {
            uid: "dpl_123".into(),
            name: "rocket".into(),
            url: None,
            inspector_url: None,
            created: 1_700_000_000_000,
            ready: None,
            updated_at: None,
            state: "ERROR".into(),
            creator: None,
            meta: HashMap::new(),
            target: Some("production".into()),
        };
        let activity = map_deployment(deployment, &target, None).expect("map deployment");
        assert_eq!(activity.finished_at, None);
        assert_eq!(activity.url, "https://vercel.com/demo-team/rocket/dpl_123");
    }
}
