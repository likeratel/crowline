import { accountDisplayName } from "../accountNames";
import { PROVIDER_NAMES, type Provider, type Snapshot } from "../domain";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  const accounts = snapshot.settings.accounts.filter(
    (account) => provider === "all" || account.provider === provider,
  );
  return (
    <select
      aria-label={t("account.filter")}
      className={className}
      value={accounts.some((account) => account.id === value) ? value : "all"}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="all">{t("account.all")}</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {PROVIDER_NAMES[account.provider]} ·{" "}
          {accountDisplayName(account, snapshot.settings, snapshot.connections)}
        </option>
      ))}
    </select>
  );
}
