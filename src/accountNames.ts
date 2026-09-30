import {
  PROVIDER_NAMES,
  type Account,
  type Connection,
  type Settings,
} from "./domain";

function isGeneratedLabel(account: Account): boolean {
  const label = account.label.trim();
  const names = [
    PROVIDER_NAMES[account.provider],
    account.provider,
    ...(account.provider === "github" ? ["GitHub"] : []),
  ];
  return (
    names.some((name) =>
      [
        name,
        `${name} (local)`,
        `${name} CLI`,
        `${name} CLI session`,
        `${name} CLI 세션`,
        `${name} account`,
        `${name} 계정`,
        `${name} アカウント`,
        `${name}アカウント`,
        `${name} CLIセッション`,
        `${name} CLI会话`,
        `${name}账户`,
        `${name} 账户`,
      ].includes(label),
    ) || label === account.profile
  );
}

export function accountDefaultName(
  account: Account,
  connections: Connection[],
): string {
  const identity = connections
    .find(
      (connection) =>
        connection.connectionId === account.id &&
        connection.status === "connected",
    )
    ?.account?.trim();
  return (
    identity || account.profile?.trim() || PROVIDER_NAMES[account.provider]
  );
}

export function accountDisplayName(
  account: Account,
  settings: Settings,
  connections: Connection[],
): string {
  return (
    settings.preferences.accountAliases[account.id] ||
    (!isGeneratedLabel(account)
      ? account.label
      : accountDefaultName(account, connections))
  );
}
