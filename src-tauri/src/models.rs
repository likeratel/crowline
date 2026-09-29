use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

const MAX_TARGETS: usize = 500;
const MAX_TEXT_LEN: usize = 512;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Github,
    Vercel,
    Aws,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Vercel => "vercel",
            Self::Aws => "aws",
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            scope: Scope::Mine,
            history_hours: default_history_hours(),
            targets: Vec::new(),
        }
    }
}

fn default_history_hours() -> u32 {
    24
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.history_hours, 24 | 168) {
            return Err("History must be either 24 or 168 hours.".into());
        }
        if self.targets.len() > MAX_TARGETS {
            return Err(format!("At most {MAX_TARGETS} targets can be selected."));
        }
        let mut ids = HashSet::new();
        for target in &self.targets {
            target.validate()?;
            if !ids.insert((target.provider, target.id.as_str())) {
                return Err("Each selected target must be unique.".into());
            }
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
    pub provider: Provider,
    pub status: ConnectionStatus,
    pub account: Option<String>,
    pub message: Option<String>,
    pub cli_version: Option<String>,
}

impl Connection {
    pub fn disconnected(
        provider: Provider,
        status: ConnectionStatus,
        message: impl Into<String>,
    ) -> Self {
        Self {
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
