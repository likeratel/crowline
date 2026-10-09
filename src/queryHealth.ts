import { targetKey, type Snapshot, type Target } from "./domain";

export type QueryState =
  "unknown" | "checking" | "success" | "partial" | "error" | "stale";

export type TargetQueryState = {
  state: QueryState;
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
};

// Allow one delayed polling cycle before labelling a result stale.
export const queryStaleAfterMs = (snapshot: Snapshot) =>
  Math.max(60, snapshot.pollIntervalSeconds * 2) * 1000;

const RESUME_FRESHNESS_MS = 20_000;

export function queryStateForTarget(
  snapshot: Snapshot,
  target: Target,
  now = Date.now(),
): TargetQueryState {
  const health = snapshot.queryHealth.find(
    (item) =>
      item.provider === target.provider &&
      item.connectionId === target.connectionId &&
      item.targetId === target.id,
  );
  const times = {
    lastAttemptAt: health?.lastAttemptAt ?? null,
    lastSuccessfulAt: health?.lastSuccessfulAt ?? null,
  };
  if (
    health?.status === "checking" ||
    snapshot.pendingTargets.includes(targetKey(target))
  )
    return { ...times, state: "checking" };
  const connection = snapshot.connections.find(
    (item) =>
      item.provider === target.provider &&
      item.connectionId === target.connectionId,
  );
  if (connection && connection.status !== "connected")
    return { ...times, state: "error" };
  if (health?.status === "error" || health?.status === "partial")
    return { ...times, state: health.status };
  // Legacy snapshots have no health. New snapshots use the query contract:
  // pagination and notification issues must not invalidate a successful poll.
  const issue =
    !health &&
    snapshot.issues.some(
      (item) =>
        item.provider === target.provider &&
        (!item.connectionId || item.connectionId === target.connectionId) &&
        (!item.targetId || item.targetId === target.id),
    );
  if (issue) return { ...times, state: "partial" };
  if (!times.lastSuccessfulAt) return { ...times, state: "unknown" };
  return {
    ...times,
    state:
      now - Date.parse(times.lastSuccessfulAt) > queryStaleAfterMs(snapshot)
        ? "stale"
        : "success",
  };
}

export function summarizeQueryHealth(
  snapshot: Snapshot,
  targets: readonly Target[],
  now = Date.now(),
) {
  const rows = targets.map((target) =>
    queryStateForTarget(snapshot, target, now),
  );
  const count = (state: QueryState) =>
    rows.filter((row) => row.state === state).length;
  const counts = {
    total: rows.length,
    succeeded: count("success"),
    checking: count("checking"),
    partial: count("partial"),
    failed: count("error"),
    stale: count("stale"),
    unknown: count("unknown"),
  };
  const state: QueryState = counts.failed
    ? "error"
    : counts.partial
      ? "partial"
      : counts.checking
        ? "checking"
        : counts.stale
          ? "stale"
          : counts.unknown || !counts.total
            ? "unknown"
            : "success";
  // An aggregate timestamp exists only if every target has a known success.
  const successfulTimes = rows.flatMap((row) =>
    row.lastSuccessfulAt ? [row.lastSuccessfulAt] : [],
  );
  const lastSuccessfulAt =
    successfulTimes.length === rows.length && rows.length
      ? successfulTimes.reduce((oldest, time) =>
          Date.parse(time) < Date.parse(oldest) ? time : oldest,
        )
      : null;
  return { ...counts, state, lastSuccessfulAt };
}

export function shouldRequestRefresh(
  snapshot: Snapshot,
  now = Date.now(),
  networkRestored = false,
) {
  if (!snapshot.settings.targets.length) return false;
  if (snapshot.refreshing) return networkRestored;
  const health = snapshot.settings.targets.map((target) =>
    queryStateForTarget(snapshot, target, now),
  );
  if (
    health.some(
      (row) =>
        row.state === "success" &&
        row.lastSuccessfulAt &&
        now - Date.parse(row.lastSuccessfulAt) >= RESUME_FRESHNESS_MS,
    )
  ) {
    return true;
  }
  return health.some((health) => {
    return (
      health.state !== "success" &&
      health.state !== "checking" &&
      (networkRestored ||
        !health.lastAttemptAt ||
        now - Date.parse(health.lastAttemptAt) >= queryStaleAfterMs(snapshot))
    );
  });
}
