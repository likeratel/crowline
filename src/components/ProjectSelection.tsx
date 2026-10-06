import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  targetKey,
  type Provider,
  type Snapshot,
  type Target,
} from "../domain";
import { useI18n } from "../i18n";
import { uxCopy } from "../uxCopy";
import { useSettingsChanges } from "../settingsChangesContext";
import { DisplayScopeControl } from "./DisplayScopeControl";
import { SettingFeedback } from "./SettingFeedback";
import { targetsChangedByBulkSelection } from "./connectionTargets";

export function ProjectSelection({
  snapshot,
  provider,
  connectionId,
  uniqueTargets,
  discovered,
  disabled,
  onRefresh,
  onError,
  onNotifications,
}: {
  snapshot: Snapshot;
  provider: Provider;
  connectionId: string;
  uniqueTargets: Target[];
  discovered: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onError: (cause: unknown) => void;
  onNotifications?: () => void;
}) {
  const { locale, t } = useI18n();
  const { change, failures, pendingKeys, retry } = useSettingsChanges();
  const [search, setSearch] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [retrySaving, setRetrySaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bulkSavePending = useRef(false);
  const retrySavePending = useRef(false);
  const working = disabled || bulkSaving || retrySaving;
  const selected = snapshot.settings.targets;
  const targets = useMemo(
    () =>
      uniqueTargets.filter((target) =>
        `${target.name} ${target.description ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [uniqueTargets, search],
  );
  const pendingCount = snapshot.pendingTargets.filter((key) =>
    key.startsWith(`${provider}:${connectionId}:`),
  ).length;
  const selectedTargetKeys = new Set(selected.map(targetKey));
  const allVisibleSelected =
    targets.length > 0 &&
    targets.every((target) => selectedTargetKeys.has(targetKey(target)));
  const currentTargetPrefix = `${provider}:${connectionId}:`;
  const bulkFeedbackKeys = [
    ...pendingKeys.filter(
      (key) =>
        key.startsWith(`targets:${currentTargetPrefix}`) ||
        key.includes(`|${currentTargetPrefix}`),
    ),
    ...Object.entries(failures).flatMap(([key, failure]) =>
      failure.change.kind === "targets" &&
      failure.change.targets.every(
        (target) =>
          target.provider === provider && target.connectionId === connectionId,
      )
        ? [key]
        : [],
    ),
  ].filter((key, index, all) => all.indexOf(key) === index);
  const saveSelection = async (
    save: () => Promise<boolean>,
    shouldRefresh: boolean,
  ) => {
    setSaved(false);
    try {
      if (!(await save())) return false;
      setSaved(true);
      if (shouldRefresh) void onRefresh().catch(onError);
      return true;
    } catch (cause) {
      onError(cause);
      return false;
    }
  };
  const retrySelection = async (key: string) => {
    const failure = failures[key];
    if (!failure || retrySavePending.current) return;
    const shouldRefresh =
      (failure.change.kind === "target" || failure.change.kind === "targets") &&
      failure.change.selected;
    retrySavePending.current = true;
    setRetrySaving(true);
    try {
      await saveSelection(() => retry(key), shouldRefresh);
    } finally {
      retrySavePending.current = false;
      setRetrySaving(false);
    }
  };
  const setVisibleTargetsSelected = async (shouldSelect: boolean) => {
    if (bulkSavePending.current || targets.length === 0) return;
    const changedTargets = targetsChangedByBulkSelection(
      targets,
      selectedTargetKeys,
      shouldSelect,
    );
    if (changedTargets.length === 0) return;
    bulkSavePending.current = true;
    setBulkSaving(true);
    try {
      const bulkChange = {
        kind: "targets" as const,
        targets: changedTargets,
        selected: shouldSelect,
      };
      await saveSelection(() => change(bulkChange), shouldSelect);
    } finally {
      bulkSavePending.current = false;
      setBulkSaving(false);
    }
  };
  const toggle = (target: Target) => {
    const shouldSelect = !selectedTargetKeys.has(targetKey(target));
    void saveSelection(
      () =>
        change({
          kind: "target",
          target,
          selected: shouldSelect,
        }),
      shouldSelect,
    );
  };
  return (
    <section
      className="project-selection"
      aria-label={uxCopy(locale, "projectStep")}
    >
      <div className="target-heading">
        <h3>
          {uxCopy(locale, "projectStep")} <span>{uniqueTargets.length}</span>
        </h3>
        <span>
          {t("common.selectedCount", {
            count: selected.filter(
              (target) => target.connectionId === connectionId,
            ).length,
          })}
        </span>
      </div>
      <div className="project-preferences">
        <DisplayScopeControl
          settings={snapshot.settings}
          provider={provider}
          disabled={working}
        />
        <details className="project-selection-help">
          <summary>{uxCopy(locale, "projectOptionsHelp")}</summary>
          <p>{uxCopy(locale, "projectHelp")}</p>
          <p>
            {uxCopy(locale, "displayHelp")} {uxCopy(locale, "serviceRulesHelp")}
          </p>
          {onNotifications && (
            <button className="text-button" onClick={onNotifications}>
              {uxCopy(locale, "notificationsSetup")}
            </button>
          )}
        </details>
      </div>
      {uniqueTargets.length > 0 && (
        <div className="target-controls">
          <label className="search-box target-search">
            <Search size={15} />
            <input
              aria-label={t("connections.searchTargets")}
              value={search}
              placeholder={t("connections.searchByName")}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="target-bulk-actions">
            {search && (
              <span className="field-help">
                {uxCopy(locale, "filteredSelection")}
              </span>
            )}
            <button
              type="button"
              className="button"
              disabled={working || targets.length === 0}
              onClick={() =>
                void setVisibleTargetsSelected(!allVisibleSelected)
              }
            >
              {uxCopy(locale, allVisibleSelected ? "deselectAll" : "selectAll")}
            </button>
            {bulkFeedbackKeys.map((key) => (
              <SettingFeedback
                key={key}
                changeKey={key}
                onRetry={() => retrySelection(key)}
              />
            ))}
          </div>
        </div>
      )}
      {(saved || pendingCount > 0) && (
        <p className="selection-status" role="status">
          {saved && <span>{uxCopy(locale, "saved")}</span>}
          {pendingCount > 0 && (
            <span>{t("dashboard.pending", { count: pendingCount })}</span>
          )}
        </p>
      )}
      <div className="target-list">
        {targets.length ? (
          targets.map((target) => {
            const selectedTarget = selectedTargetKeys.has(targetKey(target));
            return (
              <div key={targetKey(target)} className="project-selection-row">
                <label className="target-option">
                  <input
                    type="checkbox"
                    disabled={working}
                    checked={selectedTarget}
                    onChange={() => toggle(target)}
                  />
                  <span className="target-name">
                    <strong>{target.name}</strong>
                    {target.description && <small>{target.description}</small>}
                    <SettingFeedback
                      changeKey={`target:${targetKey(target)}`}
                      onRetry={() =>
                        retrySelection(`target:${targetKey(target)}`)
                      }
                    />
                  </span>
                </label>
                {selectedTarget && (
                  <DisplayScopeControl
                    settings={snapshot.settings}
                    provider={provider}
                    target={target}
                    disabled={working}
                  />
                )}
              </div>
            );
          })
        ) : (
          <p className="targets-empty">
            {search
              ? uxCopy(locale, "noSearchResults")
              : discovered
                ? t("connections.noTargets")
                : t("connections.verifyFirst")}
          </p>
        )}
      </div>
    </section>
  );
}
