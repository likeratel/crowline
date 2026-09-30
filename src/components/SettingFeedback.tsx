import { LoaderCircle } from "lucide-react";
import { useSettingsChanges } from "../settingsChangesContext";
import { useI18n } from "../i18n";
import { settingsCopy } from "../settingsCopy";

export function SettingFeedback({ changeKey }: { changeKey: string }) {
  const { pendingKeys, failures, retry } = useSettingsChanges();
  const { locale, t } = useI18n();
  if (pendingKeys.includes(changeKey))
    return (
      <span
        className="setting-feedback"
        role="status"
        aria-label={settingsCopy(locale, "saving")}
      >
        <LoaderCircle size={12} className="spin" />
      </span>
    );
  const failure = failures[changeKey];
  if (!failure) return null;
  return (
    <span className="setting-feedback setting-error" role="alert">
      <span>
        {settingsCopy(
          locale,
          failure.phase === "confirm" ? "confirmFailed" : "saveFailed",
        )}
      </span>
      <button
        type="button"
        className="text-button"
        onClick={() => void retry(changeKey)}
      >
        {t("common.retry")}
      </button>
      <details>
        <summary>{settingsCopy(locale, "details")}</summary>
        {failure.message}
      </details>
    </span>
  );
}
