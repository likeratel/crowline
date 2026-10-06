import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { bridge, errorMessage, isPreview } from "../bridge";
import { cliCopy } from "../cliCopy";
import type { GithubProvider } from "../cliAccounts";
import { useI18n } from "../i18n";

type Props = {
  provider: GithubProvider;
  connectionId: string;
  username?: string | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onConnected: () => Promise<void>;
};

export function GithubCliConnect({
  provider,
  connectionId,
  username,
  busy,
  onBusyChange,
  onConnected,
}: Props) {
  const { locale } = useI18n();
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selected, setSelected] = useState(username ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void bridge
      .githubCliAccounts()
      .then((items) => {
        if (active) setAccounts(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    onBusyChange(saving);
    return () => onBusyChange(false);
  }, [saving, onBusyChange]);
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await bridge.githubCliAccounts());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };
  const connect = async () => {
    setSaving(true);
    setError(null);
    try {
      await bridge.connectGithubCliAccount(provider, connectionId, selected);
      await onConnected();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const value = accounts.includes(selected) ? selected : "";
  return (
    <div className="account-picker github-cli-connect">
      <div className="account-picker-row">
        <label>
          {cliCopy(locale, "account")}
          <select
            aria-label={cliCopy(locale, "account")}
            value={value}
            disabled={busy || saving || loading}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{cliCopy(locale, "choose")}</option>
            {accounts.map((account) => (
              <option key={account} value={account}>
                {account}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          title={cliCopy(locale, "refresh")}
          aria-label={cliCopy(locale, "refresh")}
          disabled={busy || saving || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
        <button
          className="button"
          disabled={busy || saving || loading || !value}
          onClick={() => void connect()}
        >
          {cliCopy(locale, "connect")}
        </button>
      </div>
      <p className="field-help">
        {cliCopy(locale, isPreview ? "preview" : "help")}
      </p>
      {!loading && !error && accounts.length === 0 && (
        <p role="status">{cliCopy(locale, "noAccounts")}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
