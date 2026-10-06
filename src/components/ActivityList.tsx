import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  GitBranch,
  LoaderCircle,
  Pause,
  X,
} from "lucide-react";
import { bridge, errorMessage } from "../bridge";
import { isActive, PROVIDER_NAMES, type Activity } from "../domain";
import { activityCopy } from "../activityCopy";
import { accountDisplayName } from "../accountNames";
import { activityDetailsCopy } from "../activityDetailsCopy";
import { isLongRunning } from "../activityView";
import { monitorCopy } from "../monitorCopy";
import type { Snapshot } from "../domain";
import { ProviderIcon } from "./ProviderIcon";
import { formatDuration, formatRelativeTime, useI18n } from "../i18n";
const ACTIVITY_PAGE_SIZE = 50;

const detailsIdentity = (activity: Activity) =>
  JSON.stringify([
    activity.provider,
    activity.connectionId,
    activity.targetId ?? "",
    activity.id,
  ]);

function StatusIcon({ status }: { status: Activity["status"] }) {
  const Icon =
    status === "running"
      ? LoaderCircle
      : status === "success"
        ? Check
        : status === "failed"
          ? X
          : status === "waiting"
            ? Pause
            : Circle;
  return (
    <Icon
      size={14}
      aria-hidden="true"
      className={status === "running" ? "spin" : ""}
    />
  );
}
export function ActivityList({
  title,
  activities,
  empty,
  onError,
  onHide,
  compactEmpty = false,
  snapshot,
  settingsLocked = false,
  onShowDetails,
}: {
  title: string;
  activities: Activity[];
  empty: string;
  compactEmpty?: boolean;
  onError: (error: string) => void;
  onHide: (activity: Activity) => Promise<void>;
  snapshot?: Snapshot;
  settingsLocked?: boolean;
  onShowDetails: (activity: Activity, trigger: HTMLButtonElement) => void;
}) {
  const { locale, t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE);
  const shown = activities.slice(0, visibleCount);
  return (
    <section
      className={`activity-section ${compactEmpty && activities.length === 0 ? "compact-empty" : ""}`}
      aria-label={title}
    >
      <div className="section-heading">
        <h2>{title}</h2>
        <span className="count">{activities.length}</span>
        <span className="section-line" />
      </div>
      {activities.length === 0 ? (
        <div className="empty-section">
          <Check size={19} />
          <p>{empty}</p>
        </div>
      ) : (
        <div className="activity-list">
          {shown.map((activity) => {
            const workflow = activity.workflowName?.trim();
            const showWorkflow = Boolean(
              workflow && workflow !== activity.title.trim(),
            );
            const account = snapshot?.settings.accounts.find(
              (item) => item.id === activity.connectionId,
            );
            const accountName =
              account && snapshot
                ? accountDisplayName(
                    account,
                    snapshot.settings,
                    snapshot.connections,
                  )
                : t("common.unknownActor");
            const actor = activity.actor?.trim() || t("common.unknownActor");
            const showActor = actor !== accountName;
            const identity = detailsIdentity(activity);
            return (
              <div className="activity-entry" key={identity}>
                <button
                  className="activity-row"
                  onClick={() =>
                    void bridge
                      .open(activity.url)
                      .catch((error: unknown) => onError(errorMessage(error)))
                  }
                >
                  <div
                    className={`service-icon ${activity.provider}`}
                    title={PROVIDER_NAMES[activity.provider]}
                  >
                    <ProviderIcon provider={activity.provider} size={21} />
                  </div>
                  <div className="activity-details">
                    <div className="activity-title">
                      {showWorkflow && (
                        <span className="activity-workflow">{workflow}</span>
                      )}
                      <span className="activity-title-text">
                        {activity.title}
                      </span>
                      <ArrowUpRight className="row-arrow" size={14} />
                    </div>
                    <div className="activity-meta">
                      <span>{activity.project}</span>
                      {activity.branch && (
                        <>
                          <span className="dot-separator">·</span>
                          <span className="branch">
                            <GitBranch size={12} />
                            {activity.branch}
                          </span>
                        </>
                      )}
                      {showActor && (
                        <>
                          <span className="dot-separator">·</span>
                          <span>{actor}</span>
                        </>
                      )}
                      <span className="dot-separator">·</span>
                      <span>{accountName}</span>
                    </div>
                  </div>
                  <div className="activity-result">
                    <span
                      className={`status ${activity.status}`}
                      title={activity.rawStatus}
                    >
                      <StatusIcon status={activity.status} />
                      {t(`status.${activity.status}`)}
                    </span>
                    <span className="activity-time">
                      {isActive(activity)
                        ? formatDuration(
                            activity.startedAt,
                            activity.finishedAt ?? Date.now(),
                            locale,
                          )
                        : activity.finishedAt
                          ? formatRelativeTime(activity.finishedAt, locale)
                          : t("activity.updated", {
                              time: formatRelativeTime(
                                activity.updatedAt,
                                locale,
                              ),
                            })}
                    </span>
                    {isLongRunning(activity) && (
                      <span className="activity-observation">
                        {monitorCopy(locale, "longRunning")}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  className="activity-show-details"
                  data-activity-details-key={identity}
                  aria-label={`${activityDetailsCopy(locale, "details")}: ${activity.title}`}
                  onClick={(event) =>
                    onShowDetails(activity, event.currentTarget)
                  }
                >
                  {activityDetailsCopy(locale, "details")}
                </button>
                {activity.targetId && !settingsLocked && (
                  <button
                    className="activity-dismiss"
                    aria-label={`${activityCopy(locale, "hide")}: ${activity.title}`}
                    title={activityCopy(locale, "hide")}
                    onClick={() => void onHide(activity)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {activities.length > visibleCount && (
        <div className="activity-pagination">
          <span>
            {shown.length} / {activities.length}
          </span>
          <button
            className="button"
            onClick={() =>
              setVisibleCount((count) => count + ACTIVITY_PAGE_SIZE)
            }
          >
            {activityCopy(locale, "more")}
          </button>
        </div>
      )}
    </section>
  );
}
