# Desktop release engineering

## Distribution status

The repository is private. Local builds and direct file handoff work without a GitHub release, but
there is no public production update service. The application does not attach repository
credentials to updater requests, so the private GitHub Releases URL cannot serve updates to
customers. Do not publish a workflow draft or describe it as a production update channel until a
reachable update service has been designed and implemented.

The **Build signed validation draft** workflow is an internal packaging gate. It accepts an explicit
`macos`, `windows`, or `macos-and-windows` scope and creates a private draft only after the selected
jobs build and pass platform trust checks. A green run proves the artifacts from that run passed the
checks below; it does not make the private updater endpoint usable. Publishing, distribution, and
changing repository visibility remain manual decisions outside the workflow.

Ordinary `pnpm desktop:build` remains a local developer build. It uses
`createUpdaterArtifacts: false` and needs none of the release secrets.

## Latest local QA candidate — 2026-10-04

The current Apple Silicon candidate was built from the reviewed working tree after the UI,
selection, account-safety, large-history, settings preservation, event subscription recovery and UI/UX follow-up fixes. No new source commit, release tag, or public
release was created.

- Installer: `artifacts/qa-release-2026-10-04-r3/crowline_0.1.0_aarch64.dmg` (7,934,582 bytes).
- SHA-256: `de7cf9ec694afa0b5c5780cb06f5ad06ce1ad977b0815a36a245a2bd8878867d`.
- App executable SHA-256: `5bac544f012c6240caccdfc6b5ff05656a26292f2a4dc6ebc5140df61ff84e0a`; app bundle 14,314,432 bytes.
- App notarization: **Accepted**, submission `87478045-101c-4d96-a821-c9c431342f93`.
- DMG notarization: **Accepted**, submission `82827029-e590-455d-b79b-d14af91e6e41`.
- App and DMG passed strict Developer ID signature verification, secure timestamp, staple validation,
  and Gatekeeper assessment as **Notarized Developer ID**. The app has hardened runtime.
- The DMG was mounted read-only. Its contained app passed signature, staple and Gatekeeper checks,
  matched the verified executable hash, and contained no bundled provider tools.
- The canonical generated DMG at `src-tauri/target/release/bundle/dmg/crowline_0.1.0_aarch64.dmg`
  was replaced with this same verified installer. The canonical app bundle was also stapled.
- Detailed local machine-readable evidence: `artifacts/qa-release-2026-10-04-r3/verification.json`.

