import { useEffect, useState } from "react";
import { desktop, type UpdateInfo } from "../desktopBridge";
import { isPreview, errorMessage } from "../bridge";
import { type Settings } from "../domain";
import { useI18n } from "../i18n";
import { copy } from "../featureCopy";
let cached: Promise<UpdateInfo | null> | null = null;
let lastCheck = 0;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
function checkOnce() {
  if (!cached || Date.now() - lastCheck >= CHECK_INTERVAL_MS) {
    lastCheck = Date.now();
    cached = desktop
      .status()
      .then((status) =>
        status.updaterConfigured ? desktop.check(false) : null,
      );
  }
  return cached;
}
export function UpdateNotice({ settings }: { settings: Settings }) {
  const { locale } = useI18n();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(
    Boolean(desktop.installedVersion()),
  );
  useEffect(() => {
    if (
      isPreview ||
      desktop.installedVersion() ||
      !settings.preferences.checkUpdatesAutomatically
    )
      return;
    let active = true;
    const check = () => {
      void checkOnce()
        .then((value) => {
          if (active) {
            setUpdate(value);
            setProblem(null);
          }
        })
        .catch((cause) => {
          if (active) setProblem(errorMessage(cause));
        });
    };
    check();
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [settings.preferences.checkUpdatesAutomatically]);
  if (installed)
    return (
      <p className="notice" role="status">
        {copy(locale, "restartNote")}
      </p>
    );
  if (problem)
    return (
      <details className="notice warning">
        <summary>{copy(locale, "checkUpdate")}</summary>
        <p>{problem}</p>
      </details>
    );
  if (!update?.available) return null;
  return (
    <div className="notice" role="status">
      <span>
        {copy(locale, "updateAvailable", { version: update.version ?? "" })}
      </span>
      <button
        className="button"
        disabled={installing}
        onClick={() => {
          setInstalling(true);
          void desktop
            .install(update.version!)
            .then(() => {
              cached = null;
              setInstalled(true);
              setUpdate(null);
            })
            .catch((cause) => setProblem(errorMessage(cause)))
            .finally(() => setInstalling(false));
        }}
      >
        {copy(locale, "installUpdate")}
      </button>
    </div>
  );
}
