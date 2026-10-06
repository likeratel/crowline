import { useEffect, useState, type KeyboardEvent } from "react";
import type { Provider, Snapshot } from "../domain";
import { useI18n } from "../i18n";
import { settingsCopy, type SettingsTab } from "../settingsCopy";
import { Connections } from "./Connections";
import { GeneralPreferences } from "./GeneralPreferences";
import { NotificationPreferences } from "./NotificationPreferences";
import { PanelPreferences } from "./PanelPreferences";
import { SettingsRecoveryNotice } from "./SettingsRecoveryNotice";
import "../styles/settings.css";
const tabs: SettingsTab[] = [
  "connections",
  "notifications",
  "panel",
  "general",
];
type Props = {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  snapshot: Snapshot;
  busy: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onReload: () => Promise<void>;
  requestedProvider?: Provider;
  requestedConnectionId?: string;
  connectionRequest?: number;
};
export function SettingsPage({
  tab,
  onTabChange,
  snapshot,
  busy,
  error,
  onRefresh,
  onReload,
  requestedProvider,
  requestedConnectionId,
  connectionRequest,
}: Props) {
  const { locale } = useI18n();
  const [connectionBusy, setConnectionBusy] = useState(false);
  const settingsLocked = Boolean(snapshot.settingsError);
  const c = (key: Parameters<typeof settingsCopy>[1]) =>
    settingsCopy(locale, key);
  const [visited, setVisited] = useState<SettingsTab[]>([tab]);
  useEffect(() => {
    setVisited((previous) =>
      previous.includes(tab) ? previous : [...previous, tab],
    );
  }, [tab]);
  const select = (next: SettingsTab) => {
    onTabChange(next);
    setVisited((previous) =>
      previous.includes(next) ? previous : [...previous, next],
    );
  };
  const keyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: SettingsTab,
  ) => {
    const index = tabs.indexOf(current);
    const next =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs[tabs.length - 1]
          : event.key === "ArrowRight"
            ? tabs[(index + 1) % tabs.length]
            : event.key === "ArrowLeft"
              ? tabs[(index + tabs.length - 1) % tabs.length]
              : null;
    if (!next) return;
    event.preventDefault();
    select(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };
  const props = {
    settings: snapshot.settings,
    connections: snapshot.connections,
    busy: busy || connectionBusy,
    error,
  };
  return (
    <section className="settings-page" aria-label={c("title")}>
      <header className="main-header">
        <div>
          <h1>{c("title")}</h1>
        </div>
      </header>
      <SettingsRecoveryNotice error={snapshot.settingsError} />
      <div className="settings-tabs" role="tablist" aria-label={c("title")}>
        {tabs.map((item) => (
          <button
            key={item}
            id={`settings-tab-${item}`}
            role="tab"
            aria-selected={tab === item}
            aria-controls={`settings-content-${item}`}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => select(item)}
            onKeyDown={(event) => keyDown(event, item)}
          >
            {c(item)}
          </button>
        ))}
      </div>
      {tabs.map((item) => (
        <div
          key={item}
          role="tabpanel"
          id={`settings-content-${item}`}
          aria-labelledby={`settings-tab-${item}`}
          hidden={tab !== item}
        >
          <fieldset className="settings-lock-surface" disabled={settingsLocked}>
            {(visited.includes(item) || tab === item) &&
              (item === "connections" ? (
                <>
                  {error && (
                    <p className="notice warning" role="alert">
                      {error}
                    </p>
                  )}
                  <Connections
                    snapshot={snapshot}
                    requestedProvider={requestedProvider}
                    requestedConnectionId={requestedConnectionId}
                    connectionRequest={connectionRequest}
                    onNotifications={() => select("notifications")}
                    saving={busy}
                    onBusyChange={setConnectionBusy}
                    onRefresh={onRefresh}
                    onReload={onReload}
                  />
                </>
              ) : item === "notifications" ? (
                <NotificationPreferences {...props} />
              ) : item === "panel" ? (
                <PanelPreferences {...props} embedded />
              ) : (
                <GeneralPreferences {...props} />
              ))}
          </fieldset>
        </div>
      ))}
    </section>
  );
}
