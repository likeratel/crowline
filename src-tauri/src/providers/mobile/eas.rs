use std::time::Duration;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Discovery, Provider, Target},
};

use super::{
    failed_connection, missing_cli, unavailable_connection, unavailable_discovery, unavailable_page,
};

const ACCOUNT_VIEW_TIMEOUT: Duration = Duration::from_secs(15);
const UNAVAILABLE: &str = "EAS Build and Update monitoring is unavailable: the official EAS CLI can list history only for a project resolved from the current Expo app configuration, and it has no account-wide project-list command. crowline does not evaluate user app configuration or ask for manual project IDs.";

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let connection = connection(cli, account).await;
    unavailable_discovery(connection, account, UNAVAILABLE)
}

pub async fn connection(
    cli: Option<&CliInvocation>,
    account: &Account,
) -> crate::models::Connection {
    if account.provider != Provider::Eas {
        return failed_connection(account, None, "EAS", CliError::InvalidOutput);
    }
    let Some(cli) = cli else {
        return missing_cli(account, "EAS");
    };
    let version = cli.version().await;
    match cli.run(account_view_args(), ACCOUNT_VIEW_TIMEOUT).await {
        Ok(output) => match parse_account_view(&output) {
            Ok(identity) => unavailable_connection(account, version, Some(identity), UNAVAILABLE),
            Err(error) => failed_connection(account, version, "EAS", error),
        },
        Err(error) => failed_connection(account, version, "EAS", error),
    }
}

pub async fn page(
    _cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    if target.provider != Provider::Eas {
        return Err(CliError::InvalidOutput);
    }
    unavailable_page(target, cursor, UNAVAILABLE)
}

fn account_view_args() -> &'static [&'static str] {
    &["account:view"]
}

fn parse_account_view(output: &str) -> Result<String, CliError> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .filter(|line| line.len() <= 512 && !line.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or(CliError::InvalidOutput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_probe_is_read_only_and_project_independent() {
        assert_eq!(account_view_args(), &["account:view"]);
    }

    #[test]
    fn parses_only_the_identity_line_from_synthetic_account_output() {
        let identity = parse_account_view("sample-user\nsample@example.invalid\n")
            .expect("synthetic EAS account response");

        assert_eq!(identity, "sample-user");
        assert_eq!(parse_account_view("\n\t"), Err(CliError::InvalidOutput));
    }

    #[test]
    fn unavailable_reason_names_both_missing_capabilities() {
        assert!(UNAVAILABLE.contains("current Expo app configuration"));
        assert!(UNAVAILABLE.contains("no account-wide project-list command"));
    }
}
