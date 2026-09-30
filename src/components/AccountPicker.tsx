import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  PROVIDER_NAMES,
  type Account,
  type Provider,
  type Settings,
  type Connection,
} from "../domain";
import { getPlatformDetails } from "../platformDetails";
import { useI18n } from "../i18n";
import { accountDisplayName } from "../accountNames";
import { AccountAliasEditor } from "./AccountAliasEditor";
import { SettingFeedback } from "./SettingFeedback";
import { settingsCopy } from "../settingsCopy";

interface Props {
  provider: Provider;
  accounts: Account[];
  settings: Settings;
  connections: Connection[];
  discoveredConnection?: Connection;
  selectedId: string;
  busy: boolean;
  profiles: string[];
  onSelect: (account: Account) => void;
  onCreate: (label: string, profile: string | null) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onLoadProfiles: () => Promise<void>;
  savedTargetCount: number;
}
export function AccountPicker({
  provider,
  accounts,
  settings,
  connections,
  discoveredConnection,
  selectedId,
  busy,
  profiles,
  onSelect,
  onCreate,
  onRemove,
  onLoadProfiles,
  savedTargetCount,
}: Props) {
  const { locale, t } = useI18n();
  const details = getPlatformDetails(provider, locale);
  const supportsMultipleAccounts = details.supportsMultipleAccounts;
  const [adding, setAdding] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const identities = discoveredConnection
    ? [
        discoveredConnection,
        ...connections.filter(
          (item) => item.connectionId !== discoveredConnection.connectionId,
        ),
      ]
    : connections;
  const displayName = (account: Account) =>
    accountDisplayName(account, settings, identities);
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState("");
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  useEffect(() => {
    setPendingRemovalId(null);
    setEditingAlias(false);
  }, [selectedId]);
  const add = async () => {
    if (
      await onCreate(
        label.trim() ||
          profile.trim() ||
          t("accountPicker.defaultAccount", {
            provider: PROVIDER_NAMES[provider],
          }),
        provider === "aws" ? profile.trim() : null,
      )
    ) {
      setAdding(false);
      setLabel("");
      setProfile("");
    }
  };
  const addLocalSession = async () => {
    if (
      await onCreate(
        t("accountPicker.cliSession", { provider: PROVIDER_NAMES[provider] }),
        null,
      )
    ) {
      setAdding(false);
    }
  };
  const selectedAccount = accounts.find((account) => account.id === selectedId);
  const remove = async () => {
    if (await onRemove()) setPendingRemovalId(null);
  };

  if (details.unsupportedMessage) {
    return (
      <div className="account-picker unsupported-connection" role="status">
        <strong>{t("accountPicker.unavailable")}</strong>
        <p>{details.unsupportedMessage}</p>
      </div>
    );
  }

  return (
    <div className="account-picker">
      {accounts.length > 0 && (
        <div className="account-picker-row">
          <label>
            {t("accountPicker.choose")}
            <select
              aria-label={t("accountPicker.choose")}
              value={selectedId}
              disabled={busy}
              onChange={(event) => {
                const account = accounts.find(
                  (item) => item.id === event.target.value,
                );
                if (account) {
                  setPendingRemovalId(null);
                  onSelect(account);
                }
              }}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {displayName(account)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label={settingsCopy(locale, "editAlias")}
            aria-expanded={editingAlias}
            disabled={busy}
            onClick={() => setEditingAlias((value) => !value)}
          >
            <Pencil size={14} />
          </button>
          {supportsMultipleAccounts && (
            <button
              className="icon-button"
              aria-label={t("accountPicker.add")}
              disabled={busy}
              onClick={() => setAdding(!adding)}
            >
              <Plus size={16} />
            </button>
          )}
          {selectedId !== "github:local" && selectedId !== "vercel:local" && (
            <button
              className="icon-button"
              aria-label={t("accountPicker.removeAria")}
              disabled={busy}
              onClick={() => setPendingRemovalId(selectedId)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      {selectedAccount && editingAlias && (
        <AccountAliasEditor
          key={selectedId}
          accountId={selectedId}
          name={displayName(selectedAccount)}
          disabled={busy}
        />
      )}
      {selectedAccount && !editingAlias && (
        <SettingFeedback changeKey={`accountAlias:${selectedId}`} />
      )}
      {pendingRemovalId === selectedId && selectedAccount && (
        <section
          className="account-removal-confirmation"
          aria-labelledby="account-removal-title"
          aria-live="polite"
        >
          <strong id="account-removal-title">
            {t("accountPicker.removeTitle", {
              label: displayName(selectedAccount),
            })}
          </strong>
          <p>{t("accountPicker.removeBody", { count: savedTargetCount })}</p>
          <div>
            <button
              className="button"
              disabled={busy}
              onClick={() => setPendingRemovalId(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t("accountPicker.remove")}
            </button>
          </div>
        </section>
      )}
      {!supportsMultipleAccounts && accounts.length === 0 && (
        <div className="account-create local-session-create">
          <strong>{t("accountPicker.localSession")}</strong>
          <button
            className="button"
            disabled={busy}
            onClick={() => void addLocalSession()}
          >
            {t("accountPicker.connectCli")}
          </button>
        </div>
      )}
      {supportsMultipleAccounts && (adding || accounts.length === 0) && (
        <div className="account-create">
          <strong>
            {provider === "aws"
              ? t("accountPicker.awsProfile")
              : t("accountPicker.separateAccount")}
          </strong>
          <label>
            {t("accountPicker.name")}
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("accountPicker.namePlaceholder")}
              maxLength={80}
            />
          </label>
          {provider === "aws" && (
            <>
              <label>
                {t("accountPicker.profile")}
                <input
                  list="new-aws-profiles"
                  value={profile}
                  onChange={(event) => setProfile(event.target.value)}
                  placeholder="development"
                  maxLength={128}
                />
              </label>
              <datalist id="new-aws-profiles">
                {profiles.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void onLoadProfiles()}
              >
                {t("accountPicker.loadProfiles")}
              </button>
            </>
          )}
          <button
            className="button"
            disabled={busy || (provider === "aws" && !profile.trim())}
            onClick={() => void add()}
          >
            {provider === "aws"
              ? t("accountPicker.addProfile")
              : t("accountPicker.addAccount")}
          </button>
        </div>
      )}
    </div>
  );
}
