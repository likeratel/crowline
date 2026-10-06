use serde::de::DeserializeOwned;

use crate::{
    cli::{CliError, CliInvocation},
    models::Provider,
};

#[derive(Clone, Debug)]
pub(crate) struct ApiClient {
    cli: CliInvocation,
    provider: Provider,
}

impl ApiClient {
    pub(crate) fn github(cli: &CliInvocation) -> Self {
        Self {
            cli: cli.clone(),
            provider: Provider::Github,
        }
    }

    pub(crate) fn vercel(cli: &CliInvocation) -> Self {
        Self {
            cli: cli.clone(),
            provider: Provider::Vercel,
        }
    }

    pub(crate) fn expected_identity(&self) -> Option<&str> {
        self.cli.expected_identity()
    }

    pub(crate) async fn github_get<T: DeserializeOwned>(
        &self,
        endpoint: &str,
    ) -> Result<T, CliError> {
        if self.provider != Provider::Github {
            return Err(CliError::InvalidOutput);
        }
        self.cli.github_json(endpoint).await
    }

    pub(crate) async fn vercel_get<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        scope: Option<&str>,
    ) -> Result<T, CliError> {
        if self.provider != Provider::Vercel {
            return Err(CliError::InvalidOutput);
        }
        self.cli.vercel_json(endpoint, scope).await
    }
}
