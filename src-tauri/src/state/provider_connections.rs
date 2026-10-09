use super::*;
use crate::cloudflare_credentials::{self, CloudflareCredential};

impl AppState {
    pub async fn connect_cloudflare<P: SnapshotPublisher>(
        &self,
        provider: Provider,
        credential: CloudflareCredential,
        connection_id: Option<&str>,
        publisher: &P,
    ) -> Result<Account, String> {
        self.ensure_settings_writable()?;
        if !matches!(
            provider,
            Provider::CloudflarePages | Provider::CloudflareWorkers
        ) {
            return Err("Select a Cloudflare service.".into());
        }
        let _publish = self.publish_lock.lock().await;
        let previous = self.snapshot().await;
        if let Some(id) = connection_id {
            let account = previous
                .settings
                .accounts
                .iter()
                .find(|a| a.id == id && a.provider == provider && a.mode == AccountMode::Isolated)
                .ok_or_else(|| {
                    "Add a Cloudflare API connection before updating its token.".to_owned()
                })?;
            if account.profile.as_deref() != Some(credential.account_id.as_str()) {
                return Err("This token connection is for a different Cloudflare account. Existing projects were preserved.".into());
            }
            cloudflare_credentials::set(provider, id, credential).await?;
            self.refresh_epoch.fetch_add(1, Ordering::SeqCst);
            self.request_refresh();
            return Ok(account.clone());
        }
        if previous.settings.accounts.iter().any(|a| {
            a.provider == provider && a.profile.as_deref() == Some(credential.account_id.as_str())
        }) {
            return Err("This Cloudflare account is already connected. Use Update token.".into());
        }
        let account = Account {
            id: format!("{}:{}", provider.as_str(), uuid::Uuid::new_v4()),
            provider,
            label: format!(
                "Cloudflare · {}",
                credential.account_id.get(..8).unwrap_or("account")
            ),
            mode: AccountMode::Isolated,
            profile: Some(credential.account_id.clone()),
            cli_username: None,
        };
        account.validate()?;
        let mut settings = previous.settings.clone();
        settings.accounts.push(account.clone());
        if !settings.panel.providers.contains(&provider) {
            settings.panel.providers.push(provider);
        }
        settings.validate()?;
        cloudflare_credentials::set(provider, &account.id, credential).await?;
        if let Err(message) = self
            .publish_settings_locked(settings, previous, publisher)
            .await
        {
            return match cloudflare_credentials::delete(provider, &account.id).await {
                Ok(()) => Err(message),
                Err(cleanup) => Err(format!(
                    "{message} Credential cleanup also failed: {cleanup}"
                )),
            };
        }
        self.request_refresh();
        Ok(account)
    }

    pub async fn register_eas_project<P: SnapshotPublisher>(
        &self,
        connection_id: &str,
        project_id: &str,
        owner: &str,
        slug: &str,
        publisher: &P,
    ) -> Result<Vec<Target>, String> {
        self.ensure_settings_writable()?;
        let account = self.account(connection_id, Provider::Eas).await?;
        let cli = self
            .tools
            .invocation_for(&account)?
            .ok_or_else(|| "Install EAS CLI and sign in with eas login.".to_owned())?;
        let targets = crate::providers::mobile::eas::register_project(
            &cli, &account, project_id, owner, slug,
        )
        .await?;
        let _publish = self.publish_lock.lock().await;
        let previous = self.snapshot().await;
        if !previous.settings.accounts.contains(&account) {
            return Err("The EAS connection changed during verification. Try again.".into());
        }
        let settings = apply_settings_change(
            previous.settings.clone(),
            SettingsChange::Targets {
                targets: targets.clone(),
                selected: true,
            },
            &previous.activities,
        )?;
        self.publish_settings_locked(settings, previous, publisher)
            .await?;
        self.request_refresh();
        Ok(targets)
    }
}
