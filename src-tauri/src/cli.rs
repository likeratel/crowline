use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsString,
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

use crate::models::{Account, AccountMode, Provider};

const GITHUB_KEYRING_NAMESPACE: &str = "CROWLINE_GH_KEYRING_NAMESPACE";
const ISOLATED_GITHUB_VERSION_MARKER: &str = "2.65.0-crowline.1";

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROCESS_GATE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT_BYTES: u64 = 8 * 1024 * 1024 + 1;

#[derive(Clone, Debug)]
pub struct CliInvocation {
    program: PathBuf,
    prefix_args: Vec<String>,
    process_gate: std::sync::Arc<Semaphore>,
    environment: Vec<(OsString, OsString)>,
    removed_environment: Vec<OsString>,
    version_cache: std::sync::Arc<tokio::sync::OnceCell<Option<String>>>,
}

impl CliInvocation {
    fn direct(program: PathBuf, process_gate: std::sync::Arc<Semaphore>) -> Self {
        Self {
            program,
            prefix_args: Vec::new(),
            process_gate,
            environment: Vec::new(),
            removed_environment: Vec::new(),
            version_cache: std::sync::Arc::new(tokio::sync::OnceCell::new()),
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
            environment: Vec::new(),
            removed_environment: Vec::new(),
            version_cache: std::sync::Arc::new(tokio::sync::OnceCell::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(program: PathBuf) -> Self {
        Self::direct(program, std::sync::Arc::new(Semaphore::new(4)))
    }

    pub async fn version(&self) -> Option<String> {
        self.version_cache
            .get_or_init(|| async {
                self.run(&["--version"], Duration::from_secs(5))
                    .await
                    .ok()
                    .and_then(|output| output.lines().next().map(str::trim).map(str::to_owned))
                    .filter(|version| !version.is_empty())
            })
            .await
            .clone()
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
        for name in &self.removed_environment {
            command.env_remove(name);
        }
        command.envs(self.environment.iter().cloned());

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
        for name in &self.removed_environment {
            command.env_remove(name);
        }
        command.envs(self.environment.iter().cloned());
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

#[derive(Debug)]
pub struct Toolchain {
    pub github: Option<CliInvocation>,
    github_isolated: Option<CliInvocation>,
    pub vercel: Option<CliInvocation>,
    pub aws: Option<CliInvocation>,
    local: HashMap<Provider, CliInvocation>,
    account_config_root: PathBuf,
    account_gates: std::sync::Mutex<HashMap<String, std::sync::Arc<Semaphore>>>,
}

impl Toolchain {
    pub async fn discover(resource_dir: Option<&Path>, app_data_dir: &Path) -> Self {
        let github_gate = std::sync::Arc::new(Semaphore::new(1));
        let system_github =
            find_executable(&["gh"]).map(|path| CliInvocation::direct(path, github_gate.clone()));
        let bundled_github = bundled_executable(resource_dir, "gh")
            .map(|path| CliInvocation::direct(path, github_gate));
        let github = select_supported(system_github, bundled_github, (2, 65, 0)).await;
        let isolated_github_gate = std::sync::Arc::new(Semaphore::new(1));
        let bundled_isolated_github = bundled_executable(resource_dir, "gh-isolated")
            .map(|path| CliInvocation::direct(path, isolated_github_gate));
        let github_isolated =
            select_version_marker(bundled_isolated_github, ISOLATED_GITHUB_VERSION_MARKER).await;

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
            github_isolated,
            vercel,
            aws,
            local: crate::providers::catalog::local_tools()
                .iter()
                .filter_map(|(provider, names)| {
                    find_executable(names).map(|path| {
                        (
                            *provider,
                            CliInvocation::direct(path, std::sync::Arc::new(Semaphore::new(4))),
                        )
                    })
                })
                .collect(),
            account_config_root: app_data_dir.join("accounts"),
            account_gates: std::sync::Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn unavailable_for_test(app_data_dir: &Path) -> Self {
        Self {
            github: None,
            github_isolated: None,
            vercel: None,
            aws: None,
            local: HashMap::new(),
            account_config_root: app_data_dir.join("accounts"),
            account_gates: std::sync::Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn github_for_test(app_data_dir: &Path, cli: CliInvocation) -> Self {
        Self {
            github: Some(cli),
            ..Self::unavailable_for_test(app_data_dir)
        }
    }

    pub fn invocation_for(&self, account: &Account) -> Result<Option<CliInvocation>, String> {
        if account.provider == Provider::Bitbucket {
            account.validate()?;
            return Ok(None);
        }
        self.prepare_account(account)?;
        let base = match (account.provider, account.mode) {
            (Provider::Github, AccountMode::Isolated) => {
                Some(self.github_isolated.as_ref().ok_or_else(|| {
                    "The bundled isolated GitHub helper is unavailable or has an unsupported version."
                        .to_owned()
                })?)
            }
            (Provider::Github, AccountMode::Local) => self.github.as_ref(),
            (Provider::Vercel, _) => self.vercel.as_ref(),
            (Provider::Aws, _) => self.aws.as_ref(),
            (Provider::GithubDeployments, _) => self.github.as_ref(),
            (provider, _) => self.local.get(&provider),
        };
        let Some(base) = base else {
            return Ok(None);
        };
        let gate = {
            let mut gates = self
                .account_gates
                .lock()
                .map_err(|_| "CLI account coordination is unavailable.".to_owned())?;
            gates
                .entry(account.id.clone())
                .or_insert_with(|| std::sync::Arc::new(Semaphore::new(4)))
                .clone()
        };
        let mut invocation = base.clone();
        invocation.process_gate = gate;
        invocation.removed_environment = provider_environment(account.provider)
            .iter()
            .map(OsString::from)
            .collect();

        if account.mode == AccountMode::Isolated {
            let directory = self.account_config_root.join(&account.id);
            match account.provider {
                Provider::Github => invocation.environment.extend([
                    (OsString::from("GH_CONFIG_DIR"), directory.into_os_string()),
                    (
                        OsString::from(GITHUB_KEYRING_NAMESPACE),
                        OsString::from(&account.id),
                    ),
                ]),
                Provider::Vercel => invocation.prefix_args.extend([
                    "--global-config".into(),
                    directory.to_string_lossy().into_owned(),
                ]),
                _ => return Err("This provider cannot use isolated CLI mode.".into()),
            }
        }
        Ok(Some(invocation))
    }

    pub fn prepare_account(&self, account: &Account) -> Result<(), String> {
        account.validate()?;
        if account.mode == AccountMode::Isolated && account.provider != Provider::Bitbucket {
            create_private_directory(&self.account_config_root.join(&account.id))?;
        }
        Ok(())
    }
}

fn provider_environment(provider: Provider) -> &'static [&'static str] {
    match provider {
        Provider::Github | Provider::GithubDeployments => &[
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GH_ENTERPRISE_TOKEN",
            "GITHUB_ENTERPRISE_TOKEN",
            "GH_HOST",
            GITHUB_KEYRING_NAMESPACE,
        ],
        Provider::Vercel => &[
            "VERCEL_TOKEN",
            "VERCEL_TEAM_ID",
            "VERCEL_ORG_ID",
            "VERCEL_PROJECT_ID",
            "VERCEL_SCOPE",
        ],
        Provider::Eas => &["EXPO_TOKEN"],
        Provider::Firebase => &["FIREBASE_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS"],
        Provider::Supabase => &["SUPABASE_ACCESS_TOKEN"],
        _ => &[],
    }
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|_| "The isolated CLI configuration directory could not be created.".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|_| {
            "The isolated CLI configuration directory could not be secured.".to_owned()
        })?;
    }
    Ok(())
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

async fn select_version_marker(
    candidate: Option<CliInvocation>,
    required_marker: &str,
) -> Option<CliInvocation> {
    let candidate = candidate?;
    candidate
        .version()
        .await
        .is_some_and(|version| has_version_marker(&version, required_marker))
        .then_some(candidate)
}

fn has_version_marker(version: &str, required_marker: &str) -> bool {
    version
        .split_ascii_whitespace()
        .any(|token| token == required_marker)
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
        assert!(has_version_marker(
            "gh version 2.65.0-crowline.1",
            ISOLATED_GITHUB_VERSION_MARKER
        ));
        assert!(!has_version_marker(
            "gh version 2.65.0-crowline.10",
            ISOLATED_GITHUB_VERSION_MARKER
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn version_is_cached_across_concurrent_invocation_clones() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("crowline-version-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("fake-cli");
        std::fs::write(
            &script,
            "#!/bin/sh\nprintf '1' >> \"$0.calls\"\nprintf 'fixture 1.0.0\\n'\n",
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let cli = CliInvocation::for_test(script.clone());
        let clone = cli.clone();
        let (first, second) = tokio::join!(cli.version(), clone.version());
        assert_eq!(first, second);
        assert_eq!(first.as_deref(), Some("fixture 1.0.0"));
        assert_eq!(
            std::fs::read_to_string(script.with_extension("calls")).unwrap(),
            "1"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn account_invocations_isolate_credentials_and_require_patched_github() {
        let root = std::env::temp_dir().join(format!("crowline-cli-test-{}", std::process::id()));
        let mut toolchain = Toolchain {
            github: Some(CliInvocation::direct(
                PathBuf::from("gh"),
                std::sync::Arc::new(Semaphore::new(1)),
            )),
            github_isolated: Some(CliInvocation::direct(
                PathBuf::from("gh-isolated"),
                std::sync::Arc::new(Semaphore::new(1)),
            )),
            vercel: Some(CliInvocation::direct(
                PathBuf::from("vercel"),
                std::sync::Arc::new(Semaphore::new(1)),
            )),
            aws: None,
            local: HashMap::new(),
            account_config_root: root.clone(),
            account_gates: std::sync::Mutex::new(HashMap::new()),
        };
        let local_github = toolchain
            .invocation_for(&Account {
                id: crate::models::LOCAL_GITHUB_ID.into(),
                provider: Provider::Github,
                label: "Local".into(),
                mode: AccountMode::Local,
                profile: None,
            })
            .expect("configure local GitHub")
            .expect("local GitHub CLI");
        assert_eq!(local_github.program, PathBuf::from("gh"));
        assert!(local_github
            .removed_environment
            .contains(&OsString::from(GITHUB_KEYRING_NAMESPACE)));
        assert!(local_github
            .environment
            .iter()
            .all(|(name, _)| name != GITHUB_KEYRING_NAMESPACE));

        let isolated_github = toolchain
            .invocation_for(&Account {
                id: "github-test".into(),
                provider: Provider::Github,
                label: "Work".into(),
                mode: AccountMode::Isolated,
                profile: None,
            })
            .expect("configure isolated GitHub")
            .expect("patched GitHub CLI");
        assert_eq!(isolated_github.program, PathBuf::from("gh-isolated"));
        assert!(isolated_github.environment.contains(&(
            OsString::from(GITHUB_KEYRING_NAMESPACE),
            OsString::from("github-test")
        )));
        assert!(isolated_github
            .environment
            .iter()
            .any(|(name, value)| name == "GH_CONFIG_DIR" && value == &root.join("github-test")));

        let vercel = toolchain
            .invocation_for(&Account {
                id: "vercel-test".into(),
                provider: Provider::Vercel,
                label: "Company".into(),
                mode: AccountMode::Isolated,
                profile: None,
            })
            .expect("configure Vercel")
            .expect("Vercel CLI");
        assert!(vercel
            .removed_environment
            .contains(&OsString::from("VERCEL_TOKEN")));
        assert_eq!(vercel.prefix_args[0], "--global-config");

        toolchain.github_isolated = None;
        let error = toolchain
            .invocation_for(&Account {
                id: "github-missing".into(),
                provider: Provider::Github,
                label: "Missing".into(),
                mode: AccountMode::Isolated,
                profile: None,
            })
            .expect_err("unpatched fallback must not be used");
        assert!(error.contains("bundled isolated GitHub helper"));
        let _ = std::fs::remove_dir_all(root);
    }
}
