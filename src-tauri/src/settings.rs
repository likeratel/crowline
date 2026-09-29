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
                std::fs::read(path).map_err(|_| "Saved settings could not be read.".to_owned())?;
            let settings: Settings = serde_json::from_slice(&bytes)
                .map_err(|_| "Saved settings are not valid JSON.".to_owned())?;
            settings.validate()?;
            Ok(settings)
        })
        .await
        .map_err(|_| "Settings loading was interrupted.".to_owned())?
    }

    pub async fn save(&self, settings: Settings) -> Result<Settings, String> {
        settings.validate()?;
        let path = self.path.clone();
        let saved = settings.clone();
        tokio::task::spawn_blocking(move || {
            let parent = path
                .parent()
                .ok_or_else(|| "Settings path is invalid.".to_owned())?;
            std::fs::create_dir_all(parent)
                .map_err(|_| "The app data directory could not be created.".to_owned())?;
            let bytes = serde_json::to_vec_pretty(&saved)
                .map_err(|_| "Settings could not be serialized.".to_owned())?;
            AtomicFile::new(path, AllowOverwrite)
                .write(|file| {
                    file.write_all(&bytes)?;
                    file.sync_all()
                })
                .map_err(|_| "Settings could not be saved atomically.".to_owned())
        })
        .await
        .map_err(|_| "Settings saving was interrupted.".to_owned())??;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn atomic_round_trip_preserves_settings() {
        let directory = std::env::temp_dir().join(format!(
            "crowline-settings-test-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("unnamed")
        ));
        let store = SettingsStore::new(directory.clone());
        let settings = Settings {
            history_hours: 168,
            ..Settings::default()
        };
        store.save(settings.clone()).await.expect("save settings");
        assert_eq!(store.load().await.expect("load settings"), settings);
        let _ = std::fs::remove_dir_all(directory);
    }
}
