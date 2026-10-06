import { isActive, type Activity } from "./domain";

export const ACTIVITY_FILTERS = [
  "all",
  "active",
  "failed",
  "unresolved",
  "completed",
] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export function matchesActivityFilter(
  activity: Activity,
  filter: ActivityFilter,
) {
  switch (filter) {
    case "active":
      return isActive(activity);
    case "failed":
      return activity.status === "failed";
    case "unresolved":
      return activity.status === "unknown";
    case "completed":
      return !isActive(activity) && activity.status !== "unknown";
    default:
      return true;
  }
}

export const isLongRunning = (activity: Activity, now = Date.now()) =>
  isActive(activity) &&
  now - Date.parse(activity.startedAt) >= 24 * 60 * 60 * 1000;
