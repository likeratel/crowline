# crowline

English · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<img src="public/crowline.png" alt="Three watchful crows sitting on a wire" width="160" />

crowline is a menu-bar and system-tray app for deployment and CI status. Check recent runs at a glance, then open the dashboard to connect accounts, search history, and configure notifications. Built with Tauri 2, React, TypeScript, and Rust; service queries run on your computer. The interface follows your system language and supports English, Korean, Japanese, and Simplified Chinese.

## See it in action

A quick tour: menu bar panel → deployment overview → service filter → connections → project notification rules.

![Crowline demo: filter runs by service, open connections, and choose notifications for your runs](docs/images/walkthrough.gif)

Captured from the app’s browser preview with fictional projects and accounts. The demo uses the Korean UI; it does not show live deployments or notification delivery.

<details>
<summary>Screenshots</summary>

**Menu-bar panel** — status, branch, and who started each run.

<img src="docs/images/menu-bar.png" alt="Compact panel showing active and completed runs with platform icons and actor names" width="420" />

**Dashboard** — active runs and recent results in one view.

![Deployment dashboard with fictional GitHub Actions and Vercel runs](docs/images/dashboard.png)

**Connections** — choose a service, account, and projects to monitor.

![Service selection and GitHub account connection settings](docs/images/connections.png)

**Notifications** — choose whose runs and which results matter for each project.

![Project notification settings with a My runs rule](docs/images/notifications.png)

</details>

## Development setup and run

Node.js 22.23.3 or later, pnpm 10, and Rust stable are required. Go 1.26.8 builds the isolated GitHub helper, but is not needed by packaged-app users. Install [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows).

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

`tools:prepare` downloads pinned GitHub CLI, Node.js, and Vercel CLI distributions and builds the isolated GitHub helper from checksum-verified upstream source. It needs internet access and several hundred MB of disk space; it verifies pinned checksums and does not install tools globally.

## Build

```sh
pnpm desktop:build
```

Packages are written to `src-tauri/target/release/bundle/`. Build macOS apps on macOS and Windows installers on Windows. The repository contains CI configuration for macOS Apple Silicon, macOS Intel, and Windows x64; that is catalog/configuration only, not evidence of remote builds or published installers.

## Connect accounts

Open **Settings → Connections**, choose a service, connect an account, and select projects to monitor. Settings apply immediately. You can edit an account’s alias beside the account selector.

GitHub and Vercel can reuse local CLI sessions or add separate accounts through browser sign-in. Packaged apps include their CLI tools. AWS uses existing profiles and a selected region; AWS CLI is needed to start SSO sign-in. Other CLI integrations require their official CLI to be installed and signed in.

Removing an additional CLI account removes its monitoring configuration but does not sign it out. Removing a Bitbucket account also deletes its app-managed credentials.

## Supported monitoring

Most services reuse their official CLI session; install the CLI, sign in, then restart crowline. Bitbucket Cloud connects directly with an API token. No deployment hooks or project instrumentation are required.

| Platform | Monitoring | Limits |
| --- | --- | --- |
| GitHub Actions | Workflow runs | Existing `gh`; recent pages plus separate active checks. |
| Vercel | Project deployments | Existing `vercel`; `BLOCKED` entries excluded. |
| AWS | CloudFormation, ECS, Amplify branch jobs | Selected profile/region; actor is unknown. |
| GitHub Deployments | Deployment records and latest status | Separate from Actions; up to 20 status-detail reads per recent page. |
| Railway, Netlify, Render | Deployment history | Official CLI and provider-specific recent-page limits. |
| Heroku, Fly.io | App releases | Fly shows release status, not machine runtime status. |
| GitLab.com | Deployments and CI pipelines | No self-managed GitLab or actor attribution. |
| Bitbucket Cloud | Repository Pipelines | Email + scoped API token; recent pages, active checks, and triggerer-based ownership. Data Center is not supported. |
| DigitalOcean, Google Cloud, Azure App Service | App deployments, Cloud Build/Run, Kudu records | Provider-specific scope, output, and paging limits. |

