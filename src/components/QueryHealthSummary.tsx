import {
  CircleCheck,
  CircleHelp,
  Clock3,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { Snapshot, Target } from "../domain";
import { summarizeQueryHealth } from "../queryHealth";
import { monitorCopy } from "../monitorCopy";
import { formatRelativeTime, useI18n } from "../i18n";
import "../styles/monitoring.css";

export function QueryHealthSummary({
  snapshot,
  targets,
  compact = false,
}: {
  snapshot: Snapshot;
  targets: readonly Target[];
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const health = summarizeQueryHealth(snapshot, targets);
  if (!targets.length) return null;
  const Icon =
    health.state === "success"
      ? CircleCheck
      : health.state === "checking"
        ? LoaderCircle
        : health.state === "unknown"
          ? CircleHelp
          : health.state === "stale"
            ? Clock3
            : TriangleAlert;
  return (
    <div
      className={`query-summary ${compact ? "compact" : ""}`}
      aria-label={monitorCopy(locale, "health")}
    >
      <span className={`query-state ${health.state}`} role="status">
        <Icon
          size={14}
          aria-hidden="true"
          className={health.state === "checking" ? "spin" : undefined}
        />
        {monitorCopy(locale, health.state)}
      </span>
      <span className="query-coverage">
        {monitorCopy(locale, "coverage", {
          fresh: health.succeeded,
          total: health.total,
        })}
      </span>
      {!compact && (
        <span className="query-timestamp">
          {health.lastSuccessfulAt
            ? monitorCopy(locale, "oldest", {
                time: formatRelativeTime(health.lastSuccessfulAt, locale),
              })
            : monitorCopy(locale, "never")}
        </span>
      )}
    </div>
  );
}
