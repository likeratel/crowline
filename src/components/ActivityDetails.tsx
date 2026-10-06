import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { accountDisplayName } from "../accountNames";
import { activityDetailsCopy } from "../activityDetailsCopy";
import { bridge, errorMessage } from "../bridge";
import { PROVIDER_NAMES, type Activity, type Snapshot } from "../domain";
import { isLongRunning } from "../activityView";
import { useI18n } from "../i18n";
import { monitorCopy } from "../monitorCopy";
import { queryStateForTarget } from "../queryHealth";
import "../styles/activity-details.css";

type ActivityDetailsProps = {
  activity: Activity;
  snapshot?: Snapshot;
  settingsLocked?: boolean;
  onClose: () => void;
  onError: (message: string) => void;
  onHide: (activity: Activity) => Promise<void>;
};

type DetailField = {
  label: string;
  value: string;
};

function formatTimestamp(
  value: string,
  locale: ReturnType<typeof useI18n>["locale"],
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function detailFields(
  activity: Activity,
  snapshot: Snapshot | undefined,
  locale: ReturnType<typeof useI18n>["locale"],
  unknown: string,
  status: string,
): DetailField[] {
  const copy = (key: Parameters<typeof activityDetailsCopy>[1]) =>
    activityDetailsCopy(locale, key);
  const account = snapshot?.settings.accounts.find(
    (item) => item.id === activity.connectionId,
  );
  const target = snapshot?.settings.targets.find(
    (item) =>
      item.provider === activity.provider &&
      item.connectionId === activity.connectionId &&
      item.id === activity.targetId,
  );
  const health =
    snapshot && target ? queryStateForTarget(snapshot, target) : null;
  const fields = [
    { label: copy("provider"), value: PROVIDER_NAMES[activity.provider] },
    { label: copy("project"), value: activity.project || unknown },
    { label: copy("branch"), value: activity.branch?.trim() || unknown },
    {
      label: copy("workflow"),
      value: activity.workflowName?.trim() || unknown,
    },
    {
      label: copy("account"),
      value:
        account && snapshot
          ? accountDisplayName(account, snapshot.settings, snapshot.connections)
          : unknown,
    },
    { label: copy("actor"), value: activity.actor?.trim() || unknown },
    { label: copy("status"), value: status },
    {
      label: copy("startedAt"),
      value: formatTimestamp(activity.startedAt, locale),
    },
    {
      label: copy("finishedAt"),
      value: activity.finishedAt
        ? formatTimestamp(activity.finishedAt, locale)
        : unknown,
    },
    {
      label: copy("updatedAt"),
      value: formatTimestamp(activity.updatedAt, locale),
    },
  ];
  if (!health) return fields;
  return [
    ...fields,
    {
      label: monitorCopy(locale, "health"),
      value: monitorCopy(locale, health.state),
    },
    {
      label: monitorCopy(locale, "lastAttempt"),
      value: health.lastAttemptAt
        ? formatTimestamp(health.lastAttemptAt, locale)
        : monitorCopy(locale, "never"),
    },
    {
      label: monitorCopy(locale, "lastSuccess"),
      value: health.lastSuccessfulAt
        ? formatTimestamp(health.lastSuccessfulAt, locale)
        : monitorCopy(locale, "noSuccess"),
    },
  ];
}

export function ActivityDetails({
  activity,
  snapshot,
  settingsLocked = false,
  onClose,
  onError,
  onHide,
}: ActivityDetailsProps) {
  const { locale, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const copy = (key: Parameters<typeof activityDetailsCopy>[1]) =>
    activityDetailsCopy(locale, key);
  const status = activity.rawStatus
    ? `${t(`status.${activity.status}`)} · ${activity.rawStatus}`
    : t(`status.${activity.status}`);
  const fields = detailFields(
    activity,
    snapshot,
    locale,
    copy("unavailable"),
    status,
  );
  const account = snapshot?.settings.accounts.find(
    (item) => item.id === activity.connectionId,
  );
  const accountName =
    account && snapshot
      ? accountDisplayName(account, snapshot.settings, snapshot.connections)
      : copy("unavailable");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const openOriginal = async () => {
    try {
      await bridge.open(activity.url);
      setOpenError(null);
    } catch (cause) {
      const message = errorMessage(cause);
      setOpenError(message);
      onError(message);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="activity-details-dialog"
      aria-labelledby="activity-details-title"
      onClose={onClose}
    >
      <div className="activity-details-content">
        <header className="activity-details-header">
          <div className="activity-details-heading">
            <h2 id="activity-details-title">{activity.title}</h2>
            <p>
              {copy("heading")} · {accountName}
            </p>
            {isLongRunning(activity) && (
              <p className="activity-details-observation">
                {monitorCopy(locale, "longRunning")}
              </p>
            )}
          </div>
          <button
            className="icon-button"
            aria-label={copy("close")}
            title={copy("close")}
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {openError && (
          <p className="activity-details-error" role="alert">
            {openError}
          </p>
        )}
        <dl className="activity-details-grid">
          {fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        <footer className="activity-details-footer">
          {activity.targetId && !settingsLocked && (
            <button
              className="button activity-details-hide"
              onClick={() => {
                dialog.current?.close();
                void onHide(activity);
              }}
            >
              {copy("hide")}
            </button>
          )}
          <button className="button" onClick={() => void openOriginal()}>
            {copy("openOriginal")}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
          <button className="button" onClick={() => dialog.current?.close()}>
            {copy("close")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
