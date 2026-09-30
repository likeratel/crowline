import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  LoaderCircle,
  Minus,
  Pause,
  RefreshCw,
  X,
} from "lucide-react";
import { bridge, errorMessage, isPreview } from "../bridge";
import {
  isActive,
  PROVIDER_NAMES,
  panelActivities,
  latestCompleted,
  sortPanelActivities,
  targetKey,
  type Activity,
} from "../domain";
import { ProviderIcon } from "./ProviderIcon";
import { useMonitor } from "../useMonitor";
import {
  formatDuration,
  formatRelativeTime,
  I18nProvider,
  useI18n,
} from "../i18n";
import "../styles/panel.css";

function RunRow({
  item,
  onError,
}: {
  item: Activity;
  onError: (message: string) => void;
}) {
  const { locale, t } = useI18n();
  const Icon =
    item.status === "running"
      ? LoaderCircle
      : item.status === "success"
        ? Check
        : item.status === "failed"
          ? X
          : item.status === "waiting"
            ? Pause
            : item.status === "canceled"
              ? Minus
              : Circle;
  return (
    <button
      className="panel-run"
      onClick={() =>
        void bridge
          .open(item.url)
          .catch((cause: unknown) => onError(errorMessage(cause)))
      }
    >
      <span
        className="panel-provider"
        title={PROVIDER_NAMES[item.provider]}
        aria-label={`${PROVIDER_NAMES[item.provider]} · ${t(`status.${item.status}`)}`}
        role="img"
      >
        <ProviderIcon provider={item.provider} size={22} />
      </span>
      <span className="panel-run-status" title={t(`status.${item.status}`)}>
        <Icon
          size={16}
          className={`run-symbol ${item.status} ${item.status === "running" ? "spin" : ""}`}
          aria-hidden="true"
        />
      </span>
      <span className="panel-run-copy">
        <span className="panel-run-title">{item.title}</span>
        <span className="panel-run-meta">
          {item.project}
          {item.branch ? ` · ${item.branch}` : ""}
        </span>
      </span>
      <span className="panel-run-time" title={item.rawStatus}>
        {isActive(item) && item.provider !== "aws"
          ? formatDuration(
              item.startedAt,
              item.finishedAt ?? Date.now(),
              locale,
            )
          : item.finishedAt
            ? formatRelativeTime(item.finishedAt, locale)
            : t("activity.updated", {
                time: formatRelativeTime(item.updatedAt, locale),
              })}
      </span>
    </button>
  );
}

function RunSection({
  title,
  items,
  limit,
  onError,
  empty,
}: {
  title: string;
  empty: string;
  items: Activity[];
  limit: number;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="panel-section" aria-label={title}>
      <h2>
        {title}
        <span>{items.length}</span>
      </h2>
      {items.length ? (
        items
          .slice(0, limit)
          .map((item) => (
            <RunRow
              key={`${item.provider}:${item.id}`}
              item={item}
              onError={onError}
            />
          ))
      ) : (
        <p className="panel-empty-row">{empty}</p>
      )}
      {items.length > limit && (
        <button
          className="panel-more"
          onClick={() =>
            void bridge
              .dashboard()
              .catch((cause: unknown) => onError(errorMessage(cause)))
          }
        >
          {t("common.moreCount", { count: items.length - limit })}{" "}
          <ChevronRight size={12} />
        </button>
      )}
    </section>
  );
}

export function TrayPanel() {
  const monitor = useMonitor();
  return (
    <I18nProvider language={monitor.snapshot?.settings.preferences.language}>
      <TrayPanelContent monitor={monitor} />
    </I18nProvider>
  );
}

