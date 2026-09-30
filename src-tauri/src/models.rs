use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

const MAX_TARGETS: usize = 500;
const MAX_ACCOUNTS: usize = 32;
const MAX_TEXT_LEN: usize = 512;

pub const LOCAL_GITHUB_ID: &str = "github:local";
pub const LOCAL_VERCEL_ID: &str = "vercel:local";
pub const AWS_DISCOVERY_ID: &str = "aws:local";

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provider {
    Github,
    Vercel,
    Aws,
    GithubDeployments,
    Railway,
    Netlify,
    Render,
    CloudflarePages,
    CloudflareWorkers,
    Heroku,
    Fly,
    Gitlab,
    Digitalocean,
    Gcloud,
    Azure,
    Eas,
    Firebase,
    Supabase,
    Fastlane,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountMode {
    Local,
    Isolated,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    pub mode: AccountMode,
    pub profile: Option<String>,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Vercel => "vercel",
            Self::Aws => "aws",
            Self::GithubDeployments => "github-deployments",
            Self::Railway => "railway",
            Self::Netlify => "netlify",
            Self::Render => "render",
            Self::CloudflarePages => "cloudflare-pages",
            Self::CloudflareWorkers => "cloudflare-workers",
            Self::Heroku => "heroku",
            Self::Fly => "fly",
            Self::Gitlab => "gitlab",
            Self::Digitalocean => "digitalocean",
            Self::Gcloud => "gcloud",
            Self::Azure => "azure",
            Self::Eas => "eas",
            Self::Firebase => "firebase",
            Self::Supabase => "supabase",
            Self::Fastlane => "fastlane",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivityStatus {
    Queued,
    Running,
    Waiting,
    Success,
    Failed,
    Canceled,
    Skipped,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ownership {
    Mine,
    Other,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub provider: Provider,
    #[serde(default)]
    pub connection_id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    #[default]
    Mine,
    All,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub scope: Scope,
    #[serde(default = "default_history_hours")]
    pub history_hours: u32,
    #[serde(default)]
    pub targets: Vec<Target>,
    #[serde(default = "default_accounts")]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub panel: crate::panel::PanelSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            scope: Scope::Mine,
            history_hours: default_history_hours(),
            targets: Vec::new(),
            accounts: default_accounts(),
            panel: crate::panel::PanelSettings::default(),
        }
    }
}

fn default_accounts() -> Vec<Account> {
    vec![
        Account {
            id: LOCAL_GITHUB_ID.into(),
            provider: Provider::Github,
            label: "GitHub (local)".into(),
            mode: AccountMode::Local,
            profile: None,
        },
        Account {
            id: LOCAL_VERCEL_ID.into(),
            provider: Provider::Vercel,
            label: "Vercel (local)".into(),
            mode: AccountMode::Local,
            profile: None,
        },
    ]
}

fn default_history_hours() -> u32 {
    24
}

impl Settings {
    pub fn migrate_legacy(&mut self) -> bool {
        let mut changed = false;
        for required in default_accounts() {
            if !self
                .accounts
                .iter()
                .any(|account| account.id == required.id)
            {
                self.accounts.push(required);
                changed = true;
            }
        }

        let mut aws_profiles = HashMap::<String, String>::new();
        for account in &self.accounts {
            if account.provider == Provider::Aws {
                if let Some(profile) = &account.profile {
                    aws_profiles.insert(profile.clone(), account.id.clone());
                }
            }
        }
        for target in &mut self.targets {
            if !target.connection_id.is_empty() {
                continue;
            }
            target.connection_id = match target.provider {
                Provider::Github => LOCAL_GITHUB_ID.into(),
                Provider::Vercel => LOCAL_VERCEL_ID.into(),
                Provider::Aws => {
                    let Some(profile) = target.metadata.get("profile").cloned() else {
                        continue;
                    };
                    aws_profiles
                        .entry(profile.clone())
                        .or_insert_with(|| {
                            let id = format!("aws-{}", uuid::Uuid::new_v4());
                            self.accounts.push(Account {
                                id: id.clone(),
                                provider: Provider::Aws,
                                label: profile.clone(),
                                mode: AccountMode::Local,
                                profile: Some(profile),
                            });
                            id
                        })
                        .clone()
                }
                provider => format!("{}:local", provider.as_str()),
            };
            changed = true;
        }
        changed
    }

    pub fn validate(&self) -> Result<(), String> {
        self.panel.validate()?;
        if !matches!(self.history_hours, 24 | 168) {
            return Err("History must be either 24 or 168 hours.".into());
        }
        if self.targets.len() > MAX_TARGETS {
            return Err(format!("At most {MAX_TARGETS} targets can be selected."));
        }
        if self.accounts.len() > MAX_ACCOUNTS {
            return Err(format!(
                "At most {MAX_ACCOUNTS} accounts can be configured."
            ));
        }
        let mut accounts = HashMap::new();
        for account in &self.accounts {
            account.validate()?;
            if accounts.insert(account.id.as_str(), account).is_some() {
                return Err("Each account must be unique.".into());
            }
        }
        for required in [LOCAL_GITHUB_ID, LOCAL_VERCEL_ID] {
            if !accounts.contains_key(required) {
                return Err("The default local CLI accounts cannot be removed.".into());
            }
        }
        let mut ids = HashSet::new();
        for target in &self.targets {
            target.validate()?;
            let account = accounts
                .get(target.connection_id.as_str())
                .ok_or_else(|| "A selected target references an unknown account.".to_owned())?;
            if account.provider != target.provider {
                return Err("A selected target references an account for another provider.".into());
            }
            if target.provider == Provider::Aws
                && target.metadata.get("profile") != account.profile.as_ref()
            {
                return Err("An AWS target does not belong to its selected profile.".into());
            }
            if !ids.insert((
                target.connection_id.as_str(),
                target.provider,
                target.id.as_str(),
            )) {
                return Err("Each selected target must be unique.".into());
            }
        }
        Ok(())
    }
}

impl Account {
    pub fn validate(&self) -> Result<(), String> {
        validate_text("Account ID", &self.id)?;
        validate_text("Account label", &self.label)?;
        if !self
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, ':' | '-'))
        {
            return Err("Account IDs contain unsupported characters.".into());
        }
        match self.provider {
            Provider::Github | Provider::Vercel => {
                if self.profile.is_some() {
                    return Err("GitHub and Vercel accounts cannot use AWS profiles.".into());
                }
                let expected_local = match self.provider {
                    Provider::Github => LOCAL_GITHUB_ID,
                    Provider::Vercel => LOCAL_VERCEL_ID,
                    _ => unreachable!(),
                };
                if (self.mode == AccountMode::Local) != (self.id == expected_local) {
                    return Err(
                        "Only the built-in GitHub and Vercel accounts can use local CLI mode."
                            .into(),
                    );
                }
            }
            Provider::Aws => {
                if self.mode != AccountMode::Local {
                    return Err("AWS profile accounts must use local mode.".into());
                }
                validate_text(
                    "AWS profile",
                    self.profile
                        .as_deref()
                        .ok_or_else(|| "AWS accounts require a profile.".to_owned())?,
                )?;
            }
            _ => {
                if self.mode != AccountMode::Local
                    || self.profile.is_some()
                    || self.id != format!("{}:local", self.provider.as_str())
                {
                    return Err("This provider reuses one existing local CLI session.".into());
                }
            }
        }
        if self.id == LOCAL_GITHUB_ID
            && (self.provider != Provider::Github || self.mode != AccountMode::Local)
            || self.id == LOCAL_VERCEL_ID
                && (self.provider != Provider::Vercel || self.mode != AccountMode::Local)
        {
            return Err("The default local account is invalid.".into());
        }
        Ok(())
    }
}

