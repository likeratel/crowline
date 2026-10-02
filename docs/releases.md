# Desktop release engineering

## Current distribution

The repository is private. Local builds and direct file handoff work without a GitHub release. No App Store distribution or production update service is configured. The current app has no updater public key, so automatic updates are unavailable.

The workflow below is retained for future release engineering. Do not publish a release as part of a private test handoff. The configured GitHub Releases endpoint does not provide anonymous access to this private repository, and crowline does not attach repository credentials to updater requests. Enabling a signing key alone will not make this endpoint usable by testers. A future distribution channel needs a reachable update source or its own update mechanism.

For local app and installer builds, use the [README build commands](../README.md#build). Apple/Windows signing and notarization are separate from Tauri updater signing.

## Local Developer ID distribution

Direct macOS distribution uses a **Developer ID Application** certificate and Apple notarization, independently of App Store or Tauri updater signing. Install the certificate and its private key in the local keychain; keep both out of Git. Confirm availability with `security find-identity -v -p codesigning`.

Store notarization credentials interactively in the keychain:

```sh
xcrun notarytool store-credentials crowline --team-id YOUR_TEAM_ID
```

Use an Apple account app-specific password when prompted. Do not put passwords in commands, source files, build logs, or chat.

A distribution build must sign every bundled Mach-O file as well as the outer app, with secure timestamps and hardened runtime. This includes GitHub helpers, Node.js, and the Vercel CLI's native modules under `tools/`. Node needs the `com.apple.security.cs.allow-jit` entitlement; do not retain development entitlements such as `com.apple.security.get-task-allow`. Sign nested code first and the app last, then verify with `codesign --verify --deep --strict` and smoke-test the signed helpers.

Submit the final signed DMG with `xcrun notarytool submit PATH_TO_DMG --keychain-profile crowline`. Only an **Accepted** result is a completed notarization. Staple and validate its ticket with `xcrun stapler staple PATH_TO_DMG` and `xcrun stapler validate PATH_TO_DMG`, then mount the image and check the contained app with `spctl --assess --type execute --verbose=2 PATH_TO_APP`. Generate the final checksum after stapling. Keep test installers under ignored `artifacts/`; a local handoff does not publish a GitHub release.

Local verification on 2026-10-02: the Apple Silicon test DMG received Apple notarization status **Accepted**. Staple validation succeeded, and both the DMG and its contained app passed Gatekeeper assessment as **Notarized Developer ID**. This does not enable automatic updates or validate Windows distribution.

## Updater design

crowline's updater accepts releases only from
`https://github.com/likeratel/crowline/releases/latest/download/latest.json` and verifies every
download with the public key compiled into the application. A build without that public key keeps
the updater disabled and reports `updaterConfigured: false`.

`pnpm desktop:build` uses `createUpdaterArtifacts: false` and does not require an updater private
signing key. The release workflow explicitly passes `--config src-tauri/tauri.release.conf.json`
through the build wrapper to enable signed updater artifacts. The same argument is visible to
Tauri action's configuration merger, including its Windows signature/artifact detection.

## One-time signing setup

Generate a Tauri updater signing key outside GitHub and keep the private key out of the repository.
Configure these repository settings:

- Actions secret `TAURI_SIGNING_PRIVATE_KEY`: the full private signing key.
- Actions secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, or an empty secret for an
  unencrypted key.
- Actions variable `CROWLINE_UPDATER_PUBLIC_KEY`: the full public key generated with the private
  key. This same value is compiled into every release build.

The workflow never generates, prints, or publishes the private key. Rotating the updater key needs
a staged application release signed by the old trust chain before builds switch to the new public
key; replacing the variable immediately prevents installed builds from accepting later releases.

Platform distribution signing is separate from the Tauri updater signature. Before publishing to
other users, add the platform-specific Apple and Windows signing credentials required for trusted
installers and macOS notarization.

## Create a release

1. Set the same release version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`, then commit that version change.
2. Run **Build signed desktop release** manually from GitHub Actions on the intended commit.
3. Wait for all three jobs. The Tauri action adds signed macOS Intel, macOS Apple Silicon, and
   Windows x64 updater artifacts plus `latest.json` to one draft GitHub release.
   Jobs run sequentially to avoid concurrent `latest.json` replacement. Before building, the
   build wrapper requires the signing secret and validates the public key. After building and
   before the action uploads assets, the standalone Rust verifier checks every `.sig` against its
   corresponding artifact using the same `CROWLINE_UPDATER_PUBLIC_KEY` environment value embedded
   in the application. Missing, malformed, mismatched keys, missing artifacts, and zero signatures
   fail the job. A failed later platform can leave a partial draft; never publish that draft.
4. Inspect the draft assets and `latest.json`. Each supported platform entry must contain an HTTPS
   download URL and a nonempty inline signature.
5. Publish the draft only after the installers and update metadata have been reviewed.

Local builds can exercise the configured status and update check by setting
`CROWLINE_UPDATER_PUBLIC_KEY` in the build environment. Do not place private keys in local config,
shell scripts, logs, or repository files. `install_update` downloads and installs only the update
previously returned by `check_update`; on Windows the installer exits the running application as
part of installation.

The install IPC requires `{ "expectedVersion": "<version shown to the user>" }`. The backend
compares that value with the pending update under the update mutex and rejects stale approvals.
After successful installation, all further checks return no available update and installs are
rejected until the process restarts. Failed downloads or installations retain the pending update
for a deliberate retry.

Verifier checks (no OS installation or signing keys required):

```sh
cargo test --locked --manifest-path scripts/verify-updater/Cargo.toml
cargo fmt --manifest-path scripts/verify-updater/Cargo.toml -- --check
```

The verifier consumes the Tauri CLI's base64-encoded public-key and signature file formats and
never prints key or signature contents. It validates updater signatures, not Apple/Windows code
signing or notarization. Remote release execution and actual update installation remain untested.

At startup, configured builds check once when `preferences.checkUpdatesAutomatically` is enabled
and emit `update-status` or `update-error`. A following `check_update` call without arguments may
consume that automatic result once to avoid a duplicate request. A user-initiated manual check must
invoke `check_update` with `{ "fresh": true }`.
