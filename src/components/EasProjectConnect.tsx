import { useState, type FormEvent } from "react";
import { z } from "zod";
import { bridge, errorMessage } from "../bridge";
import { useI18n } from "../i18n";
import { expansionCopy } from "../providerExpansionCopy";
import type { Target } from "../domain";

export function EasProjectConnect({
  connectionId,
  disabled,
  onBusyChange,
  onRegistered,
}: {
  connectionId: string;
  disabled: boolean;
  onBusyChange: (value: boolean) => void;
  onRegistered: (targets: Target[]) => Promise<void>;
}) {
  const { locale } = useI18n();
  const c = (key: Parameters<typeof expansionCopy>[1]) =>
    expansionCopy(locale, key);
  const [projectId, setProjectId] = useState("");
  const [owner, setOwner] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Target[] | null>(null);
  const working = busy || disabled;
  const validSlug = (value: string) =>
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value.trim());
  const valid =
    z.uuid().safeParse(projectId.trim()).success &&
    validSlug(owner) &&
    validSlug(slug);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working || (!saved && !valid)) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setMessage(null);
    try {
      const targets =
        saved ??
        (await bridge.registerEasProject(
          connectionId,
          projectId.trim(),
          owner.trim(),
          slug.trim(),
        ));
      setSaved(targets);
      try {
        await onRegistered(targets);
      } catch {
        setError(c("reloadNeeded"));
        return;
      }
      setSaved(null);
      setMessage(c("registered"));
      setProjectId("");
      setOwner("");
      setSlug("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <form className="account-create" onSubmit={(event) => void submit(event)}>
      <p>{c("easHelp")}</p>
      <label>
        {c("projectId")}
        <input
          value={projectId}
          maxLength={36}
          required={!saved}
          disabled={working || Boolean(saved)}
          onChange={(e) => setProjectId(e.target.value)}
        />
      </label>
      <label>
        {c("owner")}
        <input
          value={owner}
          maxLength={100}
          required={!saved}
          disabled={working || Boolean(saved)}
          onChange={(e) => setOwner(e.target.value)}
        />
      </label>
      <label>
        {c("slug")}
        <input
          value={slug}
          maxLength={100}
          required={!saved}
          disabled={working || Boolean(saved)}
          onChange={(e) => setSlug(e.target.value)}
        />
      </label>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <button
        className="button primary"
        disabled={working || (!saved && !valid)}
      >
        {c(busy ? "registering" : saved ? "retry" : "register")}
      </button>
    </form>
  );
}
