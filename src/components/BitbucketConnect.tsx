import { useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { z } from "zod";
import { bridge } from "../bridge";
import { useI18n } from "../i18n";

interface Props {
  busy: boolean;
  renewing?: boolean;
  onConnect: (email: string, token: string) => Promise<boolean>;
}

export function BitbucketConnect({ busy, renewing = false, onConnect }: Props) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const working = busy || submitting;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    if (!z.email().safeParse(email.trim()).success || !token.trim()) {
      setError(t("bitbucket.invalid"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onConnect(email.trim(), token.trim());
    } finally {
      setToken("");
      setSubmitting(false);
    }
  };
  return (
    <form
      className="account-create bitbucket-connect"
      onSubmit={(event) => void submit(event)}
    >
      <strong>
        {t(renewing ? "bitbucket.renew" : "bitbucket.newAccount")}
      </strong>
      <label>
        {t("bitbucket.email")}
        <input
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          value={email}
          disabled={working}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        {t("bitbucket.token")}
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={4096}
          value={token}
          disabled={working}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <details className="connection-help">
        <summary>{t("bitbucket.createToken")}</summary>
        <p>{t("bitbucket.help")}</p>
        <ul>
          <li>
            <code>read:user:bitbucket</code>
          </li>
          <li>
            <code>read:workspace:bitbucket</code>
          </li>
          <li>
            <code>read:repository:bitbucket</code>
          </li>
          <li>
            <code>read:pipeline:bitbucket</code>
          </li>
        </ul>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            void bridge
              .open(
                "https://id.atlassian.com/manage-profile/security/api-tokens",
              )
              .catch(() =>
                setError(
                  t("bitbucket.createToken") +
                    ": https://id.atlassian.com/manage-profile/security/api-tokens",
                ),
              );
          }}
        >
          {t("bitbucket.createToken")} <ArrowUpRight size={13} />
        </button>
      </details>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={working || !email.trim() || !token.trim()}
      >
        {working && <LoaderCircle size={14} className="spin" />}
        {t(
          working
            ? "bitbucket.connecting"
            : renewing
              ? "bitbucket.renew"
              : "bitbucket.connect",
        )}
      </button>
    </form>
  );
}
