import { useEffect, useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { accountDisplayName } from "../accountNames";
import { errorMessage, isPreview } from "../bridge";
import { desktop, type DesktopStatus } from "../desktopBridge";
import {
  PROVIDER_NAMES,
  targetKey,
  type Connection,
  type NotificationRule,
  type Provider,
  type Settings,
} from "../domain";
import { useI18n } from "../i18n";
import { notificationCopy } from "../notificationCopy";
import type { SettingsChange } from "../settingsChanges";
import { useSettingsChanges } from "../settingsChangesContext";
import { ProviderIcon } from "./ProviderIcon";
import { SettingFeedback } from "./SettingFeedback";
import "../styles/notifications.css";

type Props = {
  settings: Settings;
  busy: boolean;
  error?: string | null;
  connections?: Connection[];
};
type ScopeChoice = "off" | NotificationRule["scope"];
type ResultPreset = "all" | "success" | "failed" | "custom";
type Outcome = NotificationRule["statuses"][number];
type NotificationRulePatch = Extract<
  SettingsChange,
  { kind: "notificationRules" }
>["rules"][number];
type NotificationRuleFields = Omit<NotificationRulePatch, "targetKey">;

const OUTCOMES: readonly Outcome[] = ["success", "failed", "canceled"];
const defaultRule = (key: string): NotificationRule => ({
  targetKey: key,
  enabled: false,
  scope: "mine",
  statuses: [...OUTCOMES],
});
const resultPreset = (statuses: readonly Outcome[]): ResultPreset => {
  if (OUTCOMES.every((status) => statuses.includes(status))) return "all";
  if (statuses.length === 1 && statuses[0] === "success") return "success";
  if (statuses.length === 1 && statuses[0] === "failed") return "failed";
  return "custom";
};
const presetStatuses = (preset: Exclude<ResultPreset, "custom">): Outcome[] =>
  preset === "all"
    ? [...OUTCOMES]
    : preset === "success"
      ? ["success"]
      : ["failed"];
const retainKnownKeys = <T,>(
  values: Readonly<Record<string, T>>,
  keys: ReadonlySet<string>,
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(values).filter(([key]) => keys.has(key)),
  ) as Record<string, T>;

export function NotificationPreferences({
  settings,
  error,
  connections = [],
}: Props) {
  const { locale } = useI18n();
  const { change, failures, pendingKeys } = useSettingsChanges();
  const c = (
    key: Parameters<typeof notificationCopy>[1],
    values?: Record<string, string | number>,
  ) => notificationCopy(locale, key, values);
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<Provider | "all">("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [customModes, setCustomModes] = useState<Record<string, true>>({});
  const [lastBulkFeedbackKey, setLastBulkFeedbackKey] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [permissionWorking, setPermissionWorking] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const availableKeys = useMemo(
    () => new Set(settings.targets.map((target) => targetKey(target))),
    [settings.targets],
  );
  useEffect(() => {
    setSelected(
      (current) =>
        new Set([...current].filter((key) => availableKeys.has(key))),
    );
    setCustomModes((current) => retainKnownKeys(current, availableKeys));
  }, [availableKeys]);
  useEffect(() => {
    let active = true;
    void desktop
      .status()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((cause) => {
        if (active) setPermissionError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const ruleFor = (key: string): NotificationRule =>
    settings.preferences.notifications.rules.find(
      (rule) => rule.targetKey === key,
    ) ?? defaultRule(key);
  const updateRules = (rules: NotificationRulePatch[]) =>
    change({ kind: "notificationRules", rules });
  const patchRule = (key: string, patch: NotificationRuleFields) =>
    void updateRules([{ targetKey: key, ...patch }]);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filteredTargets = settings.targets.filter((target) => {
    const account = settings.accounts.find(
      (item) => item.id === target.connectionId,
    );
    const accountName = account
      ? accountDisplayName(account, settings, connections)
      : target.connectionId;
    const haystack =
      `${target.name} ${PROVIDER_NAMES[target.provider]} ${accountName}`.toLocaleLowerCase(
        locale,
      );
    return (
      (provider === "all" || target.provider === provider) &&
      haystack.includes(normalizedQuery)
    );
  });
  const filteredKeys = filteredTargets.map(targetKey);
  const allFilteredSelected =
    filteredKeys.length > 0 && filteredKeys.every((key) => selected.has(key));
  const providers = [
    ...new Set(settings.targets.map((target) => target.provider)),
  ];
  const selectedKeys = [...selected].sort();
  const notificationFailures = Object.entries(failures).filter(
    ([, failure]) => {
      if (failure.change.kind !== "notificationRules") return false;
      return (
        failure.change.rules.length > 1 ||
        !filteredKeys.includes(failure.change.rules[0]?.targetKey ?? "")
      );
    },
  );
  const failureLabel = (failureKey: string) => {
    const failure = failures[failureKey];
    if (!failure || failure.change.kind !== "notificationRules") return "";
    const names = failure.change.rules.map((rule) => {
      const target = settings.targets.find(
        (item) => targetKey(item) === rule.targetKey,
      );
      return target?.name ?? rule.targetKey;
    });
    return names.length <= 3
      ? names.join(", ")
      : c("projectCount", { count: names.length });
  };

  const applySelected = (patch: NotificationRuleFields) => {
    const feedbackKey = `notificationRules:${selectedKeys.join("|")}`;
    setLastBulkFeedbackKey(feedbackKey);
    void updateRules(selectedKeys.map((key) => ({ targetKey: key, ...patch })));
  };
  const applyResultPreset = (preset: Exclude<ResultPreset, "custom">) => {
    setCustomModes(
      (current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !selected.has(key)),
        ) as Record<string, true>,
    );
    applySelected({ statuses: presetStatuses(preset) });
  };
  const setResultMode = (key: string, preset: ResultPreset) => {
    if (preset === "custom") {
      setCustomModes((current) => ({ ...current, [key]: true }));
      return;
    }
    setCustomModes((current) => {
      const { [key]: _removed, ...remaining } = current;
      return remaining;
    });
    patchRule(key, { statuses: presetStatuses(preset) });
  };
  const requestPermission = async () => {
    setPermissionWorking(true);
    setPermissionError(null);
    try {
      const permission = await desktop.permission();
      setStatus((current) =>
        current ? { ...current, notificationPermission: permission } : current,
      );
    } catch (cause) {
      setPermissionError(errorMessage(cause));
    } finally {
      setPermissionWorking(false);
    }
  };

  return (
    <section className="notification-preferences" aria-label={c("title")}>
      <div className="notification-master-row">
        <label className="notification-master">
          <input
            type="checkbox"
            checked={settings.preferences.notifications.enabled}
            onChange={(event) =>
              void change({
                kind: "notificationEnabled",
                enabled: event.currentTarget.checked,
              })
            }
          />
          {c("enabled")}
        </label>
        <SettingFeedback changeKey="notificationEnabled" />
      </div>

      {(isPreview ||
        !status ||
        status.notificationPermission !== "granted") && (
        <div className="notification-permission">
          <span>
            {isPreview
              ? c("desktopOnly")
              : status
                ? c(status.notificationPermission)
                : c("checking")}
          </span>
          {!isPreview &&
            status &&
            status.notificationPermission !== "granted" && (
              <button
                className="text-button"
                disabled={permissionWorking}
                onClick={() => void requestPermission()}
              >
                {c("allow")}
              </button>
            )}
        </div>
      )}

      <div className="notification-filters">
        <label className="notification-search" htmlFor={searchId}>
          <Search size={15} aria-hidden="true" />
          <input
            id={searchId}
            value={query}
            placeholder={c("search")}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select
          aria-label={c("allProviders")}
          value={provider}
          onChange={(event) =>
            setProvider(event.currentTarget.value as Provider | "all")
          }
        >
          <option value="all">{c("allProviders")}</option>
          {providers.map((item) => (
            <option value={item} key={item}>
              {PROVIDER_NAMES[item]}
            </option>
          ))}
        </select>
      </div>

      <div
        className="notification-bulk"
        aria-label={c("selected", { count: selected.size })}
      >
        <label className="notification-select-all">
          <input
            type="checkbox"
            disabled={filteredKeys.length === 0}
            checked={allFilteredSelected}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setSelected((current) =>
                checked
                  ? new Set([...current, ...filteredKeys])
                  : new Set(
                      [...current].filter((key) => !filteredKeys.includes(key)),
                    ),
              );
            }}
          />
          {c("selectFiltered")}
        </label>
        <strong>{c("selected", { count: selected.size })}</strong>
        <button
          type="button"
          className="text-button"
          disabled={selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          {c("clear")}
        </button>
        <select
          aria-label={c("bulkScope")}
          disabled={selected.size === 0}
          value=""
          onChange={(event) => {
            const value = event.currentTarget.value as ScopeChoice;
            if (value) {
              applySelected(
                value === "off"
                  ? { enabled: false }
                  : { enabled: true, scope: value },
              );
            }
          }}
        >
          <option value="">{c("chooseScope")}</option>
          <option value="off">{c("off")}</option>
          <option value="mine">{c("mine")}</option>
          <option value="all">{c("allRuns")}</option>
        </select>
        <select
          aria-label={c("bulkResult")}
          disabled={selected.size === 0}
          value=""
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "all" || value === "success" || value === "failed") {
              applyResultPreset(value);
            }
          }}
        >
          <option value="">{c("chooseResult")}</option>
          <option value="all">{c("allResults")}</option>
          <option value="success">{c("successOnly")}</option>
          <option value="failed">{c("failedOnly")}</option>
        </select>
        {lastBulkFeedbackKey && pendingKeys.includes(lastBulkFeedbackKey) && (
          <SettingFeedback changeKey={lastBulkFeedbackKey} />
        )}
      </div>

      <div className="notification-list">
        {settings.targets.length === 0 && (
          <p className="notification-empty">{c("noTargets")}</p>
        )}
        {settings.targets.length > 0 && filteredTargets.length === 0 && (
          <p className="notification-empty">{c("noMatches")}</p>
        )}
        {filteredTargets.map((target) => {
          const key = targetKey(target);
          const rule = ruleFor(key);
          const account = settings.accounts.find(
            (item) => item.id === target.connectionId,
          );
          const accountName = account
            ? accountDisplayName(account, settings, connections)
            : target.connectionId;
          const preset = customModes[key]
            ? "custom"
            : resultPreset(rule.statuses);
          return (
            <article className="notification-row" key={key}>
              <input
                aria-label={`${target.name} · ${accountName} · ${c("rowSelect")}`}
                type="checkbox"
                checked={selected.has(key)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(key);
                    else next.delete(key);
                    return next;
                  });
                }}
              />
              <div className="notification-project-name">
                <ProviderIcon provider={target.provider} />
                <span>
                  <strong>{target.name}</strong>
                  <small>
                    {PROVIDER_NAMES[target.provider]} · {accountName}
                  </small>
                </span>
              </div>
              <select
                aria-label={`${target.name} · ${accountName} · ${c("rowScope")}`}
                value={rule.enabled ? rule.scope : "off"}
                onChange={(event) => {
                  const value = event.currentTarget.value as ScopeChoice;
                  patchRule(
                    key,
                    value === "off"
                      ? { enabled: false }
                      : { enabled: true, scope: value },
                  );
                }}
              >
                <option value="off">{c("off")}</option>
                <option value="mine">{c("mine")}</option>
                <option value="all">{c("allRuns")}</option>
              </select>
              <div className="notification-result-cell">
                <select
                  aria-label={`${target.name} · ${accountName} · ${c("rowResult")}`}
                  disabled={!rule.enabled}
                  value={preset}
                  onChange={(event) =>
                    setResultMode(
                      key,
                      event.currentTarget.value as ResultPreset,
                    )
                  }
                >
                  <option value="all">{c("allResults")}</option>
                  <option value="success">{c("successOnly")}</option>
                  <option value="failed">{c("failedOnly")}</option>
                  <option value="custom">{c("custom")}</option>
                </select>
                {preset === "custom" && rule.enabled && (
                  <div className="notification-custom">
                    {OUTCOMES.map((outcome) => {
                      const checked = rule.statuses.includes(outcome);
                      const lastChecked = checked && rule.statuses.length === 1;
                      return (
                        <label key={outcome}>
                          <input
                            type="checkbox"
                            disabled={lastChecked}
                            checked={checked}
                            onChange={(event) => {
                              const nextStatuses = event.currentTarget.checked
                                ? [...rule.statuses, outcome]
                                : rule.statuses.filter(
                                    (item) => item !== outcome,
                                  );
                              setCustomModes((current) => ({
                                ...current,
                                [key]: true,
                              }));
                              patchRule(key, { statuses: nextStatuses });
                            }}
                          />
                          {c(outcome)}
                        </label>
                      );
                    })}
                  </div>
                )}
                <SettingFeedback changeKey={`notificationRules:${key}`} />
              </div>
            </article>
          );
        })}
      </div>
      {notificationFailures.length > 0 && (
        <div className="notification-failures" aria-label={c("saveFailures")}>
          {notificationFailures.map(([failureKey]) => (
            <div className="notification-failure" key={failureKey}>
              <strong>{failureLabel(failureKey)}</strong>
              <SettingFeedback changeKey={failureKey} />
            </div>
          ))}
        </div>
      )}
      {(permissionError || error) && (
        <p className="notice warning" role="alert">
          {permissionError || error}
        </p>
      )}
    </section>
  );
}
