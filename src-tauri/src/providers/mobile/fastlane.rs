use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Discovery, Provider, Target},
};

use super::{failed_connection, unavailable_connection, unavailable_discovery, unavailable_page};

const UNAVAILABLE: &str = "fastlane deployment monitoring is unavailable because fastlane is a local automation runner, not a hosted deployment service with an account-wide deployment-history API. Monitor the GitHub, GitLab, or other CI system that runs the lane instead.";

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    let connection = connection(cli, account).await;
    unavailable_discovery(connection, account, UNAVAILABLE)
}

pub async fn connection(
    cli: Option<&CliInvocation>,
    account: &Account,
) -> crate::models::Connection {
    if account.provider != Provider::Fastlane {
        return failed_connection(account, None, "fastlane", CliError::InvalidOutput);
    }
    match cli {
        Some(cli) => match cli.version().await {
            Some(version) if valid_version_response(&version) => {
                unavailable_connection(account, Some(version), None, UNAVAILABLE)
            }
            _ => failed_connection(account, None, "fastlane", CliError::InvalidOutput),
        },
        None => unavailable_connection(account, None, None, UNAVAILABLE),
    }
}

pub async fn page(
    _cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    if target.provider != Provider::Fastlane {
        return Err(CliError::InvalidOutput);
    }
    unavailable_page(target, cursor, UNAVAILABLE)
}

fn valid_version_response(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && !value.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_synthetic_version_response_without_treating_it_as_a_session() {
        assert!(valid_version_response("fastlane 2.230.0"));
        assert!(!valid_version_response(""));
        assert!(!valid_version_response("fastlane\0secret"));
        assert!(UNAVAILABLE.contains("local automation runner"));
    }
}
