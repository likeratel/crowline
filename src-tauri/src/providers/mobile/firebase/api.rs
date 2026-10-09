use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use serde::Deserialize;
use std::time::Duration;

use crate::{
    cli::CliInvocation,
    providers::http::{ApiOrigin, JsonHttpClient},
};

use super::{access_token, ensure_default_gcloud_auth, identity};

pub(super) const ACTIVE_SCAN_BUDGET: Duration = Duration::from_secs(35);

pub(super) fn active_deadline(now: tokio::time::Instant) -> tokio::time::Instant {
    now + ACTIVE_SCAN_BUDGET
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Project {
    pub(super) project_id: String,
    pub(super) name: String,
    pub(super) lifecycle_state: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SitesResponse {
    #[serde(default)]
    pub(super) sites: Vec<Site>,
    #[serde(default)]
    pub(super) next_page_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Site {
    pub(super) name: String,
    pub(super) default_url: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocationsResponse {
    #[serde(default)]
    pub(super) locations: Vec<Location>,
    #[serde(default)]
    pub(super) next_page_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Location {
    pub(super) name: String,
    pub(super) location_id: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BackendsResponse {
    #[serde(default)]
    pub(super) backends: Vec<Backend>,
    #[serde(default)]
    pub(super) next_page_token: String,
    #[serde(default)]
    pub(super) unreachable: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Backend {
    pub(super) name: String,
    #[serde(default)]
    pub(super) display_name: String,
    #[serde(default)]
    pub(super) uri: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReleasesResponse {
    #[serde(default)]
    pub(super) releases: Vec<Release>,
    #[serde(default)]
    pub(super) next_page_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Release {
    pub(super) name: String,
    pub(super) release_time: DateTime<Utc>,
    #[serde(rename = "type")]
    pub(super) release_type: String,
    #[serde(default)]
    pub(super) message: String,
    #[serde(default)]
    pub(super) release_user: Option<ActingUser>,
    #[serde(default)]
    pub(super) version: Option<Version>,
}

#[derive(Deserialize)]
pub(super) struct ActingUser {
    #[serde(default)]
    pub(super) email: String,
}

#[derive(Deserialize)]
pub(super) struct Version {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) status: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RolloutsResponse {
    #[serde(default)]
    pub(super) rollouts: Vec<Rollout>,
    #[serde(default)]
    pub(super) next_page_token: String,
    #[serde(default)]
    pub(super) unreachable: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Rollout {
    pub(super) name: String,
    #[serde(default)]
    pub(super) display_name: String,
    pub(super) state: String,
    pub(super) create_time: DateTime<Utc>,
    pub(super) update_time: DateTime<Utc>,
    #[serde(default)]
    pub(super) build: String,
}

pub(super) struct FirebaseApi {
    hosting: JsonHttpClient,
    app_hosting: JsonHttpClient,
    token: String,
    pub(super) identity: String,
}

impl FirebaseApi {
    pub(super) async fn from_cli(cli: &CliInvocation) -> Result<Self, String> {
        ensure_default_gcloud_auth(cli).await?;
        let identity = identity(cli)
            .await
            .map_err(|error| error.user_message("Google Cloud"))?;
        let token = access_token(cli, &identity)
            .await
            .map_err(|error| error.user_message("Google Cloud"))?;
        let hosting = JsonHttpClient::new(ApiOrigin::FirebaseHosting)
            .map_err(|error| error.user_message("Firebase Hosting"))?;
        let app_hosting = JsonHttpClient::new(ApiOrigin::FirebaseAppHosting)
            .map_err(|error| error.user_message("Firebase App Hosting"))?;
        Ok(Self {
            hosting,
            app_hosting,
            token,
            identity,
        })
    }

    pub(super) fn hosting_get<T: serde::de::DeserializeOwned + Send + 'static>(
        &self,
        project: &str,
        path: &[&str],
        query: &[(&str, &str)],
    ) -> BoxFuture<'static, Result<T, String>> {
        let request = self.hosting.get(path, query, &self.token, Some(project));
        Box::pin(async move {
            request
                .await
                .map_err(|error| error.user_message("Firebase Hosting"))
        })
    }

    pub(super) fn app_hosting_get<T: serde::de::DeserializeOwned + Send + 'static>(
        &self,
        project: &str,
        path: &[&str],
        query: &[(&str, &str)],
    ) -> BoxFuture<'static, Result<T, String>> {
        let request = self
            .app_hosting
            .get(path, query, &self.token, Some(project));
        Box::pin(async move {
            request
                .await
                .map_err(|error| error.user_message("Firebase App Hosting"))
        })
    }
}
