import { AlertTriangle } from "lucide-react";
import { useI18n } from "../i18n";

export function SettingsRecoveryNotice({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;

  return (
    <section className="settings-recovery" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <div>
        <div className="settings-recovery-heading">
          <strong>{t("settingsRecovery.title")}</strong>
          <span>{t("settingsRecovery.locked")}</span>
        </div>
        <p>{t("settingsRecovery.body")}</p>
        <details>
          <summary>{t("settingsRecovery.details")}</summary>
          <p>{error}</p>
        </details>
      </div>
    </section>
  );
}
