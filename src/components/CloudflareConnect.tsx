import { useState, type FormEvent } from "react";
import { bridge, errorMessage } from "../bridge";
import { useI18n } from "../i18n";
import { expansionCopy } from "../providerExpansionCopy";

export function CloudflareConnect({
  busy,
  accountId: initialId = "",
  renewing = false,
  onConnect,
}: {
  busy: boolean;
  accountId?: string;
  renewing?: boolean;
  onConnect: (accountId: string, token: string) => Promise<boolean>;
}) {
  const { locale } = useI18n();
  const c = (key: Parameters<typeof expansionCopy>[1]) =>
    expansionCopy(locale, key);
  const [accountId, setAccountId] = useState(initialId);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = busy || submitting;
  const valid =
    /^[a-fA-F0-9]{32}$/.test(accountId.trim()) &&
    /^[\x21-\x7e]{16,4096}$/.test(token.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working || !valid) return;
    setSubmitting(true);
    setError(null);
    const submittedToken = token.trim();
    setToken("");
    try {
      await onConnect(accountId.trim().toLowerCase(), submittedToken);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form className="account-create" onSubmit={(event) => void submit(event)}>
      <label>
        {c("accountId")}
        <input
          required
          autoComplete="off"
          maxLength={32}
          pattern="[a-fA-F0-9]{32}"
          value={accountId}
          readOnly={renewing}
          disabled={working}
          onChange={(e) => setAccountId(e.target.value)}
        />
      </label>
      <label>
        {c("token")}
        <input
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          value={token}
          disabled={working}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p>{c("tokenHelp")}</p>
      <button
        type="button"
        className="text-button"
        onClick={() =>
          void bridge
            .open("https://dash.cloudflare.com/profile/api-tokens")
            .catch((cause: unknown) => setError(errorMessage(cause)))
        }
      >
        {c("token")}
      </button>
      {error && <p role="alert">{error}</p>}
      <button className="button primary" disabled={working || !valid}>
        {c(working ? "connecting" : renewing ? "renew" : "connect")}
      </button>
    </form>
  );
}
