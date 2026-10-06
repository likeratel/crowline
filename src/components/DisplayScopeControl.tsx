import {
  effectiveDisplayScope,
  type Provider,
  type Settings,
  type Target,
  targetKey,
} from "../domain";
import { useSettingsChanges } from "../settingsChangesContext";
import { useI18n } from "../i18n";
import { uxCopy } from "../uxCopy";
import { SettingFeedback } from "./SettingFeedback";

export function DisplayScopeControl({
  settings,
  provider,
  target,
  disabled = false,
}: {
  settings: Settings;
  provider: Provider;
  target?: Target;
  disabled?: boolean;
}) {
  const { change } = useSettingsChanges();
  const { locale, t } = useI18n();
  const key = target ? targetKey(target) : null;
  const value = key
    ? settings.displayScopes.targets[key]
    : settings.displayScopes.providers[provider];
  const inherited = target
    ? effectiveDisplayScope(settings, { provider })
    : settings.scope;
  const label = uxCopy(locale, target ? "projectScope" : "serviceScope");
  return (
    <div className="display-scope-control">
      <label>
        <span>{label}</span>
        <select
          aria-label={target ? `${target.name} · ${label}` : label}
          value={value ?? "inherit"}
          disabled={disabled}
          onChange={(event) => {
            const scope =
              event.currentTarget.value === "inherit"
                ? null
                : (event.currentTarget.value as "mine" | "all");
            void change(
              key
                ? { kind: "displayTargetScope", targetKey: key, scope }
                : { kind: "displayProviderScope", provider, scope },
            );
          }}
        >
          <option value="inherit">
            {uxCopy(locale, target ? "serviceDefault" : "globalDefault")} ·{" "}
            {t(
              inherited === "mine" ? "dashboard.mineOnly" : "dashboard.allRuns",
            )}
          </option>
          <option value="mine">{t("dashboard.mineOnly")}</option>
          <option value="all">{t("dashboard.allRuns")}</option>
        </select>
      </label>
      <SettingFeedback
        changeKey={
          key ? `displayTargetScope:${key}` : `displayProviderScope:${provider}`
        }
      />
    </div>
  );
}
