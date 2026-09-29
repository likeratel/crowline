use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, BufReader},
    process::Child,
};

use crate::{
    cli::{login_timeout, CliInvocation},
    models::{LoginState, LoginStatus, Provider},
    state::AppState,
};

const MAX_LOGIN_OUTPUT_BYTES: usize = 1024 * 1024;

pub async fn begin(
    app: &AppHandle,
    provider: Provider,
    profile: Option<String>,
) -> Result<LoginStatus, String> {
    let state = app.state::<AppState>();
    let invocation = match provider {
        Provider::Github => state.tools.github.clone(),
        Provider::Vercel => state.tools.vercel.clone(),
        Provider::Aws => state.tools.aws.clone(),
    }
    .ok_or_else(|| format!("{} CLI was not found.", provider_name(provider)))?;
    if provider == Provider::Aws && profile.is_none() {
        return Err("Select an AWS profile before starting SSO sign-in.".into());
    }

    let mut statuses = state.login_statuses.lock().await;
    if let Some(status) = statuses
        .get(&provider)
        .filter(|status| status.state == LoginState::Waiting)
    {
        return Ok(status.clone());
    }
    let status = LoginStatus {
        provider,
        state: LoginState::Waiting,
        message: format!(
            "Waiting for {} sign-in to complete.",
            provider_name(provider)
        ),
        url: None,
        code: None,
    };
    statuses.insert(provider, status.clone());
    drop(statuses);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let final_status = run_login(app_handle.clone(), provider, profile, invocation).await;
        let state = app_handle.state::<AppState>();
        state
            .login_statuses
            .lock()
            .await
            .insert(provider, final_status);
    });
    Ok(status)
}

pub async fn get(app: &AppHandle, provider: Provider) -> LoginStatus {
    app.state::<AppState>()
        .login_statuses
        .lock()
        .await
        .get(&provider)
        .cloned()
        .unwrap_or(LoginStatus {
            provider,
            state: LoginState::Error,
            message: "No sign-in attempt is active.".into(),
            url: None,
            code: None,
        })
}

async fn run_login(
    app: AppHandle,
    provider: Provider,
    profile: Option<String>,
    invocation: CliInvocation,
) -> LoginStatus {
    let _permit = match invocation.acquire_process().await {
        Ok(permit) => permit,
        Err(_) => return login_error(provider, "The sign-in process could not be started."),
    };
    let profile_arg = profile.unwrap_or_default();
    let args: Vec<&str> = match provider {
        Provider::Github => vec![
            "auth",
            "login",
            "--web",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--skip-ssh-key",
        ],
        Provider::Vercel => vec!["login", "--non-interactive"],
        Provider::Aws => vec![
            "sso",
            "login",
            "--profile",
            profile_arg.as_str(),
            "--no-browser",
            "--use-device-code",
        ],
    };
    let mut child = match invocation.login_command(&args).spawn() {
        Ok(child) => child,
        Err(_) => return login_error(provider, "The sign-in process could not be started."),
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_task = stdout.map(|stream| {
        tauri::async_runtime::spawn(read_login_stream(
            BufReader::new(stream),
            app.clone(),
            provider,
        ))
    });
    let stderr_task = stderr.map(|stream| {
        tauri::async_runtime::spawn(read_login_stream(
            BufReader::new(stream),
            app.clone(),
            provider,
        ))
    });
    let result = wait_for_login(&mut child, login_timeout()).await;
    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }
    match result {
        Ok(true) => LoginStatus {
            provider,
            state: LoginState::Complete,
            message: format!("{} sign-in completed.", provider_name(provider)),
            url: None,
            code: None,
        },
        Ok(false) => login_error(
            provider,
            "Sign-in did not complete. Try again or sign in with the CLI directly.",
        ),
        Err(()) => login_error(
            provider,
            "Sign-in timed out. Try again or sign in with the CLI directly.",
        ),
    }
}

async fn wait_for_login(child: &mut Child, duration: Duration) -> Result<bool, ()> {
    match tokio::time::timeout(duration, child.wait()).await {
        Ok(Ok(status)) => Ok(status.success()),
        Ok(Err(_)) => Ok(false),
        Err(_) => {
            let _ = child.kill().await;
            Err(())
        }
    }
}

async fn read_login_stream<R: AsyncBufRead + Unpin>(
    mut reader: R,
    app: AppHandle,
    provider: Provider,
) {
    let mut consumed = 0;
    let mut line = String::new();
    while consumed < MAX_LOGIN_OUTPUT_BYTES {
        line.clear();
        let Ok(read) = reader.read_line(&mut line).await else {
            break;
        };
        if read == 0 {
            break;
        }
        consumed += read;
        let (url, code) = extract_login_hints(&line, provider);
        if url.is_none() && code.is_none() {
            continue;
        }
        let state = app.state::<AppState>();
        let mut statuses = state.login_statuses.lock().await;
        if let Some(current) = statuses.get(&provider).cloned() {
            statuses.insert(
                provider,
                LoginStatus {
                    provider,
                    state: LoginState::Waiting,
                    message: format!(
                        "Complete {} sign-in in your browser.",
                        provider_name(provider)
                    ),
                    url: url.or_else(|| current.url.clone()),
                    code: code.or_else(|| current.code.clone()),
                },
            );
        }
    }
}

fn extract_login_hints(line: &str, provider: Provider) -> (Option<String>, Option<String>) {
    let url = line
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|character: char| {
                matches!(character, '(' | ')' | '[' | ']' | '<' | '>' | ',' | '.')
            })
        })
        .find(|part| allowed_login_url(part, provider))
        .map(str::to_owned);
    let code = line
        .split(|character: char| character.is_whitespace() || matches!(character, ':' | '(' | ')'))
        .map(|part| {
            part.trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && character != '-'
            })
        })
        .find(|part| {
            part.len() >= 8
                && part.len() <= 12
                && part.contains('-')
                && part.chars().all(|character| {
                    character.is_ascii_uppercase() || character.is_ascii_digit() || character == '-'
                })
        })
        .map(str::to_owned);
    (url, code)
}

fn allowed_login_url(value: &str, provider: Provider) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return false;
    }
    matches!(
        (provider, url.host_str()),
        (Provider::Github, Some("github.com")) | (Provider::Vercel, Some("vercel.com"))
    ) || provider == Provider::Aws
        && url
            .host_str()
            .is_some_and(|host| host.ends_with(".amazonaws.com") || host.ends_with(".awsapps.com"))
}

fn login_error(provider: Provider, message: &str) -> LoginStatus {
    LoginStatus {
        provider,
        state: LoginState::Error,
        message: message.into(),
        url: None,
        code: None,
    }
}

fn provider_name(provider: Provider) -> &'static str {
    match provider {
        Provider::Github => "GitHub",
        Provider::Vercel => "Vercel",
        Provider::Aws => "AWS",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_provider_login_urls_and_device_codes() {
        let hints = extract_login_hints(
            "Open https://github.com/login/device and enter ABCD-1234 (token secret)",
            Provider::Github,
        );
        assert_eq!(hints.0.as_deref(), Some("https://github.com/login/device"));
        assert_eq!(hints.1.as_deref(), Some("ABCD-1234"));
        assert_eq!(
            extract_login_hints("https://evil.example/steal ABCD-1234", Provider::Github).0,
            None
        );
        assert!(allowed_login_url(
            "https://device.sso.us-east-1.amazonaws.com/",
            Provider::Aws
        ));
    }
}
