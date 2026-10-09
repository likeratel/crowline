use crate::{
    cli::CliError,
    models::{Activity, ActivityStatus, Ownership, Provider, Target},
};
use chrono::{DateTime, FixedOffset};
use serde_json::Value;

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, CliError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 2048)
        .ok_or(CliError::InvalidOutput)
}
fn optional_text<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, CliError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.trim().is_empty() => Ok(None),
        Some(Value::String(text)) if text.len() <= 2048 => Ok(Some(text)),
        _ => Err(CliError::InvalidOutput),
    }
}
fn timestamp(value: &Value, key: &str) -> Result<String, CliError> {
    let time = text(value, key)?;
    parse_timestamp(time)?;
    Ok(time.into())
}
fn parse_timestamp(value: &str) -> Result<DateTime<FixedOffset>, CliError> {
    DateTime::parse_from_rfc3339(value).map_err(|_| CliError::InvalidOutput)
}
fn uuid(value: &str) -> Result<&str, CliError> {
    uuid::Uuid::parse_str(value).map_err(|_| CliError::InvalidOutput)?;
    Ok(value)
}
fn url(target: &Target, path: &str, id: &str) -> String {
    format!(
        "https://expo.dev/accounts/{}/projects/{}/{path}/{id}",
        target.metadata["owner"], target.metadata["slug"]
    )
}

pub(super) fn build(target: &Target, row: &Value) -> Result<Activity, CliError> {
    let id = uuid(text(row, "id")?)?;
    let raw = text(row, "status")?;
    let status = match raw {
        "NEW" | "IN_QUEUE" => ActivityStatus::Queued,
        "IN_PROGRESS" => ActivityStatus::Running,
        "PENDING_CANCEL" => ActivityStatus::Waiting,
        "FINISHED" => ActivityStatus::Success,
        "ERRORED" => ActivityStatus::Failed,
        "CANCELED" => ActivityStatus::Canceled,
        _ => ActivityStatus::Unknown,
    };
    let finished_at = row
        .get("completedAt")
        .filter(|v| !v.is_null())
        .map(|_| timestamp(row, "completedAt"))
        .transpose()?;
    let title = optional_text(row, "message")?.unwrap_or("EAS build");
    let actor = match row.get("initiatingActor") {
        None | Some(Value::Null) => None,
        Some(actor @ Value::Object(_)) => optional_text(actor, "displayName")?.map(str::to_owned),
        _ => return Err(CliError::InvalidOutput),
    };
    let platform = optional_text(row, "platform")?.unwrap_or("unknown");
    Ok(Activity {
        id: format!("build:{id}"),
        target_id: target.id.clone(),
        connection_id: target.connection_id.clone(),
        provider: Provider::Eas,
        kind: "build".into(),
        title: title.into(),
        workflow_name: Some(format!("EAS Build · {platform}")),
        project: format!("@{}/{}", target.metadata["owner"], target.metadata["slug"]),
        branch: None,
        url: url(target, "builds", id),
        status,
        raw_status: raw.into(),
        actor,
        ownership: Ownership::Unknown,
        started_at: timestamp(row, "createdAt")?,
        finished_at,
        updated_at: timestamp(row, "updatedAt")?,
    })
}

pub(super) fn update(target: &Target, group: &str, rows: &[Value]) -> Result<Activity, CliError> {
    uuid(group)?;
    if rows.is_empty()
        || rows.len() > 10
        || rows
            .iter()
            .any(|row| row.get("group").and_then(Value::as_str) != Some(group))
    {
        return Err(CliError::InvalidOutput);
    }
    let row = rows
        .iter()
        .map(|row| {
            let created_at = text(row, "createdAt")?;
            Ok((parse_timestamp(created_at)?, row))
        })
        .collect::<Result<Vec<_>, CliError>>()?
        .into_iter()
        .max_by_key(|(created_at, _)| *created_at)
        .map(|(_, row)| row)
        .ok_or(CliError::InvalidOutput)?;
    let time = timestamp(row, "createdAt")?;
    Ok(Activity {
        id: format!("update:{group}"),
        target_id: target.id.clone(),
        connection_id: target.connection_id.clone(),
        provider: Provider::Eas,
        kind: "update".into(),
        title: optional_text(row, "message")?
            .unwrap_or("EAS update published")
            .into(),
        workflow_name: Some("EAS Update".into()),
        project: format!("@{}/{}", target.metadata["owner"], target.metadata["slug"]),
        branch: optional_text(row, "branch")?.map(str::to_owned),
        url: url(target, "updates", group),
        status: ActivityStatus::Success,
        raw_status: "PUBLISHED".into(),
        actor: None,
        ownership: Ownership::Unknown,
        started_at: time.clone(),
        finished_at: Some(time.clone()),
        updated_at: time,
    })
}
