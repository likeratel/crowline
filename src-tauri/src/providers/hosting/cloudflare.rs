use serde::Deserialize;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, Connection, ConnectionStatus},
};

use super::support;

const LABEL: &str = "Cloudflare Wrangler";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Identity {
    pub(super) logged_in: bool,
    pub(super) email: Option<String>,
    pub(super) accounts: Vec<CloudflareAccount>,
}

#[derive(Clone, Deserialize)]
pub(super) struct CloudflareAccount {
    pub(super) id: String,
    pub(super) name: String,
}

pub(super) async fn identity(cli: &CliInvocation) -> Result<Identity, CliError> {
    let identity: Identity = cli.json(&["whoami", "--json"]).await?;
    if !identity.logged_in || identity.accounts.is_empty() {
        return Err(CliError::SignedOut);
    }
    for account in &identity.accounts {
        support::validate_id(&account.id)?;
        if support::validate_text(&account.name, 256).is_err() {
            return Err(CliError::InvalidOutput);
        }
    }
    if identity
        .email
        .as_deref()
        .is_some_and(|email| support::validate_text(email, 512).is_err())
    {
        return Err(CliError::InvalidOutput);
    }
    Ok(identity)
}

pub(super) async fn connection(cli: Option<&CliInvocation>, account: &Account) -> Connection {
    let Some(cli) = cli else {
        return support::missing_cli(account, LABEL, "wrangler");
    };
    let version = cli.version().await;
    match identity(cli).await {
        Ok(identity) => connected(account, version, &identity),
        Err(error) => support::failed_connection(account, LABEL, error, version),
    }
}

pub(super) fn connected(
    account: &Account,
    version: Option<String>,
    identity: &Identity,
) -> Connection {
    let account_label = match identity.accounts.as_slice() {
        [single] => single.name.clone(),
        accounts => format!("{} accounts", accounts.len()),
    };
    let display = identity
        .email
        .as_deref()
        .filter(|email| !email.trim().is_empty())
        .map(|email| format!("{email} · {account_label}"))
        .unwrap_or(account_label);
    Connection {
        connection_id: account.id.clone(),
        provider: account.provider,
        status: ConnectionStatus::Connected,
        account: Some(display),
        message: None,
        cli_version: version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_current_wrangler_whoami_json_contract() {
        let identity: Identity = serde_json::from_str(
            r#"{"loggedIn":true,"authType":"OAuth Token","email":"dev@example.test","accounts":[{"id":"account-1","name":"Example Account"}],"tokenPermissions":[]}"#,
        )
        .unwrap();
        assert!(identity.logged_in);
        assert_eq!(identity.accounts[0].id, "account-1");
    }
}
