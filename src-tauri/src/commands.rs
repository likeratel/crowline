use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    login,
    models::{Discovery, LoginStatus, Provider, Settings, Snapshot},
    providers::{aws, github, vercel},
    state::AppState,
};

#[tauri::command]
pub async fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    Ok(state.snapshot().await)
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    state.save_settings(settings, &app).await
}

#[tauri::command]
pub async fn refresh(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    Ok(state.refresh(&app).await)
}

#[tauri::command]
pub async fn discover(
    state: State<'_, AppState>,
    provider: Provider,
    profile: Option<String>,
    region: Option<String>,
) -> Result<Discovery, String> {
    validate_optional("AWS profile", profile.as_deref())?;
    validate_optional("AWS region", region.as_deref())?;
    match provider {
        Provider::Github => Ok(github::discover(state.tools.github.as_ref()).await),
        Provider::Vercel => Ok(vercel::discover(state.tools.vercel.as_ref()).await),
        Provider::Aws => aws::discover(profile, region).await,
    }
}

#[tauri::command]
pub async fn begin_login(
    app: AppHandle,
    provider: Provider,
    profile: Option<String>,
) -> Result<LoginStatus, String> {
    validate_optional("AWS profile", profile.as_deref())?;
    login::begin(&app, provider, profile).await
}

#[tauri::command]
pub async fn get_login_status(app: AppHandle, provider: Provider) -> Result<LoginStatus, String> {
    Ok(login::get(&app, provider).await)
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "The link could not be opened.".to_owned())
}

fn validate_optional(label: &str, value: Option<&str>) -> Result<(), String> {
    if value.is_some_and(|value| {
        value.is_empty()
            || value.len() > 128
            || value.contains('\0')
            || value.chars().any(char::is_control)
    }) {
        Err(format!("{label} is invalid."))
    } else {
        Ok(())
    }
}

fn validate_external_url(value: &str) -> Result<(), String> {
    if value.len() > 2_048 {
        return Err("The link is too long.".into());
    }
    let url = url::Url::parse(value).map_err(|_| "The link is invalid.".to_owned())?;
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err("Only secure provider links can be opened.".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "The link has no host.".to_owned())?;
    let allowed = host == "github.com"
        || host == "vercel.com"
        || host.ends_with(".vercel.app")
        || host == "console.aws.amazon.com"
        || host.ends_with(".console.aws.amazon.com")
        || is_aws_device_host(host);
    if !allowed {
        return Err("This link is outside the supported provider hosts.".into());
    }
    Ok(())
}

fn is_aws_device_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    labels.len() == 5
        && labels[0] == "device"
        && labels[1] == "sso"
        && labels[3] == "amazonaws"
        && labels[4] == "com"
        && !labels[2].is_empty()
        && labels[2]
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_validation_enforces_https_and_exact_host_boundaries() {
        assert!(validate_external_url("https://github.com/acme/rocket/actions/runs/1").is_ok());
        assert!(validate_external_url("https://iad1.console.aws.amazon.com/ecs/home").is_ok());
        assert!(validate_external_url(
            "https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH"
        )
        .is_ok());
        assert!(validate_external_url("http://github.com/acme/rocket").is_err());
        assert!(validate_external_url("https://device.sso.evil.amazonaws.com.example/").is_err());
        assert!(validate_external_url("https://github.com.evil.example/steal").is_err());
        assert!(validate_external_url("https://user:password@github.com/acme").is_err());
    }
}
