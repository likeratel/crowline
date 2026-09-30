use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::models::{Activity, ActivityStatus, Provider, Settings};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PanelSettings {
    pub providers: Vec<Provider>,
    pub hidden_targets: Vec<String>,
    pub show_active: bool,
    pub show_completed: bool,
    pub row_limit: usize,
}

impl Default for PanelSettings {
    fn default() -> Self {
        Self {
            providers: vec![Provider::Github, Provider::Vercel, Provider::Aws],
            hidden_targets: Vec::new(),
            show_active: true,
            show_completed: true,
            row_limit: 5,
        }
    }
}

impl PanelSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=10).contains(&self.row_limit)
            || self.providers.len() > 32
            || self.hidden_targets.len() > 500
            || self
                .hidden_targets
                .iter()
                .any(|key| key.is_empty() || key.len() > 1600)
        {
            return Err("Status panel settings are invalid.".into());
        }
        Ok(())
    }

    pub fn includes(&self, activity: &Activity, settings: &Settings) -> bool {
        self.providers.contains(&activity.provider)
            && settings.targets.iter().any(|target| {
                target.connection_id == activity.connection_id
                    && target.provider == activity.provider
                    && target.id == activity.target_id
                    && !self.hidden_targets.contains(&format!(
                        "{}:{}:{}",
                        target.provider.as_str(),
                        target.connection_id,
                        target.id
                    ))
            })
    }
}

pub fn is_blocked(activity: &Activity) -> bool {
    activity.provider == Provider::Vercel && activity.raw_status.eq_ignore_ascii_case("BLOCKED")
}

pub fn visible_activity(activity: &Activity, now: DateTime<Utc>) -> bool {
    if is_blocked(activity) {
        return false;
    }
    if matches!(
        activity.status,
        ActivityStatus::Queued | ActivityStatus::Running | ActivityStatus::Waiting
    ) {
        return DateTime::parse_from_rfc3339(&activity.started_at)
            .is_ok_and(|started| started >= now - Duration::hours(24));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Ownership;

    fn activity() -> Activity {
        Activity {
            id: "deployment".into(),
            provider: Provider::Vercel,
            connection_id: "vercel:local".into(),
            target_id: "prj_demo".into(),
            kind: "preview".into(),
            title: "Demo".into(),
            project: "demo".into(),
            branch: None,
            url: "https://vercel.com/demo".into(),
            status: ActivityStatus::Waiting,
            raw_status: "QUEUED".into(),
            actor: None,
            ownership: Ownership::Mine,
            started_at: "2026-09-28T12:00:00Z".into(),
            finished_at: None,
            updated_at: "2026-09-29T12:00:00Z".into(),
        }
    }

    #[test]
    fn exact_age_boundary_uses_start_and_keeps_completed_history() {
        let now = DateTime::parse_from_rfc3339("2026-09-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let run = activity();
        assert!(visible_activity(&run, now));
        assert!(!visible_activity(&run, now + Duration::milliseconds(1)));
        assert!(visible_activity(
            &Activity {
                status: ActivityStatus::Success,
                ..run
            },
            now + Duration::days(2)
        ));
    }

    #[test]
    fn cached_blocked_is_hidden_but_other_waiting_is_kept() {
        let now = DateTime::parse_from_rfc3339("2026-09-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(visible_activity(&activity(), now));
        assert!(!visible_activity(
            &Activity {
                raw_status: "BLOCKED".into(),
                ..activity()
            },
            now
        ));
    }

    #[test]
    fn legacy_settings_default_panel_and_invalid_limits_fail() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings.panel, PanelSettings::default());
        for row_limit in [0, 11] {
            assert!(PanelSettings {
                row_limit,
                ..PanelSettings::default()
            }
            .validate()
            .is_err());
        }
    }
}
