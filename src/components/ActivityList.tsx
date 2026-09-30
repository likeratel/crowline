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
import { ProviderIcon } from "./ProviderIcon";
import { formatDuration, formatRelativeTime, useI18n } from "../i18n";
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
  compactEmpty = false,
}: {
  title: string;
  activities: Activity[];
  empty: string;
  compactEmpty?: boolean;
  onError: (error: string) => void;
}) {
  const { locale, t } = useI18n();
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
          {activities.map((activity) => (
            <button
              key={`${activity.provider}:${activity.id}`}
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
                  {activity.title}
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
                  <span className="dot-separator">·</span>
                  <span>{activity.actor ?? t("common.unknownActor")}</span>
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
                          time: formatRelativeTime(activity.updatedAt, locale),
                        })}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
