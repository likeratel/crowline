use std::time::Duration;

use crate::cli::{CliError, CliInvocation};

use super::{api::Project, valid_identity};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const GCLOUD_CONFIG_ARGS: &[&str] = &["config", "list", "--format=json"];
pub(super) const MAX_PROJECTS: usize = 25;

pub(super) async fn ensure_default_gcloud_auth(cli: &CliInvocation) -> Result<(), String> {
    let config: serde_json::Value = cli
        .json(GCLOUD_CONFIG_ARGS)
        .await
        .map_err(|error| error.user_message("Google Cloud"))?;
    if has_auth_override(&config) {
        return Err(
            "The active gcloud configuration uses an authentication or API endpoint override. Use a standard signed-in gcloud account for this Firebase connection."
                .into(),
        );
    }
    Ok(())
}

pub(super) fn has_auth_override(config: &serde_json::Value) -> bool {
    [
        "/auth/impersonate_service_account",
        "/auth/access_token_file",
        "/auth/credential_file_override",
        "/auth/token_host",
        "/api_endpoint_overrides/cloudresourcemanager",
    ]
    .into_iter()
    .any(|pointer| config.pointer(pointer).is_some_and(value_is_set))
}

fn value_is_set(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::String(value) => !value.trim().is_empty(),
        serde_json::Value::Array(value) => !value.is_empty(),
        serde_json::Value::Object(value) => !value.is_empty(),
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(_) => true,
    }
}

pub async fn identity(cli: &CliInvocation) -> Result<String, CliError> {
    let output = cli
        .run(
            &[
                "auth",
                "list",
                "--filter=status:ACTIVE",
                "--format=value(account)",
            ],
            COMMAND_TIMEOUT,
        )
        .await?;
    let accounts = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let [actual] = accounts.as_slice() else {
        return Err(CliError::SignedOut);
    };
    if !valid_identity(actual) {
        return Err(CliError::InvalidOutput);
    }
    if cli
        .expected_identity()
        .is_some_and(|expected| expected != *actual)
    {
        return Err(CliError::AccountMismatch);
    }
    Ok((*actual).to_owned())
}

pub(super) async fn access_token(cli: &CliInvocation, account: &str) -> Result<String, CliError> {
    let output = cli
        .run(
            &[
                "auth",
                "print-access-token",
                "--account",
                account,
                "--quiet",
            ],
            COMMAND_TIMEOUT,
        )
        .await?;
    let token = output.trim();
    if !(16..=16_384).contains(&token.len()) || !token.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(CliError::InvalidOutput);
    }
    Ok(token.to_owned())
}

pub(super) async fn projects(
    cli: &CliInvocation,
    identity: &str,
) -> Result<Vec<Project>, CliError> {
    let args = [
        "projects",
        "list",
        "--filter=lifecycleState:ACTIVE",
        "--limit=25",
        "--format=json(projectId,name,lifecycleState)",
        "--account",
        identity,
    ];
    cli.json(&args).await
}
