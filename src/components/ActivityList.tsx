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
import {
  duration,
  isActive,
  PROVIDER_NAMES,
  STATUS_LABELS,
  timeAgo,
  type Activity,
} from "../domain";
import { ProviderIcon } from "./ProviderIcon";
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
}: {
  title: string;
  activities: Activity[];
  empty: string;
  onError: (error: string) => void;
}) {
  return (
    <section className="activity-section" aria-label={title}>
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
                  <span>{activity.actor ?? "실행자 미확인"}</span>
                </div>
              </div>
              <div className="activity-result">
                <span
                  className={`status ${activity.status}`}
                  title={activity.rawStatus}
                >
                  <StatusIcon status={activity.status} />
                  {STATUS_LABELS[activity.status]}
                </span>
                <span className="activity-time">
                  {isActive(activity)
                    ? duration(activity)
                    : timeAgo(activity.finishedAt ?? activity.updatedAt)}
                  {!isActive(activity) && !activity.finishedAt && " 갱신"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