The latest native app was restarted and left on the dashboard. Existing six monitored targets
remained present; the monitored GitHub, Vercel and Bitbucket accounts all reached query-complete
status. Native UI checks confirmed scoped totals (all monitored accounts 3/3 versus the selected
service's 1/1), no-results guidance, filter reset retaining the service, and focus returning to
search. These checks changed no saved settings. The earlier candidate's alias Save/Cancel, notification
switch/defaults, scope controls and unavailable-updater state were inspected without changing saved
user settings. This is not a new-account onboarding,
OS notification delivery, Windows, or public-updater acceptance test.

## Artifact identity and existing evidence

The earlier October 4 candidate in `artifacts/qa-release-2026-10-04/` has DMG SHA-256
`c749656eae784eab4999158aa839ef1c948dde0b390fae469946f8e2360732bb` and executable SHA-256
`94cff9d22888be8d499b3fdd0392b388ab5855fa0ea0aa6d9fc371dc3533e6f1`. It was notarized but predates
the settings preservation and event subscription recovery fixes. The `-r2` candidate has DMG SHA-256
`1d07444bbbb746cbb5e818501a3f6e2c3e4da341206e2ca1a5cafb405c5a6dfb` and predates the UI/UX follow-up.
Both are superseded by the `-r3` candidate above.

Version text is not an artifact identity. Several different local files report version `0.1.0`.
Use the source commit when known, the full path or release asset name, and SHA-256 together. Signing
evidence for one hash must never be used to describe another build.

The following is a local inspection snapshot captured on 2026-10-04 before the next QA candidate
was built. Files under `artifacts/` and `src-tauri/target/` are ignored local files and are not
durable repository evidence.

| Artifact                                                                             | SHA-256 or executable SHA-256                                                 | Observed result                                                                                                                                            | Meaning                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src-tauri/target/release/bundle/dmg/crowline_0.1.0_aarch64.dmg`                     | `5fad5ceaf4d1c7419cb5eb092fedf66f5055758b1b8747fda22a8d0b51f392c2`            | DMG unsigned; no stapled ticket                                                                                                                            | Pre-hardening output was not distributable; now replaced by the candidate above.                      |
| `src-tauri/target/release/bundle/macos/crowline.app`                                 | executable `c24e3315b5d6930d1e22356bd9943ff2ad4350f86da549cc0ab665db3db86020` | Ad-hoc/linker signature; `codesign --verify --deep --strict` failed with missing sealed resources; no stapled ticket                                       | Historical pre-hardening hash; now replaced.                      |
| `artifacts/crowline-notarized-2026-10-02/crowline_0.1.0_apple-silicon_notarized.dmg` | `d5868bc5a8217d55bb2ef2f609699bfe2a403fc4c5f3166ab5603e8b2479d18c`            | Developer ID signed; DMG ticket validated; Gatekeeper reported `Notarized Developer ID`; recorded source commit `255c31a8cac086264d41725b519d33908e37b235` | Valid evidence only for this exact prior DMG.                                  |
| `artifacts/macos-signing-check/dmg-root/crowline.app`                                | executable `18fb2aa6cb7bfd943612a0ce2952c75c509260da70c8ce1a52cbb4760ee98619` | Strict Developer ID signature valid; extracted app itself has no stapled ticket; executable differs from the current local app                             | A copy from the prior notarized build, not proof for current source or output. |

The prior notarized DMG and the current local app have different executable hashes even though both
report version `0.1.0`. Any new handoff needs a new artifact hash and its own verification record.

## Trust layers

Tauri updater signing, Apple Developer ID signing/notarization, and Windows Authenticode signing are
separate controls:

- Tauri updater signatures let an installed crowline build verify an update artifact. Tauri requires
  these signatures and does not allow verification to be disabled.
- Apple Developer ID signing proves the macOS publisher. Hardened runtime, notarization, stapling,
  strict code-signature verification, and Gatekeeper assessment are all required by this workflow.
- Windows Authenticode proves the Windows publisher. The release uses SHA-256 and an HTTPS RFC 3161
  timestamp service, then checks the signer thumbprint and timestamp on every generated installer.

The configuration follows the official Tauri guidance for
[updater signing](https://v2.tauri.app/plugin/updater/),
[macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/), and
[Windows signing](https://v2.tauri.app/distribute/sign/windows/).

## GitHub release configuration

Generate the Tauri updater key outside GitHub. Release jobs require an encrypted private key; an
empty updater-key password is rejected. Configure these Actions secrets:

| Secret                               | Purpose                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Full encrypted Tauri updater private key.                                                  |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater private key.                                                      |
| `APPLE_CERTIFICATE`                  | Base64 PKCS#12 export containing the Developer ID Application certificate and private key. |
| `APPLE_CERTIFICATE_PASSWORD`         | Password for the PKCS#12 export.                                                           |
| `APPLE_API_PRIVATE_KEY`              | PEM contents of the App Store Connect API `.p8` private key used for notarization.         |
| `WINDOWS_CERTIFICATE`                | Base64 PKCS#12/PFX code-signing certificate and private key.                               |
| `WINDOWS_CERTIFICATE_PASSWORD`       | Password for the Windows PFX.                                                              |

Configure these Actions variables:

| Variable                         | Required format                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CROWLINE_UPDATER_PUBLIC_KEY`    | Full public key paired with `TAURI_SIGNING_PRIVATE_KEY`; this value is compiled into release builds. |
| `APPLE_SIGNING_IDENTITY`         | Full `Developer ID Application: … (TEAMID)` identity.                                                |
| `APPLE_TEAM_ID`                  | Ten-character Apple team ID matching the signing identity.                                           |
| `APPLE_API_ISSUER`               | App Store Connect issuer UUID.                                                                       |
| `APPLE_API_KEY`                  | Ten-character App Store Connect API key ID.                                                          |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | Forty hexadecimal characters identifying the PFX leaf certificate.                                   |
| `WINDOWS_TIMESTAMP_URL`          | HTTPS RFC 3161 timestamp endpoint supplied by the certificate provider.                              |

Do not place the private keys, certificate passwords, or PFX contents in files, shell history, issue
text, or workflow output. Rotating the updater key requires a staged application release trusted by
the old key; replacing the public key immediately prevents installed builds from accepting later
updates.

## What the workflow enforces

Before reserving a platform runner, the preflight job tests the validation scripts, requires every
secret and variable for the selected scope, validates their non-secret formats, and requires the
same semantic version in `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json`. Missing or malformed configuration fails without printing values.

The platform jobs run sequentially. The workflow pins third-party actions by commit and gives
write access to repository contents only to the job that creates the draft.

For macOS, Tauri imports the PKCS#12 certificate, signs the app with the configured Developer ID
identity and hardened runtime, submits the app for notarization, and staples it. The release wrapper
then submits the signed DMG separately, waits for acceptance, and staples it. Before the Tauri action
can upload files, both the app and DMG must pass strict `codesign`, exact identity and team checks,
secure timestamp checks, `stapler validate`, and Gatekeeper assessment as
`Notarized Developer ID`.

For Windows, the job imports the PFX into the ephemeral runner store and generates a release-only
Tauri overlay with the configured thumbprint, SHA-256 digest, HTTPS timestamp URL, and RFC 3161
mode. Before upload, every `.msi` and installer `.exe` under the bundle directory must report a
valid Authenticode signature from the configured thumbprint with a timestamp.

For every selected platform, the existing standalone updater verifier first validates the public
key format, then verifies every generated `.sig` against its corresponding artifact. Missing
artifacts, orphan signatures, a mismatched key pair, or zero verified signatures fail the build.
The workflow release title and body explicitly identify the result as a validation draft.

A failed later platform can leave a partial private draft from an earlier successful job. Never
publish a partial draft. Delete it or rerun the same version only after correcting the failure.

## Local Developer ID candidate

A local keychain identity and `notarytool` profile can be used for a private QA candidate without
putting Apple credentials in environment variables. This does not repair an ad-hoc or invalid app:
sign and notarize the app first, sign the DMG, and then submit the exact DMG that will be handed off.
For an already signed DMG, the repository helper can use the existing keychain profile without
printing its credentials:

```sh
node scripts/release-notarize-macos.mjs \
  --bundle-dir src-tauri/target/release/bundle \
  --keychain-profile crowline
```

After submission succeeds, set the expected public identity and team ID and run the same artifact
checks used by CI:

```sh
APPLE_SIGNING_IDENTITY='Developer ID Application: NAME (TEAMID)' \
APPLE_TEAM_ID='TEAMID' \
node scripts/release-artifacts.mjs \
  --platform macos \
  --bundle-dir src-tauri/target/release/bundle
```

Generate the handoff checksum only after signing, notarization, and stapling, because those steps
change the artifact bytes.

## Updater boundary

crowline's current updater code requests
`https://github.com/likeratel/crowline/releases/latest/download/latest.json` and verifies downloads
with the public key compiled into the application. A normal local build has no public key, keeps the
updater disabled, and reports `updaterConfigured: false`.

The release-only overlay enables `createUpdaterArtifacts` and embeds
`CROWLINE_UPDATER_PUBLIC_KEY`. This is enough to generate and verify signed updater artifacts, but it
does not make the private GitHub URL anonymously reachable. Do not invent or document a public URL
until a real distribution service exists.

At runtime, `install_update` installs only the update previously returned by `check_update`. The
install IPC requires `{ "expectedVersion": "<version shown to the user>" }`; the backend compares
that value with the pending update and rejects stale approvals. Failed downloads or installations
retain the pending update for a deliberate retry.

## Draft procedure

1. Set the same release version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`, then commit the version change.
2. Run **Build signed validation draft** on the intended commit and select only platforms whose
   credentials are configured.
3. Require every selected job to pass. A skipped, cancelled, or failed job is not a supported
   release artifact.
4. Record each asset name, SHA-256, source commit, platform, architecture, and the successful
   workflow run. Inspect `latest.json` only as generated metadata; it is not currently a reachable
   customer update service.
5. Keep the result private until product QA, platform installation testing, and the distribution
   decision are complete.

Release-script checks that do not use signing credentials or external services:

```sh
node --test scripts/release-scripts.test.mjs
for file in scripts/release-*.mjs; do node --check "$file"; done
bash -n scripts/release-build.sh
cargo test --locked --manifest-path scripts/verify-updater/Cargo.toml
cargo fmt --manifest-path scripts/verify-updater/Cargo.toml -- --check
```

Remote workflow execution, actual Windows signing, Apple submission by the workflow, and end-user
update installation remain unverified until their corresponding runs are completed and recorded.
