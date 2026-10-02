# Mobile provider capability notes

Investigation baseline: 2026-09-30. These are crowline integration constraints at that date, not claims that the platforms have no APIs. Current supported integrations are listed in the [README](../README.md#supported-monitoring).

This investigation covers EAS/Expo, Firebase Hosting and App Hosting, Supabase Edge Functions, and fastlane. The implementation reuses installed local CLI sessions and performs read-only probes only. It does not extract tokens, evaluate a user's project configuration, run project scripts, or turn a current resource state into invented deployment history.

## Support result

| Provider | Safe standard-session reads | Deployment-history result |
| --- | --- | --- |
| EAS / Expo | `eas account:view` verifies the existing login. | Unavailable under crowline's automatic-discovery constraint. `eas build:list` and `eas update:list` require a project ID resolved from the current Expo project directory, while EAS CLI has no account-wide project-list command. |
| Firebase Hosting | `firebase projects:list --json --non-interactive` discovers accessible projects. Hosting site/channel commands expose sites and current channel information. | Unavailable through Firebase CLI. The Hosting REST API has paginated release history, but the CLI has no release-history list command or generic authenticated GET command. |
| Firebase App Hosting | `firebase apphosting:backends:list --project PROJECT_ID` discovers backends. | Unavailable through Firebase CLI. The App Hosting REST API has paginated rollout history, but the CLI exposes rollout creation and backend reads, not rollout-history listing. |
| Supabase Edge Functions | `supabase projects list --output json` discovers projects; `supabase functions list --project-ref REF --output json` reports each function's current record. | Unavailable. The returned function record has the current status, version, and update time, not immutable deployment attempts. Failed and superseded deployments cannot be reconstructed reliably. |
| fastlane | `fastlane --version` detects the local runner. | Unavailable by design. fastlane runs lanes locally or in CI and has no hosted account-wide deployment-history service. The CI provider that executed the lane is the reliable history source. |

EAS, Firebase, and Supabase return `ConnectionStatus::Unconfigured` after a successful read-only session probe and include the exact limitation as an `Issue`; their missing CLIs, signed-out sessions, invalid JSON, and command failures remain distinct connection failures. fastlane always returns `Unconfigured` because installing the local runner cannot create a cloud history capability. `page` never returns a silent empty success: it returns the same capability issue, rejects malformed targets, and rejects invented cursors.

The shared CLI toolchain must remove environment credential overrides for these local-session accounts before invoking them: `EXPO_TOKEN` for EAS, `FIREBASE_TOKEN` and `GOOGLE_APPLICATION_CREDENTIALS` for Firebase, and `SUPABASE_ACCESS_TOKEN` for Supabase. This keeps the account model tied to the installed CLI session and prevents an unrelated shell/CI credential from silently selecting another account. The mobile module never reads or logs these variables.

Expo is represented once as EAS because Expo's cloud Build and Update services are EAS capabilities, not a separate deployment provider.

## EAS details and future integration path

The official EAS CLI reference documents offset pagination for both commands:

- [`eas build:list`](https://docs.expo.dev/eas/cli/#eas-buildlist) accepts `--offset`, `--limit`, `--json`, and `--non-interactive`, with a maximum page size of 50.
- [`eas update:list`](https://docs.expo.dev/eas/cli/#eas-updatelist) accepts the same paging controls and needs `--all` in non-interactive mode when no branch is supplied.

The upstream implementations declare a `ProjectId` context before querying history: [`build/list.ts`](https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/commands/build/list.ts) and [`update/list.ts`](https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/commands/update/list.ts). [`ProjectIdContextField.ts`](https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/commandUtils/context/ProjectIdContextField.ts) locates a project directory and reads its private Expo config. The published command list includes `project:info`, `project:init`, `project:new`, and `project:status`, but no project-list command. `account:view` lists the actor's account memberships, not the projects in those accounts.

If Expo adds a supported account-wide project-list command, crowline can safely run the two history commands without touching a user's checkout. The required CLI helper contract is:

```rust
pub fn with_working_directory(&self, directory: PathBuf) -> Self
```

`CliInvocation::run` and `login_command` must apply that directory with `Command::current_dir`. The mobile adapter can then create a private app-managed temporary directory containing only a static `package.json` and `app.json` with a validated discovered project UUID, owner, and slug. Because that directory contains no `expo` dependency and no dynamic `app.config.js`/TypeScript file, EAS reads static metadata and cannot execute user project code. Cleanup must occur after each request. This helper is not needed or added while automatic project discovery remains impossible.

EAS Update has another schema limitation relevant to a later implementation. `update:list --json` emits formatted `currentPage` entries; its upstream formatter turns the creation date and actor into display text. A deployment monitor must not parse that relative display string as a timestamp. The newer [`project:status --json`](https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/project/projectStatus.ts) returns structured update timestamps and URLs but is capped at 25 and has no offset. A reliable paged adapter therefore needs either a future structured update-list schema or bounded `update:view GROUP_ID --json` detail reads after each list page.

## Firebase details

The [Firebase CLI reference](https://firebase.google.com/docs/cli) documents project discovery, Hosting sites/channels, App Hosting backend listing, and App Hosting rollout creation. It does not document read commands for Hosting release history or App Hosting rollout history.

The service APIs do provide the required data:

- [Firebase Hosting `sites.releases.list`](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/list) returns releases with `pageToken` pagination and read-only OAuth scopes.
- [Firebase App Hosting `rollouts.list`](https://firebase.google.com/docs/reference/apphosting/rest/v1/projects.locations.backends.rollouts/list) returns rollout state, timestamps, and `nextPageToken` pagination.

Using these APIs directly would require crowline to obtain and refresh Google credentials. The standard Firebase CLI does not offer a generic authenticated GET command, and extracting its stored refresh token would cross the approved trust boundary. Adding Google Application Default Credentials as a separate account mode could support the REST APIs later, but that is special setup and is outside this scope.

## Supabase and fastlane details

The [Supabase Management API function-list response](https://supabase.com/docs/reference/api/v1-list-all-functions) contains one current function record with `status`, `version`, `created_at`, and `updated_at`. It does not identify prior versions, failed attempts, initiators, or immutable deployment records. The official [Edge Function deployment guide](https://supabase.com/docs/guides/functions/deploy) recommends CI for deployment, so crowline should route users to its GitHub or GitLab provider for trustworthy run history.

fastlane's official [continuous integration guide](https://docs.fastlane.tools/best-practices/continuous-integration/) describes fastlane as a runner used by GitHub Actions, GitLab CI, Jenkins, and other CI systems. Its generated JUnit data is local to an individual run and does not form an account-wide cloud history that crowline can discover from a standard fastlane login. crowline therefore detects the binary only and directs users to the CI provider.

## Synthetic verification scope

The provider tests use fictional project names and IDs only. They verify the exact read-only command arguments, Firebase and Supabase response envelopes, metadata validation, explicit unavailable issues, and cursor rejection. No real CLI account output is stored as a fixture.
