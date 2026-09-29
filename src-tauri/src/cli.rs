use std::{
    collections::HashSet,
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::de::DeserializeOwned;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{OwnedSemaphorePermit, Semaphore},
    time::timeout,
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROCESS_GATE_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_OUTPUT_BYTES: u64 = 8 * 1024 * 1024 + 1;

#[derive(Clone, Debug)]
pub struct CliInvocation {
    program: PathBuf,
    prefix_args: Vec<String>,
    process_gate: std::sync::Arc<Semaphore>,
}

impl CliInvocation {
    fn direct(program: PathBuf, process_gate: std::sync::Arc<Semaphore>) -> Self {
        Self {
            program,
            prefix_args: Vec::new(),
            process_gate,
        }
    }

    fn node_script(
        node: PathBuf,
        script: PathBuf,
        process_gate: std::sync::Arc<Semaphore>,
    ) -> Self {
        Self {
            program: node,
            prefix_args: vec![script.to_string_lossy().into_owned()],
            process_gate,
        }
    }

    pub async fn version(&self) -> Option<String> {
        self.run(&["--version"], Duration::from_secs(5))
            .await
            .ok()
            .and_then(|output| output.lines().next().map(str::trim).map(str::to_owned))
            .filter(|version| !version.is_empty())
    }

    pub async fn json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T, CliError> {
        let output = self.run(args, COMMAND_TIMEOUT).await?;
        serde_json::from_str(&output).map_err(|_| CliError::InvalidOutput)
    }

    pub async fn run(&self, args: &[&str], duration: Duration) -> Result<String, CliError> {
        let _permit = self.acquire_process().await?;
        let mut command = Command::new(&self.program);
        command
            .args(&self.prefix_args)
            .args(args)
            .env("CI", "1")
            .env("NO_COLOR", "1")
            .env("TERM", "dumb")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        command.creation_flags(0x08000000);

        let mut child = command.spawn().map_err(|_| CliError::Unavailable)?;
        let stdout = child.stdout.take().ok_or(CliError::Unavailable)?;
        let stderr = child.stderr.take().ok_or(CliError::Unavailable)?;
        let output = timeout(duration, async move {
            let stdout_task = tokio::spawn(read_limited(stdout));
            let stderr_task = tokio::spawn(read_limited(stderr));
            let status = child.wait().await.map_err(|_| CliError::Failed)?;
            let stdout = stdout_task.await.map_err(|_| CliError::Failed)??;
            let stderr = stderr_task.await.map_err(|_| CliError::Failed)??;
            Ok::<_, CliError>((status.success(), stdout, stderr))
        })
        .await
        .map_err(|_| CliError::TimedOut)??;

        if !output.0 {
            return Err(classify_failure(&output.2));
        }
        String::from_utf8(output.1).map_err(|_| CliError::InvalidOutput)
    }

    pub fn login_command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(&self.prefix_args)
            .args(args)
            .env("NO_COLOR", "1")
            .env("TERM", "dumb")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command
    }

    pub async fn acquire_process(&self) -> Result<OwnedSemaphorePermit, CliError> {
        timeout(
            PROCESS_GATE_TIMEOUT,
            self.process_gate.clone().acquire_owned(),
        )
        .await
        .map_err(|_| CliError::Busy)?
        .map_err(|_| CliError::Unavailable)
    }
}

async fn read_limited<R: tokio::io::AsyncRead + Unpin>(reader: R) -> Result<Vec<u8>, CliError> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_OUTPUT_BYTES)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| CliError::Failed)?;
    if bytes.len() as u64 >= MAX_OUTPUT_BYTES {
        return Err(CliError::OutputTooLarge);
    }
    Ok(bytes)
}

