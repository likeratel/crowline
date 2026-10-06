import { useState } from "react";
import { Check } from "lucide-react";
import { useSettingsChanges } from "../settingsChangesContext";
import { useI18n } from "../i18n";
import { settingsCopy } from "../settingsCopy";
import { uxCopy } from "../uxCopy";
import { SettingFeedback } from "./SettingFeedback";

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
  const { locale, t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = draft !== null && draft !== name;
  const cancel = () => {
    setDraft(null);
    setSaved(false);
  };
  const save = async (retry = false) => {
    if ((!dirty && !retry) || saving || disabled) return;
    setSaving(true);
    setSaved(false);
    try {
      const success = await change({
        kind: "accountAlias",
        connectionId: accountId,
        alias: (draft ?? name).trim() || null,
      });
      if (success) {
        setDraft(null);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="account-alias-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="account-alias-field">
        {settingsCopy(locale, "alias")}
        <input
          autoFocus
          aria-label={settingsCopy(locale, "alias")}
          disabled={disabled || saving}
          value={draft ?? name}
          maxLength={80}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      </label>
      <p className="field-help">{uxCopy(locale, "aliasHelp")}</p>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={disabled || saving || !dirty}
        >
          {saving
            ? settingsCopy(locale, "saving")
            : uxCopy(locale, "saveAlias")}
        </button>
        <button
          className="button"
          type="button"
          disabled={saving || !dirty}
          onClick={cancel}
        >
          {t("common.cancel")}
        </button>
        <span className="save-result" role="status">
          {saved ? (
            <>
              <Check size={14} />
              {uxCopy(locale, "saved")}
            </>
          ) : dirty ? (
            uxCopy(locale, "unsaved")
          ) : null}
        </span>
      </div>
      <SettingFeedback
        changeKey={`accountAlias:${accountId}`}
        onRetry={() => save(true)}
      />
    </form>
  );
}
