mod cloudflare;
mod cloudflare_pages;
mod cloudflare_workers;
mod netlify;
mod railway;
mod render;
mod support;

use crate::{
    cli::{CliError, CliInvocation},
    models::{Account, ActivityPage, Connection, Discovery, Provider, Target},
};

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    match account.provider {
        Provider::Railway => railway::discover(cli, account).await,
        Provider::Netlify => netlify::discover(cli, account).await,
        Provider::Render => render::discover(cli, account).await,
        Provider::CloudflarePages => cloudflare_pages::discover(cli, account).await,
        Provider::CloudflareWorkers => cloudflare_workers::discover(cli, account).await,
        _ => support::unsupported_discovery(account),
    }
}

pub async fn connection(cli: Option<&CliInvocation>, account: &Account) -> Connection {
    match account.provider {
        Provider::Railway => railway::connection(cli, account).await,
        Provider::Netlify => netlify::connection(cli, account).await,
        Provider::Render => render::connection(cli, account).await,
        Provider::CloudflarePages => cloudflare_pages::connection(cli, account).await,
        Provider::CloudflareWorkers => cloudflare_workers::connection(cli, account).await,
        _ => support::unsupported_connection(account),
    }
}

pub async fn page(
    cli: &CliInvocation,
    target: &Target,
    cursor: Option<&str>,
    identity: Option<&str>,
) -> Result<ActivityPage, CliError> {
    match target.provider {
        Provider::Railway => railway::page(cli, target, cursor).await,
        Provider::Netlify => netlify::page(cli, target, cursor, identity).await,
        Provider::Render => render::page(cli, target, cursor).await,
        Provider::CloudflarePages => cloudflare_pages::page(cli, target, cursor).await,
        Provider::CloudflareWorkers => cloudflare_workers::page(cli, target, cursor).await,
        _ => Err(CliError::InvalidOutput),
    }
}
