use chrono::{DateTime, Utc};

use crate::models::{Activity, ActivityPage, ActivityStatus, Issue, Target};

use super::{
    activity_id,
    support::{
        amplify_target, friendly_aws_error, normalize_amplify_status,
        ownership_from_observed_actor, partial_issue, push_target, rfc3339, target_issue,
        terminal_time, AwsTargetMetadata,
    },
    AWS_PROVIDER, CALL_TIMEOUT, MAX_DISCOVERED_TARGETS, MAX_DISCOVERY_PAGES,
};

const AMPLIFY_DISCOVERY_PAGE_SIZE: i32 = 100;
const AMPLIFY_BRANCH_PAGE_SIZE: i32 = 50;
const AMPLIFY_JOB_PAGE_SIZE: i32 = 20;

pub(super) async fn discover_apps(
    client: &aws_sdk_amplify::Client,
    connection_id: &str,
    profile: &str,
    region: &str,
    targets: &mut Vec<Target>,
    issues: &mut Vec<Issue>,
) {
    let mut next_token = None;
    for page_index in 0..MAX_DISCOVERY_PAGES {
        let output = match list_apps_page(client, next_token.take()).await {
            Ok(output) => output,
            Err(message) => {
                issues.push(partial_issue(connection_id, message));
                return;
            }
        };
        for app in output.apps() {
            discover_app_branches(
                client,
                connection_id,
                profile,
                region,
                app.app_id(),
                app.name(),
                targets,
                issues,
            )
            .await;
            if targets.len() >= MAX_DISCOVERED_TARGETS {
                return;
            }
        }
        next_token = output.next_token().map(str::to_owned);
        if next_token.is_none() {
            return;
        }
        if page_index + 1 == MAX_DISCOVERY_PAGES {
            issues.push(partial_issue(
                connection_id,
                "Amplify app discovery reached its 10-page safety limit; more apps may be available.",
            ));
        }
    }
}

async fn list_apps_page(
    client: &aws_sdk_amplify::Client,
    next_token: Option<String>,
) -> Result<aws_sdk_amplify::operation::list_apps::ListAppsOutput, String> {
    let mut request = client.list_apps().max_results(AMPLIFY_DISCOVERY_PAGE_SIZE);
    if let Some(token) = next_token {
        request = request.next_token(token);
    }
    match tokio::time::timeout(CALL_TIMEOUT, request.send()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(friendly_aws_error(
            "Amplify app listing",
            &error.to_string(),
        )),
        Err(_) => Err("AWS Amplify app listing timed out.".into()),
    }
}

#[allow(clippy::too_many_arguments)]
async fn discover_app_branches(
    client: &aws_sdk_amplify::Client,
    connection_id: &str,
    profile: &str,
    region: &str,
    app_id: &str,
    app_name: &str,
    targets: &mut Vec<Target>,
    issues: &mut Vec<Issue>,
) {
    let mut next_token = None;
    for page_index in 0..MAX_DISCOVERY_PAGES {
        let output = match list_branches_page(client, app_id, next_token.take()).await {
            Ok(output) => output,
            Err(message) => {
                issues.push(partial_issue(
                    connection_id,
                    format!("Amplify app {app_name}: {message}"),
                ));
                return;
            }
        };
        for branch in output.branches() {
            push_target(
                targets,
                amplify_target(
                    connection_id,
                    profile,
                    region,
                    app_id,
                    app_name,
                    branch.branch_name(),
                ),
                issues,
            );
            if targets.len() >= MAX_DISCOVERED_TARGETS {
                return;
            }
        }
        next_token = output.next_token().map(str::to_owned);
        if next_token.is_none() {
            return;
        }
        if page_index + 1 == MAX_DISCOVERY_PAGES {
            issues.push(partial_issue(
                connection_id,
                format!(
                    "Amplify branch discovery for {app_name} reached its 10-page safety limit; more branches may be available."
                ),
            ));
        }
    }
}

async fn list_branches_page(
    client: &aws_sdk_amplify::Client,
    app_id: &str,
    next_token: Option<String>,
) -> Result<aws_sdk_amplify::operation::list_branches::ListBranchesOutput, String> {
    let mut request = client
        .list_branches()
        .app_id(app_id)
        .max_results(AMPLIFY_BRANCH_PAGE_SIZE);
    if let Some(token) = next_token {
        request = request.next_token(token);
    }
    match tokio::time::timeout(CALL_TIMEOUT, request.send()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(friendly_aws_error(
            "Amplify branch listing",
            &error.to_string(),
        )),
        Err(_) => Err("AWS Amplify branch listing timed out.".into()),
    }
}

pub(super) async fn jobs_page(
    client: &aws_sdk_amplify::Client,
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    cursor: Option<String>,
    cutoff: DateTime<Utc>,
) -> Result<ActivityPage, String> {
    let (Some(app_id), Some(app_name), Some(branch)) =
        (metadata.app_id, metadata.app_name, metadata.branch)
    else {
        return Err("Amplify target is missing its app or branch metadata.".into());
    };
    let mut request = client
        .list_jobs()
        .app_id(app_id)
        .branch_name(branch)
        .max_results(AMPLIFY_JOB_PAGE_SIZE);
    if let Some(token) = cursor {
        request = request.next_token(token);
    }
    let output = match tokio::time::timeout(CALL_TIMEOUT, request.send()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(friendly_aws_error(
                "Amplify job listing",
                &error.to_string(),
            ))
        }
        Err(_) => return Err("AWS Amplify job listing timed out.".into()),
    };
    Ok(map_jobs_page(
        target, metadata, app_id, app_name, branch, output, cutoff,
    ))
}

