use std::{io::Write, path::PathBuf};

use atomicwrites::{AllowOverwrite, AtomicFile};

use crate::models::Settings;

#[derive(Clone, Debug)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("settings.json"),
        }
    }

    pub async fn load(&self) -> Result<Settings, String> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            if !path.exists() {
                return Ok(Settings::default());
            }
            let bytes =
                std::fs::read(&path).map_err(|_| "Saved settings could not be read.".to_owned())?;
            let mut settings: Settings = serde_json::from_slice(&bytes)
                .map_err(|_| "Saved settings are not valid JSON.".to_owned())?;
            let migrated = settings.migrate_legacy();
            settings.validate()?;
            if migrated {
                write_settings(&path, &settings)?;
            }
            Ok(settings)
        })
        .await
        .map_err(|_| "Settings loading was interrupted.".to_owned())?
    }

    pub async fn save(&self, settings: Settings) -> Result<Settings, String> {
        settings.validate()?;
        let path = self.path.clone();
        let saved = settings.clone();
        tokio::task::spawn_blocking(move || write_settings(&path, &saved))
            .await
            .map_err(|_| "Settings saving was interrupted.".to_owned())??;
        Ok(settings)
    }
}

fn write_settings(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Settings path is invalid.".to_owned())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "The app data directory could not be created.".to_owned())?;
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|_| "Settings could not be serialized.".to_owned())?;
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| {
            file.write_all(&bytes)?;
            file.sync_all()
        })
        .map_err(|_| "Settings could not be saved atomically.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "crowline-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }

    #[tokio::test]
    async fn atomic_round_trip_preserves_settings() {
        let directory = test_directory("settings-round-trip");
        let store = SettingsStore::new(directory.clone());
        let settings = Settings {
            history_hours: 168,
            ..Settings::default()
        };
        store.save(settings.clone()).await.expect("save settings");
        assert_eq!(store.load().await.expect("load settings"), settings);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn load_migrates_and_persists_legacy_targets() {
        let directory = test_directory("settings-migration");
        std::fs::create_dir_all(&directory).expect("create test directory");
        let path = directory.join("settings.json");
        std::fs::write(
            &path,
            br#"{
  "scope": "mine",
  "historyHours": 24,
  "targets": [
    {"id":"example/repo","provider":"github","name":"Repository","description":null,"metadata":{}},
    {"id":"stack-id","provider":"aws","name":"Stack","description":null,"metadata":{"profile":"engineering","region":"us-east-1"}}
  ]
}"#,
        )
        .expect("write legacy settings");

        let store = SettingsStore::new(directory.clone());
        let migrated = store.load().await.expect("migrate settings");
        assert_eq!(migrated.targets.len(), 2);
        assert_eq!(
            migrated.targets[0].connection_id,
            crate::models::LOCAL_GITHUB_ID
        );
        let aws_connection_id = migrated.targets[1].connection_id.clone();
        assert!(migrated.accounts.iter().any(|account| {
            account.id == aws_connection_id
                && account.provider == crate::models::Provider::Aws
                && account.profile.as_deref() == Some("engineering")
        }));

        let persisted = store.load().await.expect("reload migrated settings");
        assert_eq!(persisted, migrated);
        let persisted_json = std::fs::read_to_string(path).expect("read migrated settings");
        assert!(persisted_json.contains("connectionId"));
        assert!(persisted_json.contains("accounts"));
        let _ = std::fs::remove_dir_all(directory);
    }
}
