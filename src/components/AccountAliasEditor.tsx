import { useEffect, useRef, useState } from "react";
import { useSettingsChanges } from "../settingsChangesContext";
import { useI18n } from "../i18n";
import { settingsCopy } from "../settingsCopy";
import { SettingFeedback } from "./SettingFeedback";

const ALIAS_DELAY_MS = 500;
export function AccountAliasEditor({
  accountId,
  name,
  disabled,
}: {
  accountId: string;
  name: string;
  disabled: boolean;
}) {
  const { change } = useSettingsChanges();
  const { locale } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const flush = () => {
    clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    const id = sequence.current;
    void change({
      kind: "accountAlias",
      connectionId: accountId,
      alias: text.trim() || null,
    }).then((success) => {
      if (success && mounted.current && sequence.current === id) setDraft(null);
    });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flushRef.current();
    };
  }, []);
  return (
    <div className="account-alias-editor">
      <label className="account-alias-field">
        {settingsCopy(locale, "alias")}
        <input
          autoFocus
          aria-label={settingsCopy(locale, "alias")}
          disabled={disabled}
          value={draft ?? name}
          maxLength={80}
          onChange={(event) => {
            const value = event.currentTarget.value;
            sequence.current += 1;
            setDraft(value);
            pending.current = value;
            clearTimeout(timer.current);
            timer.current = setTimeout(flush, ALIAS_DELAY_MS);
          }}
          onBlur={flush}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              flush();
            }
          }}
        />
      </label>
      <SettingFeedback changeKey={`accountAlias:${accountId}`} />
    </div>
  );
}
