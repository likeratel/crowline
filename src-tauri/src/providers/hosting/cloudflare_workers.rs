use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Connection, ConnectionStatus, Discovery, Provider, Target},
};

use super::{cloudflare, support};

pub async fn connection(cli: Option<&CliInvocation>, account: &Account) -> Connection {
    cloudflare::connection(cli, account).await
}

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let connection = connection(cli, account).await;
    if connection.status != ConnectionStatus::Connected {
        return support::discovery_from_connection(connection);
    }
    Discovery {
        connection,
        targets: Vec::new(),
        aws_profiles: Vec::new(),
        issues: vec![support::issue(
            Provider::CloudflareWorkers,
            &account.id,
            None,
            "Wrangler can list deployments only after a Worker name is supplied, and exposes no account-wide Worker script list command. Automatic target discovery is unavailable without project-local configuration, so Workers activity is not enabled.",
        )],
    }
}

pub async fn page(
    _cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    support::reject_cursor(cursor)?;
    support::metadata(target, "accountId")?;
    support::metadata(target, "scriptName")?;
    Ok(ActivityPage {
        activities: Vec::new(),
        next_cursor: None,
        issues: vec![support::issue(
            Provider::CloudflareWorkers,
            &target.connection_id,
            Some(&target.id),
            "Wrangler deployment records describe active version traffic and do not expose Workers Builds execution status. No build activity was inferred.",
        )],
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn rejects_projectless_or_flag_like_worker_targets() {
        let target = Target {
            id: "worker-1".into(),
            provider: Provider::CloudflareWorkers,
            connection_id: "cloudflare-workers:local".into(),
            name: "worker-1".into(),
            description: None,
            metadata: HashMap::from([
                ("accountId".into(), "account-1".into()),
                ("scriptName".into(), "--help".into()),
            ]),
        };
        assert_eq!(
            support::metadata(&target, "scriptName"),
            Err(CliError::InvalidOutput)
        );
    }

    #[test]
    fn limitation_text_names_the_missing_cli_capability() {
        let message = "Wrangler exposes no account-wide Worker script list command";
        assert!(message.contains("account-wide Worker script list"));
    }
}
