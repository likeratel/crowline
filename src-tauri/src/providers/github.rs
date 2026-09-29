use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

use crate::{
    cli::{CliError, CliInvocation},
    models::{
        Activity, ActivityStatus, Connection, ConnectionStatus, Discovery, Issue, Ownership,
        Provider, Target,
    },
};

const MAX_REPOSITORY_PAGES: u32 = 5;
const MAX_RUN_PAGES: u32 = 5;
const MAX_ACTIVE_RUN_PAGES: u32 = 2;
const PAGE_SIZE: usize = 100;
const ACTIVE_STATUSES: [&str; 5] = ["queued", "in_progress", "waiting", "pending", "requested"];

#[derive(Deserialize)]
struct User {
    login: String,
}

#[derive(Deserialize)]
struct Repository {
    full_name: String,
    description: Option<String>,
    html_url: String,
    owner: RepositoryOwner,
    name: String,
}

#[derive(Deserialize)]
struct RepositoryOwner {
    login: String,
}

#[derive(Deserialize)]
struct RunsResponse {
    workflow_runs: Vec<WorkflowRun>,
}

#[derive(Deserialize)]
struct WorkflowRun {
    id: u64,
    #[serde(default = "default_attempt")]
    run_attempt: u64,
    name: Option<String>,
    display_title: Option<String>,
    event: String,
    status: String,
    conclusion: Option<String>,
    head_branch: Option<String>,
    html_url: String,
    created_at: DateTime<Utc>,
    run_started_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
    actor: Option<Actor>,
    triggering_actor: Option<Actor>,
}

#[derive(Deserialize)]
struct Actor {
    login: String,
}

fn default_attempt() -> u64 {
    1
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
    let (repositories, truncated) = match discover_repositories(cli).await {
        Ok(result) => result,
        Err(error) => return failed_discovery(error, connection.cli_version),
    };
    let issues = truncated
        .then(|| Issue {
            provider: Provider::Github,
            message: format!(
                "GitHub repository discovery reached the {MAX_REPOSITORY_PAGES}-page safety limit. Some repositories may be missing."
            ),
            target_id: None,
        })
        .into_iter()
        .collect();
    Discovery {
        connection,
        targets: repositories.into_iter().map(repository_target).collect(),
        aws_profiles: Vec::new(),
        issues,
    }
}

pub async fn connection(cli: Option<&CliInvocation>) -> Connection {
    let Some(cli) = cli else {
        return Connection::disconnected(
            Provider::Github,
            ConnectionStatus::MissingCli,
            "GitHub CLI 2.65 or newer was not found.",
        );
    };
    let version = cli.version().await;
    match github_json::<User>(cli, "user").await {
        Ok(user) => Connection {
            provider: Provider::Github,
            status: ConnectionStatus::Connected,
            account: Some(user.login),
            message: None,
            cli_version: version,
        },
        Err(error) => failed_discovery(error, version).connection,
    }
}

async fn discover_repositories(cli: &CliInvocation) -> Result<(Vec<Repository>, bool), CliError> {
    let mut repositories = Vec::new();
    let mut full_last_page = false;
    for page in 1..=MAX_REPOSITORY_PAGES {
        let endpoint = format!(
            "user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page={PAGE_SIZE}&page={page}"
        );
        let batch: Vec<Repository> = github_json(cli, &endpoint).await?;
        full_last_page = batch.len() == PAGE_SIZE;
        repositories.extend(batch);
        if !full_last_page {
            break;
        }
    }
    Ok((repositories, full_last_page))
}

