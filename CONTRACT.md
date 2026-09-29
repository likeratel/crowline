# 내부 IPC 계약

JSON 필드와 enum은 camelCase/아래 문자열을 사용한다. frontend 모델은 Zod로 확인한다.

Provider = github | vercel | aws
ActivityStatus = queued | running | waiting | success | failed | canceled | skipped | unknown
Ownership = mine | other | unknown

Account { id, provider, label, mode: local|isolated, profile?: string|null }
Target { id, connectionId, provider, name, description?: string|null, metadata: Record<string,string> }
Settings { scope: mine|all, historyHours: 24|168, targets: Target[], accounts: Account[] }
Connection { connectionId, provider, status: connected|signed-out|missing-cli|error|unconfigured, account?: string|null, message?: string|null, cliVersion?: string|null }
Activity { id, targetId, connectionId, provider, kind, title, project, branch?: string|null, url, status, rawStatus, actor?: string|null, ownership, startedAt, finishedAt?: string|null, updatedAt }
Issue { connectionId?: string|null, provider, message, targetId?: string|null }
Snapshot { settings, connections: Connection[], activities: Activity[], issues: Issue[], refreshing: boolean, lastUpdatedAt?: string|null }
Discovery { connection: Connection, targets: Target[], awsProfiles: string[], issues: Issue[] }
LoginStatus { connectionId, provider, state: waiting|complete|error, message, url?: string|null, code?: string|null }

Commands:
- get_snapshot() -> Snapshot
- save_settings({settings}) -> Settings
- refresh() -> Snapshot
- discover({provider, connectionId: string|null, profile: string|null, region: string|null}) -> Discovery
- create_connection({provider, label, profile: string|null}) -> Account
- remove_connection({connectionId}) -> Settings
- begin_login({provider, connectionId, profile: string|null}) -> LoginStatus
- get_login_status({provider, connectionId}) -> LoginStatus
- open_external({url}) -> void (https provider hosts allowlist)
- hide_panel() -> void
- open_dashboard() -> void

Default slots reuse `github:local` and `vercel:local` CLI sessions. Added GitHub/Vercel slots use isolated official CLI configuration directories, never switch the global CLI account. AWS slots bind to one local profile. Target identity is `(provider, connectionId, id)`. Cache and login status are account-scoped. Accounts are created/removed only through their commands; settings save must not retarget authentication definitions. Removing a connection removes its monitoring selections and in-memory data; it does not delete external or retained app-managed CLI authentication files.

`discover` without a connectionId is allowed only for local AWS profile-name discovery and performs no remote request. Its connection uses unconfigured sentinel `aws:local`. Legacy saved settings migrate provider defaults and split AWS targets by profile.

Events: snapshot-updated carries Snapshot. Backend polls even with window hidden. Keep IPC commands fixed and validate every setting/target.
Dates: RFC3339 UTC strings. Unknown ownership stays unknown; mine filter must not include it.
AWS adapter contract: providers::aws::{discover(profile: Option<String>, region: Option<String>) -> Result<Discovery,String>, collect(targets: &[Target], history_hours: u32) -> (Vec<Activity>,Vec<Issue>)} async. Backend may adapt signatures with explicit coordination.

Bundled tools at Tauri resource directory `tools/`: `gh` (or gh.exe), `gh-isolated` (or gh-isolated.exe), `node` (or node.exe), `vercel/node_modules/vercel/dist/index.js`. Prefer supported system CLI for local GitHub and Vercel slots; fallback to bundled tools. Isolated GitHub requires the patched bundled helper and private GH_CONFIG_DIR, with CROWLINE_GH_KEYRING_NAMESPACE set to the validated account ID. The helper uses `gh:io.crowline.desktop:<accountId>:<hostname>` keyring services; local GitHub removes inherited namespace overrides. Missing isolated helper fails closed. No global installation or credential copying.