EAS/Expo, fastlane, Cloudflare Pages/Workers, Firebase, and Supabase are catalog guidance only, not direct monitoring integrations: their current CLI/API contracts do not provide account-wide discovery or trustworthy deployment history. Monitor CI-driven work through GitHub Actions or GitLab pipelines where applicable. See [mobile provider notes](docs/mobile-provider-notes.md). New adapters have synthetic-fixture and command-contract coverage, not live-account-login validation.

### Bitbucket Cloud

Choose **Settings → Connections → Bitbucket**, enter your Atlassian email and an [API token](https://support.atlassian.com/bitbucket-cloud/docs/create-an-api-token/) with `read:user:bitbucket`, `read:workspace:bitbucket`, `read:repository:bitbucket`, and `read:pipeline:bitbucket`, then connect and select repositories. No separate CLI is needed. The service display name becomes the default account name; use the pencil to set an alias. **Update token** renews credentials for the same account without removing monitored repositories.

Credentials are stored in the OS credential store, not settings, logs, or installer files. Removing a Bitbucket connection also removes its stored credentials. Repository selection, menu-bar visibility, and project notification rules use the same controls as other services. Pipelines with an unidentified triggerer stay **Unknown** and do not count as **My runs**. Real-account authentication and live Bitbucket calls have not been verified; tests use fictional data.

Recent Pipelines are loaded 20 at a time. Active checks query building, pending, paused, and halted states concurrently, up to 50 per state. Repository discovery stops at 1,000 repositories, 50 repository pages, or 10 workspace pages; truncation and partial failures are shown in the UI.

## Panel, notifications, and status

- **Menu-bar panel:** recent runs with platform icons, status, branch, and actor. Execution names appear when the service supplies them: GitHub workflows, Vercel deployments, Bitbucket custom pipelines, GitLab pipelines/jobs, and Cloud Build triggers. Duplicate names are shown once. Click outside or press `Esc` to dismiss.
- **Dashboard:** filter by service, account, or **My runs / All runs**; search and load older history where supported. Unknown actors appear in **All runs**. Display filters do not change notification rules.
- **Notifications:** choose **Off / My runs / All runs** per project, then **All results / Success only / Failed only / Custom**. Notifications include service, result, execution name/title, project, branch, and actor. Long text may be shortened by the OS banner. Initial results after startup do not trigger historical alerts.
- **Menu bar settings:** choose visible services/projects and 1–10 rows per section. Runs stay in newest-first order. On macOS, Command-drag the crow icon to change its position among other menu-bar apps.
- **General:** language, launch at login, update preferences, and app version.

Active runs older than 24 hours and Vercel `BLOCKED` entries are hidden. Completed history supports 24-hour and 7-day views. crowline is read-only: it cannot deploy, rerun, cancel, or change infrastructure.

## Updates, data, and limits

Queries run roughly every 30 seconds while jobs are active and every 120 seconds while idle, with backoff after errors. Timeouts, partial results, and provider paging limits appear in the UI. Delayed results can miss notifications; use the service’s own history for a complete record.

Settings live under the OS application-data directory at `io.crowline.desktop/settings.json`. GitHub/Vercel use their CLI credentials, AWS uses profiles, and Bitbucket credentials stay in the OS credential store. Account data is not bundled in installers.

Automatic updates are not configured in the current build. The repository is private, and its release endpoint is not a public update source. See [release engineering](docs/releases.md) before enabling distribution or updates.

Locally verified: macOS Apple Silicon build/startup, GitHub/Vercel panel data, and automated tests with fictional data. Windows runtime, live AWS/Bitbucket access, additional-account browser sign-in, and the latest OS notification banner remain unverified. Dependency findings are recorded in the dated [security review](docs/security-review.md).

See the [documentation index](docs/README.md) for release, provider, media, and historical review notes.

## Development checks

```sh
pnpm check
pnpm test
pnpm test:tools
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

These are current repository commands; this README does not claim fixed test counts or a current passing run.

## License

crowline is available under the [MIT License](LICENSE). Helper-tool versions and licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); packaged notices are under `tools/`. Crow icon provenance is in [brand notes](docs/brand.md).
