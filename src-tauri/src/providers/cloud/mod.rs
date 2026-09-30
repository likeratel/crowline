pub mod azure;
pub mod digitalocean;
pub mod fly;
pub mod gcloud;
pub mod gitlab;
mod gitlab_pipelines;
pub mod heroku;

mod support;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Connection, Discovery, Provider, Target},
};

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    match account.provider {
        Provider::Gitlab => gitlab::discover(cli, account).await,
        Provider::Heroku => heroku::discover(cli, account).await,
        Provider::Fly => fly::discover(cli, account).await,
        Provider::Digitalocean => digitalocean::discover(cli, account).await,
        Provider::Gcloud => gcloud::discover(cli, account).await,
        Provider::Azure => azure::discover(cli, account).await,
        _ => support::discovery_from_connection(Connection::disconnected(
            &account.id,
            account.provider,
            crate::models::ConnectionStatus::Error,
            "The selected account is not a cloud CLI provider.",
        )),
    }
}

pub async fn connection(cli: Option<&CliInvocation>, account: &Account) -> Connection {
    match account.provider {
        Provider::Gitlab => gitlab::connection(cli, account).await,
        Provider::Heroku => heroku::connection(cli, account).await,
        Provider::Fly => fly::connection(cli, account).await,
        Provider::Digitalocean => digitalocean::connection(cli, account).await,
        Provider::Gcloud => gcloud::connection(cli, account).await,
        Provider::Azure => azure::connection(cli, account).await,
        _ => Connection::disconnected(
            &account.id,
            account.provider,
            crate::models::ConnectionStatus::Error,
            "The selected account is not a cloud CLI provider.",
        ),
    }
}

pub async fn page(
    cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
) -> Result<ActivityPage, CliError> {
    match target.provider {
        Provider::Gitlab => gitlab::page(cli, target, cursor).await,
        Provider::Heroku => heroku::page(cli, target, cursor).await,
        Provider::Fly => fly::page(cli, target, cursor).await,
        Provider::Digitalocean => digitalocean::page(cli, target, cursor).await,
        Provider::Gcloud => gcloud::page(cli, target, cursor).await,
        Provider::Azure => azure::page(cli, target, cursor).await,
        _ => Err(CliError::InvalidOutput),
    }
}