impl Target {
    pub fn validate(&self) -> Result<(), String> {
        validate_text("Target ID", &self.id)?;
        validate_text("Target name", &self.name)?;
        if self.id.chars().any(char::is_whitespace) {
            return Err("Target IDs cannot contain whitespace.".into());
        }
        if self
            .description
            .as_ref()
            .is_some_and(|value| value.len() > MAX_TEXT_LEN * 4)
        {
            return Err("Target descriptions are too long.".into());
        }
        if self.metadata.len() > 32
            || self
                .metadata
                .iter()
                .any(|(key, value)| key.is_empty() || key.len() > 128 || value.len() > MAX_TEXT_LEN)
        {
            return Err("Target metadata is invalid or too large.".into());
        }
        Ok(())
    }
}

fn validate_text(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > MAX_TEXT_LEN || value.contains('\0') {
        Err(format!("{label} is invalid."))
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionStatus {
    Connected,
    SignedOut,
    MissingCli,
    Error,
    Unconfigured,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub connection_id: String,
    pub provider: Provider,
    pub status: ConnectionStatus,
    pub account: Option<String>,
    pub message: Option<String>,
    pub cli_version: Option<String>,
}

impl Connection {
    pub fn disconnected(
        connection_id: impl Into<String>,
        provider: Provider,
        status: ConnectionStatus,
        message: impl Into<String>,
    ) -> Self {
        Self {
            connection_id: connection_id.into(),
            provider,
            status,
            account: None,
            message: Some(message.into()),
            cli_version: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub provider: Provider,
    pub connection_id: String,
    pub target_id: String,
    pub kind: String,
    pub title: String,
    pub project: String,
    pub branch: Option<String>,
    pub url: String,
    pub status: ActivityStatus,
    pub raw_status: String,
    pub actor: Option<String>,
    pub ownership: Ownership,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub provider: Provider,
    pub connection_id: Option<String>,
    pub message: String,
    pub target_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub connections: Vec<Connection>,
    pub activities: Vec<Activity>,
    pub issues: Vec<Issue>,
    pub refreshing: bool,
    pub last_updated_at: Option<String>,
    #[serde(default)]
    pub history: Vec<TargetHistory>,
    #[serde(default)]
    pub pending_targets: Vec<String>,
}

impl Snapshot {
    pub fn initial(settings: Settings) -> Self {
        Self {
            settings,
            connections: Vec::new(),
            activities: Vec::new(),
            issues: Vec::new(),
            refreshing: false,
            last_updated_at: None,
            history: Vec::new(),
            pending_targets: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub connection: Connection,
    pub targets: Vec<Target>,
    pub aws_profiles: Vec<String>,
    pub issues: Vec<Issue>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LoginState {
    Waiting,
    Complete,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub connection_id: String,
    pub provider: Provider,
    pub state: LoginState,
    pub message: String,
    pub url: Option<String>,
    pub code: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_reject_invalid_history_and_duplicate_targets() {
        let target = Target {
            id: "repo".into(),
            provider: Provider::Github,
            connection_id: LOCAL_GITHUB_ID.into(),
            name: "Repository".into(),
            description: None,
            metadata: HashMap::new(),
        };
        assert!(Settings {
            history_hours: 48,
            ..Settings::default()
        }
        .validate()
        .is_err());
        assert!(Settings {
            targets: vec![target.clone(), target],
            ..Settings::default()
        }
        .validate()
        .is_err());
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub activities: Vec<Activity>,
    pub next_cursor: Option<String>,
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetHistory {
    pub connection_id: String,
    pub target_id: String,
    pub provider: Provider,
    pub next_cursor: Option<String>,
    pub checked_at: String,
    pub generation: u64,
}

impl Target {
    pub fn key(&self) -> String {
        format!(
            "{}:{}:{}",
            self.provider.as_str(),
            self.connection_id,
            self.id
        )
    }
}