fn map_jobs_page(
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    app_id: &str,
    app_name: &str,
    branch: &str,
    output: aws_sdk_amplify::operation::list_jobs::ListJobsOutput,
    cutoff: DateTime<Utc>,
) -> ActivityPage {
    let mut activities = Vec::new();
    let mut issues = Vec::new();
    for job in output.job_summaries() {
        match map_job(target, metadata.region, app_id, app_name, branch, job) {
            Ok(activity) => {
                let terminal = is_terminal(activity.status);
                let older = timestamp_is_older(&activity.updated_at, cutoff);
                if !terminal || !older {
                    activities.push(activity);
                }
            }
            Err(message) => issues.push(target_issue(target, message)),
        }
    }
    ActivityPage {
        activities,
        next_cursor: output.next_token().map(|token| format!("amplify:{token}")),
        issues,
    }
}

fn map_job(
    target: &Target,
    region: &str,
    app_id: &str,
    app_name: &str,
    branch: &str,
    job: &aws_sdk_amplify::types::JobSummary,
) -> Result<Activity, String> {
    let started_at = job
        .start_time()
        .to_millis()
        .ok()
        .and_then(rfc3339)
        .ok_or_else(|| "Amplify returned a job with an invalid start time.".to_owned())?;
    let raw_status = job.status().as_str().to_owned();
    let status = normalize_amplify_status(&raw_status);
    let updated_at = job
        .end_time()
        .and_then(|time| time.to_millis().ok())
        .and_then(rfc3339)
        .unwrap_or_else(|| started_at.clone());
    Ok(Activity {
        id: activity_id(&[target.id.as_str(), "amplify", job.job_id()]),
        provider: AWS_PROVIDER,
        connection_id: target.connection_id.clone(),
        target_id: target.id.clone(),
        kind: "amplify".into(),
        title: format!("Amplify {} job {}", job.job_type().as_str(), job.job_id()),
        project: app_name.into(),
        branch: Some(branch.into()),
        url: amplify_console_url(region, app_id, branch, job.job_id()),
        status,
        raw_status,
        actor: None,
        ownership: ownership_from_observed_actor(None),
        started_at,
        finished_at: terminal_time(status, &updated_at),
        updated_at,
    })
}

fn is_terminal(status: ActivityStatus) -> bool {
    matches!(
        status,
        ActivityStatus::Success
            | ActivityStatus::Failed
            | ActivityStatus::Canceled
            | ActivityStatus::Skipped
    )
}

fn timestamp_is_older(timestamp: &str, cutoff: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|value| value.with_timezone(&Utc) < cutoff)
        .unwrap_or(false)
}

fn amplify_console_url(region: &str, app_id: &str, branch: &str, job_id: &str) -> String {
    let encode =
        |value: &str| url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
    format!(
        "https://{region}.console.aws.amazon.com/amplify/apps/{}/branches/{}/deployments/{}?region={region}",
        encode(app_id),
        encode(branch),
        encode(job_id),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{ActivityStatus, Ownership},
        providers::aws::support::{amplify_target, target_metadata},
    };

    #[test]
    fn maps_synthetic_job_and_preserves_pagination_without_attribution() {
        let target = amplify_target(
            "aws-example",
            "engineering",
            "us-west-2",
            "app-123",
            "example-web",
            "feature/ship",
        );
        let metadata = target_metadata(&target).expect("metadata");
        let started = aws_sdk_amplify::primitives::DateTime::from_secs(1_800_576_000);
        let finished = aws_sdk_amplify::primitives::DateTime::from_secs(1_800_576_120);
        let job = aws_sdk_amplify::types::JobSummary::builder()
            .job_arn("arn:aws:amplify:us-west-2:123456789012:apps/app-123/jobs/job-42")
            .job_id("job/42")
            .commit_id("synthetic-commit")
            .commit_message("Synthetic deployment")
            .commit_time(started)
            .start_time(started)
            .status(aws_sdk_amplify::types::JobStatus::Succeed)
            .end_time(finished)
            .job_type(aws_sdk_amplify::types::JobType::WebHook)
            .build()
            .expect("job");
        let output = aws_sdk_amplify::operation::list_jobs::ListJobsOutput::builder()
            .job_summaries(job)
            .next_token("next-job-page")
            .build()
            .expect("output");
        let cutoff = DateTime::parse_from_rfc3339("2027-01-01T00:00:00Z")
            .expect("cutoff")
            .with_timezone(&Utc);

        let page = map_jobs_page(
            &target,
            &metadata,
            "app-123",
            "example-web",
            "feature/ship",
            output,
            cutoff,
        );

        assert_eq!(page.activities.len(), 1);
        assert_eq!(page.activities[0].status, ActivityStatus::Success);
        assert_eq!(page.activities[0].ownership, Ownership::Unknown);
        assert!(page.activities[0].actor.is_none());
        assert!(page.activities[0].url.contains("feature%2Fship"));
        assert!(page.activities[0].url.contains("job%2F42"));
        assert_eq!(page.next_cursor.as_deref(), Some("amplify:next-job-page"));
        assert!(page.issues.is_empty());
    }
}
