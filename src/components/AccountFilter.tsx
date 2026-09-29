import { PROVIDER_NAMES, type Provider, type Snapshot } from "../domain";

export function AccountFilter({
  snapshot,
  provider,
  value,
  onChange,
  className,
}: {
  snapshot: Snapshot;
  provider: Provider | "all";
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const accounts = snapshot.settings.accounts.filter(
    (account) => provider === "all" || account.provider === provider,
  );
  return (
    <select
      aria-label="계정 필터"
      className={className}
      value={accounts.some((account) => account.id === value) ? value : "all"}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="all">모든 계정</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {PROVIDER_NAMES[account.provider]} · {account.label}
        </option>
      ))}
    </select>
  );
}
