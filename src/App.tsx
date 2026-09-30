import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertCircle,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  CircleDot,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { SettingsChangesProvider } from "./settingsChangesContext";
import { SettingFeedback } from "./components/SettingFeedback";
import { isPreview } from "./bridge";
import {
  isActive,
  PROVIDERS,
  PROVIDER_NAMES,
  visibleActivities,
  type Provider,
} from "./domain";
import { ActivityList } from "./components/ActivityList";
import { HistoryBrowser } from "./components/HistoryBrowser";
import { ProviderIcon } from "./components/ProviderIcon";
import { useMonitor } from "./useMonitor";
import { AccountFilter } from "./components/AccountFilter";
import { SettingsPage } from "./components/SettingsPage";
import { settingsCopy, type SettingsTab } from "./settingsCopy";
import { ServiceHealth } from "./components/ServiceHealth";
import { UpdateNotice } from "./components/UpdateNotice";
import { I18nProvider, formatRelativeTime, useI18n } from "./i18n";
import "./App.css";

export default function App() {
  const monitor = useMonitor();
  return (
    <I18nProvider language={monitor.snapshot?.settings.preferences.language}>
      <SettingsChangesProvider value={monitor.settingsChanges}>
        <Dashboard monitor={monitor} />
      </SettingsChangesProvider>
    </I18nProvider>
  );
}

