# crowline

English · [한국어](README.ko.md)

<img src="public/crowline.png" alt="Three watchful crows sitting on a wire" width="160" />

A local-first deployment monitor for GitHub Actions, Vercel, and AWS. Click the crow in the menu bar or system tray for a compact black summary panel; open the larger dashboard only for search and longer history.

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
5. For AWS, add one account slot for each existing local profile. Choose a region and discover CloudFormation stacks and ECS services. Looking up AWS before selecting a profile only lists local profile names and makes no AWS service request. Use **SSO 로그인** when that profile's SSO session has expired.

Use the service and **계정 필터** (account filter) in the panel or dashboard to narrow the visible rows without disconnecting other slots. Removing an added slot removes its selected monitoring targets and in-memory activity data. It does not sign out of the service or delete retained app-managed CLI configuration directories or OS credential-store entries. The default local GitHub and Vercel slots cannot be removed.

GitHub CLI, Node.js, and Vercel CLI are bundled for packaged builds. A supported installed GitHub CLI is preferred for the default local slot, and a supported installed Vercel CLI is preferred for Vercel slots; bundled tools are the fallback. Added GitHub slots always use the patched bundled helper. First-time service sign-in and target selection are still required. AWS reads use the AWS SDK; AWS CLI is required only when starting AWS SSO login from the app.

## Everyday use

- **Click the crow:** open or close the summary panel. Click outside it or press `Esc` to dismiss it.
- **내 실행 / 전체:** show runs attributed to the selected account or all visible runs.
- **Service and account filters:** narrow GitHub Actions, Vercel, or AWS rows to a service and connected account.
- **Click a run:** open its service detail page in the browser.
- **Refresh icon:** request an immediate update.
- **상세 보기:** open the larger dashboard with search and a 24-hour / 7-day history selector.
- **Right-click the tray → Quit:** stop the app and background polling.

The panel shows status, run name, project or branch, and elapsed or update time. Unknown states are separate from active and completed work. The app is read-only: it does not rerun workflows, deploy, cancel executions, or change infrastructure.

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

This is early-development software. Existing evidence covers synthetic browser tests, a macOS Apple Silicon app/DMG build and panel accessibility check, and earlier macOS checks of GitHub/Vercel discovery and deployment rows. The full native tray/dropdown/settings interaction sequence remains a manual acceptance check because automation interfered with panel focus. Windows runtime behavior, live AWS network access, and real browser sign-ins for additional GitHub/Vercel accounts have not been verified. Browser mode uses synthetic data and cannot validate native IPC, real credentials, or service access. Reviewing the source repository is not verification of a packaged binary for a particular platform.

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
