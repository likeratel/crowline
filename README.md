# crowline

English · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<img src="public/crowline.png" alt="Three watchful crows sitting on a wire" width="160" />

crowline is a local-first desktop monitor for deployment and CI results. Open the compact summary from the menu bar or system tray; use the dashboard to connect accounts, select monitored targets, search, and inspect history. It is built with Tauri 2, React, TypeScript, and Rust. There is no shared account or application server: it queries services directly using local CLI sessions or credentials you connect. The UI defaults to the system language and supports Korean, English, Japanese, and Simplified Chinese; an unrecognized system locale falls back to English.

## See it in action

A quick tour: deployment overview → service filter → connections → project notification rules.

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

Open the single **Settings** entry in the dashboard sidebar. Its tabs are **Connections**, **Notifications**, **Menu bar**, and **General**. GitHub and Vercel start with the existing local CLI account: verify it, discover targets, and select repositories or projects to monitor. Changes apply as they are made. Additional GitHub/Vercel accounts use a labelled app-managed slot and browser sign-in. Added GitHub accounts always use the bundled `gh-isolated` helper, which namespaces OS credential-store entries by account and never falls back to an unpatched system CLI. Added Vercel accounts use a private global-config directory.

For AWS, add a slot for each existing local profile, choose a region, and discover CloudFormation stacks, ECS services, and Amplify branches. Before choosing a profile, discovery reads only local profile names and sends no AWS service request. Start AWS SSO sign-in from the app when that session expires.

Adding or removing an account and changing target selections apply immediately. Removing an added CLI account removes its selected targets and in-memory activity data, not its sign-in, retained CLI configuration, or OS credentials. Bitbucket connections are different: removing one also deletes its app-managed credentials. Default local GitHub/Vercel accounts cannot be removed. Packaged builds include GitHub CLI, Node.js, and Vercel CLI. AWS reads use the SDK; AWS CLI is needed only to start SSO sign-in.

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

- Click the crow to open/close the panel; click outside or press `Esc` to dismiss it. Filter by service, account, **My runs**, and **All runs** without disconnecting accounts. GitHub uses `triggering_actor`, then `actor`; Vercel uses deployment creator; unknown actors appear only in **All runs**.
- Refresh requests an immediate poll. Results appear target by target; older history is loaded only when a provider supplies a next cursor. Completed history can be filtered to 24 hours or 7 days and searched.
- **Settings** has four tabs: **Connections**, **Notifications**, **Menu bar**, and **General**. Every setting applies immediately. The app serializes changes and the backend merges each field atomically; a failed item rolls back and offers **Try again** without discarding unrelated changes. Select the pencil beside an account to edit its alias; it saves after 500 ms of inactivity or when the field loses focus. An alias takes precedence; otherwise the service identity is shown when available, then the saved profile or service name. Existing non-generated account names are retained.
- In **Menu bar**, choose visible services/projects, active/completed sections, and 1–10 rows. Projects are always ordered by the latest `updatedAt`, newest first; there is no project pinning or failure-first ordering. On macOS, the order of the crow icon relative to other menu-bar apps is controlled by Command-dragging it in the system menu bar; crowline does not guarantee an app priority.
- In **Notifications**, compact project rows choose **Off**, **My runs**, or **All runs**, then **Failed only**, **All results**, or **Custom** outcomes. New rules include successful, failed, and canceled outcomes; existing rules retain their choices. Custom keeps its outcome editor open, and at least one outcome remains selected. Search, service filtering, and explicit selected-project bulk application help change multiple rules. These notification rules remain independent from display filters. The first observations after startup establish a silent baseline, so historical results are not announced.
- Service status reports a signed-out account, missing CLI, connection error, partial result, or work in progress. Open Connections to sign in again; install the named CLI and reconnect; check network and account permissions for errors. Results after partial/error states may be stale.
- **Launch Crowline at login** is opt-in and changes the OS setting immediately. **Automatically check for updates** defaults to enabled. **General** shows the app version in About.

Queued, running, and waiting entries older than 24 hours are hidden without becoming failures. Vercel `BLOCKED` entries are excluded. Unknown states and retrieval errors remain distinct. crowline is read-only: it does not rerun workflows, deploy, cancel executions, change infrastructure, or execute user-provided commands.

Notification delivery depends on polling and the timestamps supplied by each service. Delayed results that first appear more than 10 minutes behind the newest event may not trigger an alert. Under heavy load, bounded notification history prioritizes avoiding duplicates, so some late results may be omitted. Check the service history for a complete deployment record.

## Updates, data, and limits

The repository contains a manually dispatched workflow intended to create signed draft desktop releases and updater metadata. It is not a live update service: this build has no updater public key or published-release configuration, so it reports in-app updates as unavailable. No public signing key, signed artifact, or public release is claimed. The default automatic-check preference cannot make updates available until that path is configured and published.

GitHub/Vercel authentication manages sign-in and refresh; crowline does not copy credentials into settings. AWS uses the selected profile and stores no AWS keys. Bitbucket email and API tokens are stored in the OS credential store. Settings are stored at `io.crowline.desktop/settings.json` under the OS application-data directory; added GitHub/Vercel configuration is retained there, while activity cache and login status are in memory. Polling is roughly every 30 seconds with active runs and 120 seconds when idle, slowing after errors; the app must be running and the computer awake.

Timeouts, rate limits, partial listings, and pagination caps appear in the UI. Background Vercel SAML reauthentication cannot open a browser. Bundled CLI dependencies have known security advisories, and full binary vulnerability clearance, including transitive Go modules, is incomplete; see [security review](docs/security-review.md).

This is early-development software. Existing evidence includes synthetic browser tests, a macOS Apple Silicon app/DMG build and panel accessibility check, and earlier macOS GitHub/Vercel discovery/deployment-row checks. Native tray/dropdown/settings interaction remains a manual acceptance check. Windows runtime behavior, live AWS access, and browser sign-in for added GitHub/Vercel accounts remain unverified.

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