function TrayPanelContent({
  monitor,
}: {
  monitor: ReturnType<typeof useMonitor>;
}) {
  const { locale, t } = useI18n();
  const { snapshot, refreshing: busy, error, setError, refresh } = monitor;
  const [, tick] = useState(0);
  useEffect(() => {
    document.documentElement.classList.add("panel-mode");
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        void bridge
          .hide()
          .catch((cause: unknown) => setError(errorMessage(cause)));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("panel-mode");
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [setError]);
  const items = snapshot ? panelActivities(snapshot) : [];
  const visibleTargets =
    snapshot?.settings.targets.filter(
      (target) =>
        snapshot.settings.panel.providers.includes(target.provider) &&
        !snapshot.settings.panel.hiddenTargets.includes(targetKey(target)),
    ).length ?? 0;
  const active = items.filter(isActive);
  const complete = snapshot
    ? sortPanelActivities(latestCompleted(items), snapshot.settings.panel)
    : [];
  const unresolved = items.filter((item) => item.status === "unknown");
  const openDashboard = () =>
    void bridge
      .dashboard()
      .catch((cause: unknown) => setError(errorMessage(cause)));
  return (
    <main className="tray-panel" aria-label={t("tray.summary")}>
      <header className="panel-header">
        <span className="panel-brand">
          <img src="/crowline.png" alt="" />
          crowline
        </span>
        <div className="panel-actions">
          <button
            className="panel-icon"
            aria-label={t("common.refresh")}
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
          </button>
          <button
            className="panel-icon"
            aria-label={t("tray.close")}
            onClick={() =>
              void bridge
                .hide()
                .catch((cause: unknown) => setError(errorMessage(cause)))
            }
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {isPreview && <div className="panel-preview">{t("tray.preview")}</div>}
      {snapshot && snapshot.settings.targets.length > 0 && (
        <div className="panel-scope">
          <span>
            {t("tray.scope", {
              scope:
                snapshot.settings.scope === "mine"
                  ? t("tray.mine")
                  : t("tray.all"),
              visible: visibleTargets,
              total: snapshot.settings.targets.length,
            })}
          </span>
          <button onClick={openDashboard}>
            {t("tray.checkScope")} <ChevronRight size={12} />
          </button>
        </div>
      )}
      <div className="panel-scroll">
        {snapshot && snapshot.pendingTargets.length > 0 && (
          <p className="panel-empty-row" role="status">
            {t("tray.pending", { count: snapshot.pendingTargets.length })}
          </p>
        )}
        {error && (
          <p className="panel-error" role="alert">
            {error}
          </p>
        )}
        {snapshot && snapshot.issues.length > 0 && (
          <details className="panel-issues">
            <summary>
              {t("tray.issues", { count: snapshot.issues.length })}
            </summary>
            {snapshot.issues.map((issue, index) => (
              <p key={`${issue.provider}:${index}`}>
                {PROVIDER_NAMES[issue.provider]} · {issue.message}
              </p>
            ))}
          </details>
        )}
        {!snapshot ? (
          <p className="panel-empty-row">
            {error ? t("tray.checkConnection") : t("tray.connecting")}
          </p>
        ) : snapshot.settings.targets.length === 0 ? (
          <div className="panel-onboarding">
            <h1>{t("tray.onboardingTitle")}</h1>
            <p>{t("tray.onboardingBody")}</p>
            <button onClick={openDashboard}>
              {t("tray.connectDashboard")} <ChevronRight size={13} />
            </button>
          </div>
        ) : (
          <>
            {items.length === 0 && (
              <p className="panel-empty-row">
                {visibleTargets === 0
                  ? t("tray.noVisibleTargets")
                  : t("tray.noResults")}
              </p>
            )}
            {snapshot.settings.panel.showActive && (
              <RunSection
                title={t("dashboard.active")}
                empty={t("tray.activeEmpty")}
                items={active}
                limit={snapshot.settings.panel.rowLimit}
                onError={setError}
              />
            )}
            {snapshot.settings.panel.showCompleted && (
              <RunSection
                title={
                  snapshot.settings.historyHours === 24
                    ? t("common.period24h")
                    : t("common.period7d")
                }
                empty={t("tray.completedEmpty")}
                items={complete}
                limit={snapshot.settings.panel.rowLimit}
                onError={setError}
              />
            )}
            {!snapshot.settings.panel.showActive &&
              !snapshot.settings.panel.showCompleted && (
                <p className="panel-empty-row">{t("tray.sectionsHidden")}</p>
              )}
            {unresolved.length > 0 && (
              <RunSection
                title={t("dashboard.needsAttention")}
                empty={t("tray.unresolvedEmpty")}
                items={unresolved}
                limit={snapshot.settings.panel.rowLimit}
                onError={setError}
              />
            )}
          </>
        )}
      </div>
      <footer className="panel-footer">
        <span>
          {busy
            ? t("tray.checking")
            : snapshot?.lastUpdatedAt
              ? t("tray.checked", {
                  time: formatRelativeTime(snapshot.lastUpdatedAt, locale),
                })
              : t("tray.waiting")}
        </span>
        <button onClick={openDashboard}>
          {t("tray.openDashboard")} <ArrowUpRight size={13} />
        </button>
      </footer>
    </main>
  );
}