fn repository_target(repository: Repository) -> Target {
    Target {
        id: repository.full_name,
        provider: Provider::Github,
        name: repository.name,
        description: repository.description,
        metadata: HashMap::from([
            ("owner".into(), repository.owner.login),
            ("url".into(), repository.html_url),
        ]),
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
            provider: Provider::Github,
            status,
            account: None,
            message: Some(error.user_message("GitHub")),
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
    account: Option<&str>,
) -> (Vec<Activity>, Vec<Issue>) {
    let Some(cli) = cli else {
        return (
            Vec::new(),
            vec![Issue {
                provider: Provider::Github,
                message:
                    "GitHub CLI was not found. Cached GitHub activity is shown when available."
                        .into(),
                target_id: None,
            }],
        );
    };
    let cutoff = Utc::now() - Duration::hours(i64::from(history_hours));
    let mut activities = Vec::new();
    let mut issues = Vec::new();
    for target in targets {
        match collect_repository(cli, target, cutoff, account).await {
            Ok((mut target_activities, truncated)) => {
                activities.append(&mut target_activities);
                if truncated {
                    issues.push(Issue {
                        provider: Provider::Github,
                        message: format!(
                            "GitHub history for {} reached the {MAX_RUN_PAGES}-page safety limit. Recent results are partial.",
                            target.name
                        ),
                        target_id: Some(target.id.clone()),
                    });
                }
            }
            Err(error) => issues.push(Issue {
                provider: Provider::Github,
                message: error.user_message("GitHub"),
                target_id: Some(target.id.clone()),
            }),
        }
    }
    (activities, issues)
}

async fn collect_repository(
    cli: &CliInvocation,
    target: &Target,
    cutoff: DateTime<Utc>,
    account: Option<&str>,
) -> Result<(Vec<Activity>, bool), CliError> {
    validate_repository_id(&target.id).map_err(|_| CliError::InvalidOutput)?;
    let mut activities = Vec::new();
    let (completed, mut truncated) =
        fetch_runs(cli, &target.id, "completed", MAX_RUN_PAGES).await?;
    activities.extend(
        completed
            .into_iter()
            .filter(|run| run.updated_at >= cutoff)
            .map(|run| map_run(run, target, account)),
    );
    for status in ACTIVE_STATUSES {
        let (active, active_truncated) =
            fetch_runs(cli, &target.id, status, MAX_ACTIVE_RUN_PAGES).await?;
        truncated |= active_truncated;
        activities.extend(active.into_iter().map(|run| map_run(run, target, account)));
    }
    let mut seen = std::collections::HashSet::new();
    activities.retain(|activity| seen.insert(activity.id.clone()));
    Ok((activities, truncated))
}

async fn fetch_runs(
    cli: &CliInvocation,
    repository: &str,
    status: &str,
    max_pages: u32,
) -> Result<(Vec<WorkflowRun>, bool), CliError> {
    let mut runs = Vec::new();
    let mut full_last_page = false;
    for page in 1..=max_pages {
        let endpoint = format!(
            "repos/{repository}/actions/runs?status={status}&per_page={PAGE_SIZE}&page={page}"
        );
        let response: RunsResponse = github_json(cli, &endpoint).await?;
        full_last_page = response.workflow_runs.len() == PAGE_SIZE;
        runs.extend(response.workflow_runs);
        if !full_last_page {
            return Ok((runs, false));
        }
    }
    Ok((runs, full_last_page))
}

async fn github_json<T: for<'de> Deserialize<'de>>(
    cli: &CliInvocation,
    endpoint: &str,
) -> Result<T, CliError> {
    cli.json(&["api", "--method", "GET", endpoint]).await
}

fn map_run(run: WorkflowRun, target: &Target, account: Option<&str>) -> Activity {
    let current_actor = run
        .triggering_actor
        .as_ref()
        .or(run.actor.as_ref())
        .map(|actor| actor.login.clone());
    let ownership = match (current_actor.as_deref(), account) {
        (Some(actor), Some(account)) if actor.eq_ignore_ascii_case(account) => Ownership::Mine,
        (Some(_), Some(_)) => Ownership::Other,
        _ => Ownership::Unknown,
    };
    let raw_status = run.conclusion.clone().unwrap_or_else(|| run.status.clone());
    let status = github_status(&run.status, run.conclusion.as_deref());
    let started_at = run.run_started_at.unwrap_or(run.created_at);
    Activity {
        id: format!("github:{}:{}", run.id, run.run_attempt),
        provider: Provider::Github,
        target_id: target.id.clone(),
        kind: run.event,
        title: run
            .display_title
            .or(run.name)
            .unwrap_or_else(|| "GitHub Actions run".into()),
        project: target.id.clone(),
        branch: run.head_branch,
        url: run.html_url,
        status,
        raw_status,
        actor: current_actor,
        ownership,
        started_at: started_at.to_rfc3339(),
        finished_at: None,
        updated_at: run.updated_at.to_rfc3339(),
    }
}

fn github_status(status: &str, conclusion: Option<&str>) -> ActivityStatus {
    match conclusion {
        Some("success") => ActivityStatus::Success,
        Some("failure" | "timed_out" | "action_required" | "startup_failure" | "stale") => {
            ActivityStatus::Failed
        }
        Some("cancelled") => ActivityStatus::Canceled,
        Some("skipped" | "neutral") => ActivityStatus::Skipped,
        Some(_) => ActivityStatus::Unknown,
        None => match status {
            "queued" | "requested" | "pending" => ActivityStatus::Queued,
            "in_progress" => ActivityStatus::Running,
            "waiting" => ActivityStatus::Waiting,
            _ => ActivityStatus::Unknown,
        },
    }
}

fn validate_repository_id(value: &str) -> Result<(), ()> {
    let mut parts = value.split('/');
    let valid_part = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
    };
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(repository), None) if valid_part(owner) && valid_part(repository) => {
            Ok(())
        }
        _ => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_run(actor: &str, triggering_actor: Option<&str>) -> WorkflowRun {
        WorkflowRun {
            id: 10,
            run_attempt: 2,
            name: Some("Deploy".into()),
            display_title: None,
            event: "workflow_dispatch".into(),
            status: "completed".into(),
            conclusion: Some("success".into()),
            head_branch: Some("main".into()),
            html_url: "https://github.com/acme/rocket/actions/runs/10".into(),
            created_at: Utc::now(),
            run_started_at: None,
            updated_at: Utc::now(),
            actor: Some(Actor {
                login: actor.into(),
            }),
            triggering_actor: triggering_actor.map(|login| Actor {
                login: login.into(),
            }),
        }
    }

    fn target() -> Target {
        Target {
            id: "acme/rocket".into(),
            provider: Provider::Github,
            name: "rocket".into(),
            description: None,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn rerun_uses_current_attempt_actor_for_ownership() {
        let activity = map_run(
            test_run("automation", Some("octo-user")),
            &target(),
            Some("octo-user"),
        );
        assert_eq!(activity.actor.as_deref(), Some("octo-user"));
        assert_eq!(activity.ownership, Ownership::Mine);
        assert_eq!(activity.id, "github:10:2");
    }

    #[test]
    fn github_status_mapping_is_explicit() {
        assert_eq!(github_status("in_progress", None), ActivityStatus::Running);
        assert_eq!(
            github_status("completed", Some("cancelled")),
            ActivityStatus::Canceled
        );
        assert_eq!(
            github_status("completed", Some("timed_out")),
            ActivityStatus::Failed
        );
    }

    #[test]
    fn repository_id_validation_blocks_path_injection() {
        assert!(validate_repository_id("acme/rocket").is_ok());
        assert!(validate_repository_id("acme/../secrets").is_err());
        assert!(validate_repository_id("acme/rocket?x=1").is_err());
    }

    #[test]
    fn active_and_completed_windows_are_independent() {
        let mut run = test_run("person", None);
        run.status = "in_progress".into();
        run.conclusion = None;
        run.updated_at = Utc::now() - Duration::hours(200);
        let cutoff = Utc::now() - Duration::hours(24);
        assert!(run.conclusion.is_none() && run.status != "completed");

        run.status = "completed".into();
        run.conclusion = Some("success".into());
        assert!(run.updated_at < cutoff);
    }
}