fn classify_failure(stderr: &[u8]) -> CliError {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if [
        "not logged",
        "not authenticated",
        "authentication required",
        "log in",
        "login required",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        CliError::SignedOut
    } else if text.contains("rate limit") {
        CliError::RateLimited
    } else {
        CliError::Failed
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CliError {
    Unavailable,
    Busy,
    SignedOut,
    RateLimited,
    TimedOut,
    OutputTooLarge,
    InvalidOutput,
    Failed,
}

impl CliError {
    pub fn user_message(self, provider: &str) -> String {
        match self {
            Self::Unavailable => format!("{provider} CLI is not available."),
            Self::Busy => {
                format!("{provider} is already handling another request. Try again shortly.")
            }
            Self::SignedOut => format!("Sign in to {provider} to continue."),
            Self::RateLimited => {
                format!("{provider} rate limit was reached. Cached data is shown.")
            }
            Self::TimedOut => format!("{provider} did not respond in time. Cached data is shown."),
            Self::OutputTooLarge => {
                format!("{provider} returned more data than crowline can safely process.")
            }
            Self::InvalidOutput => format!("{provider} returned an unsupported response."),
            Self::Failed => {
                format!("{provider} request failed. Check the CLI session and network connection.")
            }
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Toolchain {
    pub github: Option<CliInvocation>,
    pub vercel: Option<CliInvocation>,
    pub aws: Option<CliInvocation>,
}

impl Toolchain {
    pub async fn discover(resource_dir: Option<&Path>) -> Self {
        let github_gate = std::sync::Arc::new(Semaphore::new(1));
        let system_github =
            find_executable(&["gh"]).map(|path| CliInvocation::direct(path, github_gate.clone()));
        let bundled_github = bundled_executable(resource_dir, "gh")
            .map(|path| CliInvocation::direct(path, github_gate));
        let github = select_supported(system_github, bundled_github, (2, 65, 0)).await;

        let vercel_gate = std::sync::Arc::new(Semaphore::new(1));
        let system_vercel = find_executable(&["vercel"])
            .map(|path| CliInvocation::direct(path, vercel_gate.clone()));
        let bundled_vercel = (|| {
            let node =
                bundled_executable(resource_dir, "node").or_else(|| find_executable(&["node"]))?;
            let script = resource_dir?.join("tools/vercel/node_modules/vercel/dist/index.js");
            script
                .is_file()
                .then(|| CliInvocation::node_script(node, script, vercel_gate.clone()))
        })();
        let vercel = select_supported(system_vercel, bundled_vercel, (50, 29, 0)).await;
        let aws = find_executable(&["aws"])
            .map(|path| CliInvocation::direct(path, std::sync::Arc::new(Semaphore::new(1))));
        Self {
            github,
            vercel,
            aws,
        }
    }
}

async fn select_supported(
    preferred: Option<CliInvocation>,
    fallback: Option<CliInvocation>,
    minimum: (u32, u32, u32),
) -> Option<CliInvocation> {
    for candidate in [preferred, fallback].into_iter().flatten() {
        if candidate
            .version()
            .await
            .and_then(|version| parse_version(&version))
            .is_some_and(|version| version >= minimum)
        {
            return Some(candidate);
        }
    }
    None
}

fn parse_version(value: &str) -> Option<(u32, u32, u32)> {
    value
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .find_map(|part| {
            let numbers = part
                .split('.')
                .map(str::parse::<u32>)
                .collect::<Result<Vec<_>, _>>()
                .ok()?;
            (numbers.len() >= 2)
                .then(|| (numbers[0], numbers[1], numbers.get(2).copied().unwrap_or(0)))
        })
}

fn bundled_executable(resource_dir: Option<&Path>, name: &str) -> Option<PathBuf> {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    resource_dir
        .map(|dir| dir.join("tools").join(filename))
        .filter(|path| path.is_file())
}

fn find_executable(names: &[&str]) -> Option<PathBuf> {
    candidate_directories()
        .into_iter()
        .flat_map(|dir| {
            executable_names(names)
                .into_iter()
                .map(move |name| dir.join(name))
        })
        .find(|path| path.is_file())
}

fn executable_names(names: &[&str]) -> Vec<String> {
    if cfg!(windows) {
        names
            .iter()
            .flat_map(|name| [format!("{name}.exe"), format!("{name}.cmd")])
            .collect()
    } else {
        names.iter().map(|name| (*name).to_owned()).collect()
    }
}

fn candidate_directories() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> =
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
    if cfg!(target_os = "macos") {
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
        if let Some(home) = env::var_os("HOME") {
            let home = PathBuf::from(home);
            candidates.extend([home.join(".local/bin"), home.join(".npm-global/bin")]);
        }
    }
    if cfg!(windows) {
        for variable in ["LOCALAPPDATA", "APPDATA", "ProgramFiles"] {
            if let Some(root) = env::var_os(variable) {
                let root = PathBuf::from(root);
                candidates.extend([
                    root.join("Programs/GitHub CLI"),
                    root.join("npm"),
                    root.join("Programs/nodejs"),
                ]);
            }
        }
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

pub fn login_timeout() -> Duration {
    LOGIN_TIMEOUT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_errors_are_classified_without_returning_stderr() {
        let error = classify_failure(b"token abc-secret is invalid; authentication required");
        assert_eq!(error, CliError::SignedOut);
        assert!(!error.user_message("GitHub").contains("abc-secret"));
    }

    #[test]
    fn parses_cli_versions_without_trusting_surrounding_text() {
        assert_eq!(
            parse_version("gh version 2.66.0 (2025-01-30)"),
            Some((2, 66, 0))
        );
        assert_eq!(parse_version("Vercel CLI 50.29.0"), Some((50, 29, 0)));
        assert_eq!(parse_version("unknown"), None);
    }
}
