use super::support::{parse_timestamp, provider_url};
use crate::{
    cli::{CliError, CliInvocation},
    models::{Activity, ActivityPage, ActivityStatus, Ownership, Target},
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Pipeline {
    id: u64,
    status: String,
    #[serde(rename = "ref")]
    branch: String,
    created_at: String,
    updated_at: String,
    name: Option<String>,
}

pub(super) fn target(project: &Target) -> Target {
    let metadata = project
        .metadata
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .chain([("kind".into(), "pipelines".into())])
        .collect();
    Target {
        id: format!("{}:pipelines", project.id),
        name: format!("{} · CI pipelines", project.name),
        metadata,
        ..project.clone()
    }
}

pub(super) async fn page(
    cli: &CliInvocation,
    target: &Target,
    project_id: &str,
    path: &str,
    number: u32,
) -> Result<ActivityPage, CliError> {
    let endpoint = format!(
        "projects/{project_id}/pipelines?order_by=updated_at&sort=desc&per_page=20&page={number}"
    );
    let rows: Vec<Pipeline> = cli
        .json(&["api", "--hostname", "gitlab.com", &endpoint])
        .await?;
    let more = rows.len() == 20;
    let activities = rows
        .into_iter()
        .map(|row| map(row, target, path))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ActivityPage {
        activities,
        next_cursor: more.then(|| (number + 1).to_string()),
        issues: vec![],
    })
}

fn map(row: Pipeline, target: &Target, path: &str) -> Result<Activity, CliError> {
    if row.id == 0 {
        return Err(CliError::InvalidOutput);
    }
    let status = match row.status.as_str() {
        "created" | "pending" | "waiting_for_resource" | "preparing" | "scheduled" => {
            ActivityStatus::Queued
        }
        "running" => ActivityStatus::Running,
        "manual" => ActivityStatus::Waiting,
        "success" => ActivityStatus::Success,
        "failed" => ActivityStatus::Failed,
        "canceled" => ActivityStatus::Canceled,
        "skipped" => ActivityStatus::Skipped,
        _ => ActivityStatus::Unknown,
    };
    let id = row.id.to_string();
    let segments = path
        .split('/')
        .chain(["-", "pipelines", &id])
        .collect::<Vec<_>>();
    Ok(Activity {
        id: format!(
            "gitlab:pipeline:{}:{}",
            target.metadata["project_id"], row.id
        ),
        provider: target.provider,
        connection_id: target.connection_id.clone(),
        target_id: target.id.clone(),
        workflow_name: crate::providers::execution_name(row.name.as_deref()),
        kind: "pipeline".into(),
        title: row
            .name
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| format!("CI pipeline #{}", row.id)),
        project: target.name.clone(),
        branch: Some(row.branch),
        url: provider_url("gitlab.com", &segments)?,
        status,
        raw_status: row.status,
        actor: None,
        ownership: Ownership::Unknown,
        started_at: parse_timestamp(&row.created_at)?,
        finished_at: None,
        updated_at: parse_timestamp(&row.updated_at)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pipeline_status_does_not_invent_actor_or_finish_time() {
        let t = Target {
            id: "gitlab:42:pipelines".into(),
            provider: crate::models::Provider::Gitlab,
            connection_id: "gitlab:local".into(),
            name: "sample".into(),
            description: None,
            metadata: std::collections::HashMap::from([("project_id".into(), "42".into())]),
        };
        let row:Pipeline=serde_json::from_str(r#"{"id":7,"status":"failed","ref":"main","created_at":"2026-09-29T01:00:00Z","updated_at":"2026-09-29T01:01:00Z","name":"fastlane release"}"#).unwrap();
        let a = map(row, &t, "sample/mobile").unwrap();
        assert_eq!(a.status, ActivityStatus::Failed);
        assert_eq!(a.workflow_name.as_deref(), Some("fastlane release"));
        assert_eq!(a.title, "fastlane release");
        assert_eq!(a.ownership, Ownership::Unknown);
        assert_eq!(a.finished_at, None);
        assert_eq!(a.url, "https://gitlab.com/sample/mobile/-/pipelines/7");
    }
}
