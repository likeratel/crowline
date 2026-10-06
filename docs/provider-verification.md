# Provider CLI contract verification

This record covers the nine provider CLIs that were not installed in the development environment on 2026-10-02. It separates contract evidence from authenticated live evidence so that a parser test is never presented as proof that a real account works.

## Evidence levels

- **Contract verified** means the command and response fields were checked against official documentation or the provider's official CLI source, then exercised end to end with a synthetic executable through `CliInvocation`. The test checks expected command text, discovery parsing, and activity parsing. Shell fixtures compare joined argument text; they do not independently prove every argv token boundary.
- **Live verified** means an installed CLI made a read-only authenticated request against a real account without recording its output. None of the providers in this record met this level because their executables were absent.
- **Guidance only** describes operational setup or behavior inferred from official material but not exercised against an authenticated account. Contract verification does not prove local login state, IAM permissions, API enablement, tenant policy, or a provider-side compatibility change.

## Results

| Provider | Contract-verified commands | Primary evidence | Live status |
| --- | --- | --- | --- |
| Railway | `whoami --json`; `project list --json`; scoped `service list`; scoped `deployment list` | [Official CLI source at the reviewed revision](https://github.com/railwayapp/cli/tree/1bc05636f79e9d094edcce48e413254c0a1a6c1d) | `railway` absent; not live verified |
| Netlify | `api getCurrentUser`; `api listSites`; `api listSiteDeploys` with JSON `--data` | [Official CLI source at the reviewed revision](https://github.com/netlify/cli/tree/f845e14c8d1b6572b1acf2f2a0537e555a0ac088) | `netlify` absent; not live verified |
| Render | `whoami`; `workspace current`; `workspaces`; `services`; `deploys list`, all in noninteractive JSON mode | [CLI reference](https://render.com/docs/cli-reference), [service output model at v2.28.0](https://github.com/render-oss/cli/blob/46933aed813814f1c4d91ad54c0666339bc3e516/pkg/service/model.go), [deploy-list command at v2.28.0](https://github.com/render-oss/cli/blob/46933aed813814f1c4d91ad54c0666339bc3e516/cmd/deploylist.go) | `render` absent; not live verified |
| Heroku | `auth:whoami`; `apps --json`; scoped `releases --json --num 20` | [Official CLI v11.11.0 source](https://github.com/heroku/cli/tree/v11.11.0) | `heroku` absent; not live verified |
| Fly.io | `auth whoami`; `apps list --json`; scoped `releases --json` | [JSON app listing at flyctl v0.4.111](https://github.com/superfly/flyctl/blob/95b7f3e777a4c685599b6b75cfcfc0d8cbbd9fd9/internal/command/apps/list.go), [serialized App model at the reviewed revision](https://github.com/superfly/fly-go/blob/f8b275c05f23a0c68808cbc4085ef8b63299ce3f/types.go) | `flyctl` and `fly` absent; not live verified |
| GitLab | `glab api` for the current user, membership projects, project deployments, and project pipelines | [Official CLI source at the reviewed revision](https://gitlab.com/gitlab-org/cli/-/tree/59ae78caddfe91cef7808d7fb7c41d04d5b80c77), [Deployments API](https://docs.gitlab.com/api/deployments/), [Pipelines API](https://docs.gitlab.com/api/pipelines/) | `glab` absent; not live verified |
| DigitalOcean | `account get`; `apps list`; scoped `apps list-deployments`, all as JSON | [Official doctl source at the reviewed revision](https://github.com/digitalocean/doctl/tree/9248d3997e39df17229c29bebed8f6c129f671fa) | `doctl` absent; not live verified |
| Google Cloud | active auth and project listing; Cloud Run service and revision listing; global Cloud Build listing | [Cloud Run services reference](https://cloud.google.com/sdk/gcloud/reference/run/services/list), [Cloud Run revisions reference](https://cloud.google.com/sdk/gcloud/reference/run/revisions/list), [Cloud Build Build resource](https://cloud.google.com/build/docs/api/reference/rest/v1/projects.builds) | `gcloud` absent; not live verified |
| Azure | `account show`; `account list`; subscription-scoped `webapp list`; App Service deployment log listing | [Account command reference](https://learn.microsoft.com/cli/azure/account), [Web App command reference](https://learn.microsoft.com/cli/azure/webapp), [App Service deployment log reference](https://learn.microsoft.com/cli/azure/webapp/log/deployment) | `az` absent; not live verified |

The synthetic suite covers all **9 of 9** providers, **34 functional command contracts**, and each provider's `--version` probe, for **43 expected CLI invocations** in total. It exercises **11 activity surfaces**: one each for Railway, Netlify, Render, Heroku, Fly.io, DigitalOcean, and Azure; deployments and pipelines for GitLab; and Cloud Run revisions and Cloud Build builds for Google Cloud. All fixtures use invented organizations, users, projects, and identifiers.

## Contract findings

Render CLI v2.28.0 serializes service rows as `{ "service": { ... }, "project": ..., "environment": ... }`. Its `deploys list --output json` path unwraps the API cursor envelope and serializes a flat array of deploy objects. The existing provider parser matches both current shapes. An official Render tutorial shows a `.deploy` wrapper for a deploy-list recipe, but that example conflicts with the tagged CLI implementation; changing the parser to that tutorial shape would break the current CLI contract.

Fly.io `apps list --json` serializes `Organization` as a Go object containing fields such as `Name` and `Slug`. The prior parser expected a string and rejected the entire application list. The parser now accepts the current object, prefers its slug for the target description, and retains compatibility with the older string form.

Google Cloud discovery has deliberate bounds. It inspects at most 25 active projects and 200 Cloud Run services per project. Cloud Build uses the explicit `global` region. Cloud Run listing does not pass `--region` and therefore relies on gcloud's configured/default region behavior; this contract test proves the response mapping for returned services, not exhaustive discovery across every region. Missing APIs or IAM permissions are surfaced as provider issues rather than empty success.

## Live verification boundary

The executable inventory was: `railway`, `netlify`, `render`, `heroku`, `flyctl`, `fly`, `glab`, `doctl`, `gcloud`, and `az` all absent. Therefore authenticated connection, tenant selection, IAM behavior, and real provider payloads remain unverified. No CLI was installed, no login or configuration was changed, and no account payload was printed or saved during this verification.
