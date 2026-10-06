use super::{aws, bitbucket, cloud, github, github_deployments, hosting, mobile, vercel};
use crate::{
    cli::CliInvocation,
    models::{Account, ActivityPage, Connection, Discovery, Provider, Target},
};

pub fn local_tools() -> &'static [(Provider, &'static [&'static str])] {
    &[
        (Provider::Railway, &["railway"]),
        (Provider::Netlify, &["netlify"]),
        (Provider::Render, &["render"]),
        (Provider::CloudflarePages, &["wrangler"]),
        (Provider::CloudflareWorkers, &["wrangler"]),
        (Provider::Heroku, &["heroku"]),
        (Provider::Fly, &["fly", "flyctl"]),
        (Provider::Gitlab, &["glab"]),
        (Provider::Digitalocean, &["doctl"]),
        (Provider::Gcloud, &["gcloud"]),
        (Provider::Azure, &["az"]),
        (Provider::Eas, &["eas"]),
        (Provider::Firebase, &["firebase"]),
        (Provider::Supabase, &["supabase"]),
    ]
}

pub fn supported(provider: Provider) -> bool {
    !matches!(
        provider,
        Provider::Eas
            | Provider::Fastlane
            | Provider::Supabase
            | Provider::Firebase
            | Provider::CloudflarePages
            | Provider::CloudflareWorkers
    )
}

pub fn limitation(provider: Provider) -> &'static str {
    match provider {
        Provider::Eas => "EAS requires project context; the official CLI does not provide automatic account-wide project discovery.",
        Provider::Firebase => "Firebase CLI does not expose reliable deployment history through its local session.",
        Provider::CloudflarePages => "Wrangler deployment output omits the timestamps needed for reliable deployment monitoring.",
        Provider::CloudflareWorkers => "Wrangler does not expose account-wide Worker discovery and build history.",
        Provider::Fastlane => "fastlane has no central deployment history. Monitor the GitHub Actions or GitLab pipeline that runs your lane.",
        Provider::Supabase => "Function ACTIVE status is not a deployment result. A reliable deployment history is not available through the local CLI.",
        _ => "This provider requires its installed CLI and an existing authenticated session.",
    }
}

pub async fn connection(
    cli: Option<&CliInvocation>,
    account: &Account,
    target: Option<&Target>,
) -> Connection {
    match account.provider {
        Provider::Github => github::connection(cli, &account.id).await,
        Provider::GithubDeployments => {
            let result = github::connection(cli, &account.id).await;
            Connection {
                provider: Provider::GithubDeployments,
                ..result
            }
        }
        Provider::Vercel => vercel::connection(cli, &account.id).await,
        Provider::Aws => {
            aws::connection(
                account.profile.clone(),
                target.and_then(|t| t.metadata.get("region")).cloned(),
                &account.id,
            )
            .await
        }
        Provider::Bitbucket => bitbucket::connection(account).await,
        Provider::Railway
        | Provider::Netlify
        | Provider::Render
        | Provider::CloudflarePages
        | Provider::CloudflareWorkers => hosting::connection(cli, account).await,
        Provider::Heroku
        | Provider::Fly
        | Provider::Gitlab
        | Provider::Digitalocean
        | Provider::Gcloud
        | Provider::Azure => cloud::connection(cli, account).await,
        _ => mobile::connection(cli, account).await,
    }
}

pub async fn discover(cli: Option<&CliInvocation>, account: &Account) -> Discovery {
    match account.provider {
        Provider::Github => github::discover(cli, &account.id).await,
        Provider::Vercel => vercel::discover(cli, &account.id).await,
        Provider::Aws => aws::discover(account.profile.clone(), None, &account.id)
            .await
            .unwrap_or_else(|message| Discovery {
                connection: Connection::disconnected(
                    &account.id,
                    account.provider,
                    crate::models::ConnectionStatus::Error,
                    message.clone(),
                ),
                targets: Vec::new(),
                aws_profiles: Vec::new(),
                issues: vec![crate::models::Issue {
                    provider: account.provider,
                    connection_id: Some(account.id.clone()),
                    target_id: None,
                    message,
                }],
            }),
        Provider::GithubDeployments => github_deployments::discover(cli, account).await,
        Provider::Bitbucket => bitbucket::discover(account).await,
        Provider::Railway
        | Provider::Netlify
        | Provider::Render
        | Provider::CloudflarePages
        | Provider::CloudflareWorkers => hosting::discover(cli, account).await,
        Provider::Heroku
        | Provider::Fly
        | Provider::Gitlab
        | Provider::Digitalocean
        | Provider::Gcloud
        | Provider::Azure => cloud::discover(cli, account).await,
        _ => mobile::discover(cli, account).await,
    }
}

pub fn has_active_scan(provider: Provider) -> bool {
    matches!(
        provider,
        Provider::Github | Provider::Vercel | Provider::Bitbucket
    )
}

pub async fn active(
    cli: Option<&CliInvocation>,
    target: &Target,
    identity: Option<&str>,
) -> Result<ActivityPage, String> {
    if target.provider == Provider::Bitbucket {
        return bitbucket::active(target).await;
    }
    let cli = cli.ok_or_else(|| {
        format!(
            "{} CLI is not installed or this account must be reconnected.",
            target.provider.as_str()
        )
    })?;
    match target.provider {
        Provider::Github => github::active(cli, target, identity).await,
        Provider::Vercel => vercel::active(cli, target, identity).await,
        _ => return Ok(ActivityPage::default()),
    }
    .map_err(|error| error.user_message(target.provider.as_str()))
}

pub async fn page(
    cli: Option<&CliInvocation>,
    target: &Target,
    cursor: Option<&str>,
    identity: Option<&str>,
    hours: u32,
) -> Result<ActivityPage, String> {
    target.validate()?;
    if cursor.is_some_and(|value| {
        value.is_empty() || value.len() > 2048 || value.chars().any(char::is_control)
    }) {
        return Err("Invalid history cursor.".into());
    }
    if target.provider == Provider::Aws {
        return aws::page(target, cursor, hours).await;
    }
    if target.provider == Provider::Bitbucket {
        return bitbucket::page(target, cursor).await;
    }
    let api_result = match target.provider {
        Provider::Github => Some(match cli {
            Some(cli) => github::page(cli, target, cursor, identity).await,
            None => Err(crate::cli::CliError::Unavailable),
        }),
        Provider::Vercel => Some(match cli {
            Some(cli) => vercel::page(cli, target, cursor, identity).await,
            None => Err(crate::cli::CliError::Unavailable),
        }),
        Provider::GithubDeployments => Some(match cli {
            Some(cli) => github_deployments::page(cli, target, cursor, identity).await,
            None => Err(crate::cli::CliError::Unavailable),
        }),
        _ => None,
    };
    if let Some(result) = api_result {
        return result.map_err(|error| error.user_message(target.provider.as_str()));
    }
    let cli = cli.ok_or_else(|| {
        format!(
            "{} CLI is not installed. Connect its local CLI session first.",
            target.provider.as_str()
        )
    })?;
    match target.provider {
        Provider::Railway
        | Provider::Netlify
        | Provider::Render
        | Provider::CloudflarePages
        | Provider::CloudflareWorkers => hosting::page(cli, target, cursor, identity).await,
        Provider::Heroku
        | Provider::Fly
        | Provider::Gitlab
        | Provider::Digitalocean
        | Provider::Gcloud
        | Provider::Azure => cloud::page(cli, target, cursor).await,
        _ => mobile::page(cli, target, cursor).await,
    }
    .map_err(|error| error.user_message(target.provider.as_str()))
}
