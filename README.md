# crowline

English · [한국어](README.ko.md)

<img src="public/crowline.png" alt="Three watchful crows sitting on a wire" width="160" />

A local-first deployment monitor for GitHub Actions, Vercel, AWS, and other existing CLI accounts. Click the crow in the menu bar or system tray for a compact black summary panel; open the separate dashboard for account connections, monitoring targets, panel preferences, search, and longer history.

crowline is built with Tauri 2, React, TypeScript, and Rust. It has no shared account or application server: each person monitors services with credentials already available on their own computer. The app interface is Korean; these instructions are available in English and Korean.

## Run from a clone

Prerequisites:

- Node.js 22.23.3 or later and pnpm 10.
- Rust stable and Go 1.26.8 (Go builds the isolated GitHub helper; packaged-app users do not need Go).
- [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows.

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

The first `tools:prepare` download gets pinned GitHub CLI, Node.js, and Vercel CLI distributions and builds the isolated GitHub helper from checksum-verified upstream source. It needs internet access and several hundred MB of disk space. The script verifies the pinned checksums and does not install anything globally.

For a packaged application:

```sh
pnpm desktop:build
```

Packages are written to `src-tauri/target/release/bundle/`. Build macOS applications on macOS and Windows installers on Windows. The repository includes a macOS Apple Silicon, macOS Intel, and Windows x64 CI workflow, but that workflow has not yet run remotely.

## Connect services and accounts

1. Click the crow, then open **연결 및 설정** (connections and settings).
2. GitHub and Vercel begin with their existing local CLI slots. Select one and use **연결 및 대상 확인** to inspect its login and discover selectable targets.
3. To monitor another GitHub or Vercel account, use the add-account button, give it a label, then select it and use **브라우저로 로그인**. The added slot uses an app-managed CLI configuration directory. Added GitHub slots require the bundled `gh-isolated` helper, which namespaces OS credential-store entries by account; it never falls back to an unpatched system CLI. Vercel uses its private global-config directory.
4. Select repositories or projects for each slot, then use **설정 저장**. Accounts can be monitored at the same time.
5. For AWS, add one account slot for each existing local profile. Choose a region and discover CloudFormation stacks, ECS services, and Amplify app branches. Looking up AWS before selecting a profile only lists local profile names and makes no AWS service request. Use **SSO 로그인** when that profile's SSO session has expired.

Use the service and **계정 필터** (account filter) in the dashboard to narrow the visible rows without disconnecting other slots. Removing an added slot removes its selected monitoring targets and in-memory activity data. It does not sign out of the service or delete retained app-managed CLI configuration directories or OS credential-store entries. The default local GitHub and Vercel slots cannot be removed.

GitHub CLI, Node.js, and Vercel CLI are bundled for packaged builds. A supported installed GitHub CLI is preferred for the default local slot, and a supported installed Vercel CLI is preferred for Vercel slots; bundled tools are the fallback. Added GitHub slots always use the patched bundled helper. First-time service sign-in and target selection are still required. AWS reads use the AWS SDK; AWS CLI is required only when starting AWS SSO login from the app.

## Additional platforms

Search the platform catalog in **연결 및 설정**. New platforms reuse one existing local CLI account each; install and sign in to that provider's official CLI first, then restart crowline to detect newly installed tools. No API token form, deployment hook, or project instrumentation is needed for the supported automatic-discovery adapters.

| Platform | Implemented monitoring | Local authentication and limits |
| --- | --- | --- |
| GitHub Deployments | Repository deployment records and their latest status | Existing `gh` login; separate from Actions. Up to 20 status-detail reads per recent page. |
| Railway | Project/environment/service deployments | `railway`; latest 20, no CLI continuation cursor. |
| Netlify | Site deployments | `netlify`; 20 per page, load more supported. Identity uses the authenticated user ID. |
| Render | Service deployments | `render`; current workspace only, latest 20. |
| Heroku | App releases | `heroku`; bounded recent releases, no continuation in this adapter. |
| Fly.io | App releases | `fly` / `flyctl`; release status, not machine runtime status. |
| GitLab.com | Project deployments and CI pipelines, including pipelines running fastlane | `glab`; 20 per page. Self-managed hosts are not supported. Actor attribution remains unknown. |
| DigitalOcean App Platform | App deployments | `doctl`; CLI may fetch all history, app keeps latest 20. Timeout/output-size limits apply; no continuation. |
| Google Cloud | Cloud Build builds and Cloud Run revisions | `gcloud`; current accessible projects, region-scoped targets, bounded recent results. Regional Cloud Build histories outside the configured/global scope are not automatically aggregated. |
| Azure App Service | Kudu deployment records | `az`; subscription-scoped targets. CLI has no paging flag; app keeps latest 20. Sovereign clouds are unsupported. |
| AWS Amplify | Branch jobs | Existing AWS profile and region; 20 per page, load more supported. |

The catalog also explains **EAS/Expo, fastlane, Cloudflare Pages/Workers, Firebase, and Supabase** limitations. These are not presented as working direct integrations: EAS requires explicit project context and has no account-wide CLI project discovery; fastlane is a local/CI runner; the remaining CLI contracts do not expose sufficient discovery or trustworthy deployment history. CI-triggered work can be monitored through GitHub Actions or GitLab pipelines. See [mobile provider research](docs/mobile-provider-notes.md).

New providers are validated with synthetic fixtures and command-contract tests, not real account logins. Provider APIs and CLI output can change. Unknown actors appear under **전체 실행**, not **내 실행만**.

## Dashboard and connections

There is no workspace layer: crowline monitors this device’s connected accounts and selected targets. Connections follow **choose service → verify account → select targets and save**, with service-specific prerequisites and limitations. Discovering targets alone does not add them to monitoring.

Dashboard controls share sizing and spacing rules. Connection dialogs scroll their body while keeping close/save actions visible. [DESIGN.md](DESIGN.md) records the UI contract.

Polling processes up to three accounts and two targets per account concurrently, with at most four concurrent CLI processes per account. Recent pages publish as they arrive. Queued recent requests get priority; once they have started, free slots process active scans without waiting for every recent response. History is fetched on demand. This reduces cross-target waiting; provider API and CLI latency still apply.

## Everyday use

- **Click the crow:** open or close the summary panel. Click outside it or press `Esc` to dismiss it.
- **Dashboard → 내 실행만 / 전체 실행:** show runs attributed to the selected account or all visible runs.
- **Dashboard service and account filters:** narrow GitHub Actions, Vercel, or AWS rows to a service and connected account.
- Each summary row uses its platform logo with a small status badge. Logos are bundled locally and work offline.
- **Click a run:** open its service detail page in the browser.
- **Refresh icon:** request an immediate update. Results appear per target as they arrive; settings remain usable during background polling.
- **이전 배포 더 보기:** choose a target to fetch its next history page when the provider supplies a cursor. A new refresh returns to recent results and invalidates older cursors.
- **대시보드 열기:** open the separate dashboard with search and a 24-hour / 7-day completed history selector. Account sign-in and monitoring targets are managed under **연결 및 설정** in this dashboard.
- **Dashboard → 상태바 표시 설정:** choose services and account-specific projects, show/hide active and completed sections, and set 1–10 rows per section (default 5). Save to apply to the open panel and persist across app restarts. These preferences do not remove dashboard monitoring targets. The menu-bar active count follows the panel's selected targets and active-section setting.
- **Right-click the tray → Quit:** stop the app and background polling.

The panel shows status, run name, project or branch, and elapsed or update time. Vercel `BLOCKED` entries are excluded from both lists and active counts, including cached entries. Queued, running, and waiting entries are hidden after 24 hours from their start time, even with 7-day history selected; this does not mark them as failed. Completed history still uses completion/update time and the selected 24-hour / 7-day window. Unknown states and retrieval errors remain separate and visible. The app is read-only: it does not rerun workflows, deploy, cancel executions, or change infrastructure.

Recent polling starts with one 20-item list page for GitHub and Vercel, then separately checks active statuses without a creation-date cutoff. Active scans have explicit caps and partial-result warnings. Other providers expose recent deployment/release windows; they do not guarantee every active run outside that window. CLI versions are cached, AWS clients are reused by profile/region, and account/target concurrency is bounded. This prioritizes first-result latency rather than promising fewer total requests for every provider. [Benchmark and verification notes](docs/deploybar-benchmark-plan.md) separate synthetic measurements from live performance.

## What “my runs” means

GitHub compares the account with `triggering_actor`, falling back to `actor`. Commit authors and the person who triggered a run can differ.

Vercel uses the deployment creator identity returned by its API. Accessible teams, including personal Hobby teams, can be discovered. Missing attribution remains unknown instead of being guessed.

CloudFormation and ECS responses do not reliably identify the person who started a deployment. AWS activity is therefore marked unknown and appears under **전체** (all). That filter never extends the privileges of the selected account or profile.

## Credentials, local data, and limitations

- GitHub and Vercel CLI authentication flows manage sign-in and refresh. crowline does not copy credentials into app settings. Added slots use app-managed CLI configuration directories while existing local slots continue to use the existing CLI configuration. The GitHub helper changes only credential-store naming; its source pin, patch, and mock-keyring regression are in `tools-lock.json` and `scripts/isolated-github.mjs`. Tests cover local/A/B token separation across login, account switching, and logout; real additional-account logins remain unverified.
- The AWS SDK uses the profile bound to the AWS slot. crowline does not store AWS keys. Profile discovery reads configured local profile names.
- Target selections, account labels, and filters are stored in `io.crowline.desktop/settings.json` under the operating system's application-data directory. Added GitHub/Vercel CLI configuration directories are retained beneath that application-data directory. Activity cache and login status are in memory.
- Polling is approximately every 30 seconds with active runs, 120 seconds when idle, and slower after selected services report errors. The app must be running and the computer awake.
- Timeouts, rate limits, partial listings, and pagination caps are reported in the UI. The app is not a complete historical archive.
- Missing completion times are shown as update times; unknown durations are not fabricated.
- Vercel SAML reauthentication cannot open a browser during background polling. The CLI can create an internal device-authorization attempt before its timeout; start sign-in explicitly from settings.
- Automatic updates, start-at-login, code signing, and macOS notarization are not configured.
- Bundled CLI dependencies include known security advisories. Some reviewed advisory scenarios require commands or inputs crowline does not use, but full binary vulnerability clearance is incomplete, including transitive Go modules. See [security review](docs/security-review.md) for findings and limits.

This is early-development software. Panel preference coverage includes synthetic browser checks for dashboard entry, saving preferences, section visibility and row limits, Rust settings persistence, and unit tests for blocked/cached entries and the 24-hour boundary. These checks do not verify live cross-window IPC or a newly packaged app's native menu-bar behavior. Existing evidence covers synthetic browser tests, a macOS Apple Silicon app/DMG build and panel accessibility check, and earlier macOS checks of GitHub/Vercel discovery and deployment rows. The full native tray/dropdown/settings interaction sequence remains a manual acceptance check because automation interfered with panel focus. Windows runtime behavior, live AWS network access, and real browser sign-ins for additional GitHub/Vercel accounts have not been verified. Browser mode uses synthetic data and cannot validate native IPC, real credentials, or service access. Reviewing the source repository is not verification of a packaged binary for a particular platform.

The latest UX changes passed 113 Rust tests, 16 frontend unit tests, 19 browser E2E tests, and independent review. A rebuilt macOS app was restarted on 2026-09-30; the new dashboard, control sizing, connection guidance, and current GitHub/Vercel results were inspected. Outside-click event-order regression tests passed, but native automation could not conclusively verify intermittent dismissal because it can inspect/reactivate hidden windows.

## Development and checks

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

## License and bundled notices

The crowline source is available under the [MIT License](LICENSE). Pinned helper-tool versions and their included license files are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); packaged builds place the corresponding notice at `tools/THIRD_PARTY_NOTICES.md` and helper licenses under `tools/licenses/`.

The crow symbol's recorded generation prompt and derived icon provenance are in [brand notes](docs/brand.md). The repository has no signed release artifacts or public-readiness certification.
