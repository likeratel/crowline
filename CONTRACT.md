# 내부 IPC 계약

JSON 필드와 enum은 camelCase/아래 문자열을 사용한다. frontend 모델은 Zod로 확인한다.

Provider = github | vercel | aws
ActivityStatus = queued | running | waiting | success | failed | canceled | skipped | unknown
Ownership = mine | other | unknown

Target { id, provider, name, description?: string|null, metadata: Record<string,string> }
Settings { scope: mine|all, historyHours: 24|168, targets: Target[] }
Connection { provider, status: connected|signed-out|missing-cli|error|unconfigured, account?: string|null, message?: string|null, cliVersion?: string|null }
Activity { id, provider, kind, title, project, branch?: string|null, url, status, rawStatus, actor?: string|null, ownership, startedAt, finishedAt?: string|null, updatedAt }
Issue { provider, message, targetId?: string|null }
Snapshot { settings, connections: Connection[], activities: Activity[], issues: Issue[], refreshing: boolean, lastUpdatedAt?: string|null }
Discovery { connection: Connection, targets: Target[], awsProfiles: string[], issues: Issue[] }
LoginStatus { provider, state: waiting|complete|error, message, url?: string|null, code?: string|null }

Commands:
- get_snapshot() -> Snapshot
- save_settings({settings}) -> Settings
- refresh() -> Snapshot
- discover({provider, profile: string|null, region: string|null}) -> Discovery
- begin_login({provider, profile: string|null}) -> LoginStatus
- get_login_status({provider}) -> LoginStatus
- open_external({url}) -> void (https provider hosts allowlist)

Events: snapshot-updated carries Snapshot. Backend polls even with window hidden. Keep IPC commands fixed and validate every setting/target.
Dates: RFC3339 UTC strings. Unknown ownership stays unknown; mine filter must not include it.
AWS adapter contract: providers::aws::{discover(profile: Option<String>, region: Option<String>) -> Result<Discovery,String>, collect(targets: &[Target], history_hours: u32) -> (Vec<Activity>,Vec<Issue>)} async. Backend may adapt signatures with explicit coordination.

Bundled tools at Tauri resource directory `tools/`: `gh` (or gh.exe), `node` (or node.exe), `vercel/node_modules/vercel/dist/index.js`. Prefer supported system CLI when found; fallback to bundled tools. No global installation or credential copying.