function Dashboard({ monitor }: { monitor: ReturnType<typeof useMonitor> }) {
  const { locale, t } = useI18n();
  const [provider, setProvider] = useState<Provider | "all">("all");
  const [accountId, setAccountId] = useState("all");
  const [search, setSearch] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("connections");
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = (tab?: SettingsTab) => {
    if (tab) setSettingsTab(tab);
    setSettingsVisited(true);
    setSettingsOpen(true);
  };
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const {
    snapshot,
    busy,
    refreshing,
    error,
    setError,
    refresh,
    change,
    reload,
    loadMore,
    loadingMore,
  } = monitor;
  if (!snapshot)
    return (
      <main className="boot">
        <img className="boot-logo" src="/crowline.png" alt="" />
        <h1>crowline</h1>
        <p>{error ?? t("boot.checking")}</p>
        {error ? (
          <button className="button" onClick={() => void refresh()}>
            {t("common.retry")}
          </button>
        ) : (
          <LoaderCircle className="spin" size={22} />
        )}
      </main>
    );
  const selectedAccount = snapshot.settings.accounts.some(
    (account) =>
      account.id === accountId &&
      (provider === "all" || provider === account.provider),
  )
    ? accountId
    : "all";
  const activities = visibleActivities(
    snapshot,
    provider,
    search,
    undefined,
    selectedAccount,
  );
  const active = activities.filter(isActive);
  const completed = activities.filter(
    (activity) => !isActive(activity) && activity.status !== "unknown",
  );
  const unresolved = activities.filter(
    (activity) => activity.status === "unknown",
  );
  const unknown = snapshot.activities.filter(
    (activity) =>
      activity.ownership === "unknown" &&
      (provider === "all" || activity.provider === provider),
  ).length;
  const connected = snapshot.connections.filter(
    (connection) => connection.status === "connected",
  ).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setProvider("all");
            setSettingsOpen(false);
          }}
        >
          <span className="brand-mark">
            <img src="/crowline.png" alt="" />
          </span>
          <span>crowline</span>
        </a>
        <nav aria-label={t("nav.serviceFilter")}>
          <button
            className={`nav-item ${!settingsOpen && provider === "all" ? "selected" : ""}`}
            onClick={() => {
              setProvider("all");
              setSettingsOpen(false);
            }}
          >
            <ActivityIcon size={17} />
            {t("nav.allServices")}
            <span className="nav-count">
              {snapshot.settings.targets.length}
            </span>
          </button>
          {PROVIDERS.filter((item) =>
            snapshot.settings.accounts.some(
              (account) => account.provider === item,
            ),
          ).map((item) => (
            <button
              key={item}
              className={`nav-item ${!settingsOpen && provider === item ? "selected" : ""}`}
              onClick={() => {
                setProvider(item);
                setSettingsOpen(false);
              }}
            >
              <ProviderIcon provider={item} />
              {PROVIDER_NAMES[item]}
              <span className="nav-count">
                {
                  snapshot.settings.targets.filter(
                    (target) => target.provider === item,
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${settingsOpen ? "selected" : ""}`}
            onClick={() => openSettings()}
          >
            <Settings2 size={17} />
            {settingsCopy(locale, "title")}
          </button>
        </div>
      </aside>
      <main className="main-content">
        {settingsVisited && (
          <div hidden={!settingsOpen}>
            <SettingsPage
              tab={settingsTab}
              onTabChange={setSettingsTab}
              snapshot={snapshot}
              busy={busy}
              error={error}
              onRefresh={refresh}
              onReload={reload}
            />
          </div>
        )}
        {!settingsOpen && (
          <>
            {isPreview && (
              <div className="preview-banner">
                <Radio size={14} />
                <span>{t("dashboard.preview")}</span>
              </div>
            )}
            <header className="main-header">
              <div>
                <h1>
                  {provider === "all"
                    ? t("dashboard.title")
                    : PROVIDER_NAMES[provider]}
                </h1>
              </div>
              <button
                className="button refresh-button"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                {t("common.refresh")}
              </button>
            </header>
            <UpdateNotice settings={snapshot.settings} />
            <div className="summary-grid">
              <div className="summary-card active-summary">
                <span>
                  <CircleDot size={16} />
                  {t("dashboard.active")}
                </span>
                <div>
                  <strong>{active.length}</strong>
                  <small>{t("dashboard.runs")}</small>
                  <span className="summary-pulse">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
              <div className="summary-card">
                <span>
                  <CheckCheck size={16} />
                  {t("dashboard.completed")}
                </span>
                <div>
                  <strong>{completed.length}</strong>
                  <small>
                    {t("dashboard.elapsedPeriod", {
                      period:
                        snapshot.settings.historyHours === 24
                          ? t("common.period24h")
                          : t("common.period7d"),
                    })}
                  </small>
                </div>
              </div>
              <button
                className="summary-card connection-summary"
                onClick={() => openSettings("connections")}
              >
                <span>
                  <Radio size={16} />
                  {t("dashboard.connections")}
                  <ArrowUpRight size={15} />
                </span>
                <div>
                  <strong>
                    {connected}
                    <em>/ {snapshot.settings.accounts.length}</em>
                  </strong>
                  <small>
                    {t("dashboard.monitoringTargets", {
                      count: snapshot.settings.targets.length,
                    })}
                  </small>
                </div>
              </button>
            </div>
            <div className="toolbar">
              <div
                className="segmented"
                role="group"
                aria-label={t("dashboard.actorScope")}
              >
                <button
                  aria-pressed={snapshot.settings.scope === "mine"}
                  disabled={busy}
                  onClick={() => void change({ kind: "scope", value: "mine" })}
                >
                  {t("dashboard.mineOnly")}
                </button>
                <button
                  aria-pressed={snapshot.settings.scope === "all"}
                  disabled={busy}
                  onClick={() => void change({ kind: "scope", value: "all" })}
                >
                  {t("dashboard.allRuns")}
                </button>
              </div>
              <label className="search-box">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("dashboard.searchPlaceholder")}
                  aria-label={t("dashboard.search")}
                />
                {search && (
                  <button
                    className="clear-search"
                    aria-label={t("dashboard.clearSearch")}
                    onClick={() => setSearch("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
              <AccountFilter
                snapshot={snapshot}
                provider={provider}
                value={selectedAccount}
                onChange={setAccountId}
                className="period-select"
              />
              <select
                className="period-select"
                aria-label={t("dashboard.period")}
                value={snapshot.settings.historyHours}
                disabled={busy}
                onChange={(event) =>
                  void change({
                    kind: "historyHours",
                    value: event.target.value === "168" ? 168 : 24,
                  }).then((saved) => {
                    if (saved) void refresh();
                  })
                }
              >
                <option value={24}>{t("common.period24h")}</option>
                <option value={168}>{t("common.period7d")}</option>
              </select>
            </div>
            <SettingFeedback changeKey="scope" />
            <SettingFeedback changeKey="historyHours" />
            <div className="scope-description">
              {unknown > 0 && snapshot.settings.scope === "mine" && (
                <button
                  disabled={busy}
                  onClick={() => void change({ kind: "scope", value: "all" })}
                >
                  {t("dashboard.unknownActors", { count: unknown })}{" "}
                  <ChevronRight size={12} />
                </button>
              )}
            </div>
            <details className="dashboard-guide">
              <summary>{t("dashboard.guideTitle")}</summary>
              <div>
                <p>{t("dashboard.guideHistory")}</p>
                <p>{t("dashboard.guideSettings")}</p>
              </div>
            </details>
            <ServiceHealth
              snapshot={snapshot}
              onConnect={() => openSettings("connections")}
            />
            {snapshot.pendingTargets.length > 0 && (
              <div className="notice" role="status">
                {t("dashboard.pending", {
                  count: snapshot.pendingTargets.length,
                })}
              </div>
            )}
            {error && (
              <div className="notice warning" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label={t("dashboard.dismissError")}
                  onClick={() => setError(null)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {snapshot.issues.map((issue, index) => (
              <div
                className="notice warning"
                role="status"
                key={`${issue.provider}-${index}`}
              >
                <AlertCircle size={16} />
                <span>
                  <strong>{PROVIDER_NAMES[issue.provider]}</strong> ·{" "}
                  {issue.message}
                </span>
              </div>
            ))}
            {snapshot.settings.targets.length === 0 ? (
              <div className="onboarding-empty">
                <span className="empty-orbit">
                  <Radio size={37} />
                </span>
                <h2>{t("dashboard.onboardingTitle")}</h2>
                <p>{t("dashboard.onboardingBody")}</p>
                <button
                  className="button primary"
                  onClick={() => openSettings("connections")}
                >
                  <Plus size={16} />
                  {t("dashboard.connectService")}
                </button>
                <small>{t("dashboard.onboardingSteps")}</small>
              </div>
            ) : (
              <>
                <ActivityList
                  title={t("dashboard.active")}
                  compactEmpty
                  activities={active}
                  empty={t("dashboard.activeEmpty")}
                  onError={setError}
                />
                <ActivityList
                  title={t("dashboard.completed")}
                  activities={completed}
                  empty={t("dashboard.completedEmpty")}
                  onError={setError}
                />
                {unresolved.length > 0 && (
                  <ActivityList
                    title={t("dashboard.needsAttention")}
                    activities={unresolved}
                    empty=""
                    onError={setError}
                  />
                )}
              </>
            )}
            <HistoryBrowser
              snapshot={snapshot}
              provider={provider}
              accountId={selectedAccount}
              loading={loadingMore}
              onLoad={loadMore}
            />
            <footer className="main-footer">
              <span>
                <span
                  className={`live-dot ${snapshot.issues.length ? "amber" : ""}`}
                />
                {refreshing
                  ? t("dashboard.refreshing")
                  : snapshot.lastUpdatedAt
                    ? t("dashboard.lastChecked", {
                        time: formatRelativeTime(
                          snapshot.lastUpdatedAt,
                          locale,
                        ),
                      })
                    : t("dashboard.neverUpdated")}
              </span>
              <span>{t("dashboard.refreshCadence")}</span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
