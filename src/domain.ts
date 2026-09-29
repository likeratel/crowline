import { z } from "zod";

export const providerSchema = z.enum(["github", "vercel", "aws"]);
export const statusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "success",
  "failed",
  "canceled",
  "skipped",
  "unknown",
]);
const optionalText = z.string().nullish();
const date = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "유효하지 않은 날짜");
export const accountSchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  label: z.string().min(1),
  mode: z.enum(["local", "isolated"]),
  profile: optionalText,
});
export const targetSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  provider: providerSchema,
  name: z.string(),
  description: optionalText,
  metadata: z.record(z.string(), z.string()),
});
export const settingsSchema = z.object({
  scope: z.enum(["mine", "all"]),
  historyHours: z.union([z.literal(24), z.literal(168)]),
  targets: z.array(targetSchema),
  accounts: z.array(accountSchema),
});
export const connectionSchema = z.object({
  connectionId: z.string(),
  provider: providerSchema,
  status: z.enum([
    "connected",
    "signed-out",
    "missing-cli",
    "error",
    "unconfigured",
  ]),
  account: optionalText,
  message: optionalText,
  cliVersion: optionalText,
});
export const activitySchema = z.object({
  id: z.string(),
  connectionId: z.string().min(1),
  targetId: z.string().optional(),
  provider: providerSchema,
  kind: z.string(),
  title: z.string(),
  project: z.string(),
  branch: optionalText,
  url: z.string(),
  status: statusSchema,
  rawStatus: z.string(),
  actor: optionalText,
  ownership: z.enum(["mine", "other", "unknown"]),
  startedAt: date,
  finishedAt: date.nullish(),
  updatedAt: date,
});
export const issueSchema = z.object({
  connectionId: optionalText,
  provider: providerSchema,
  message: z.string(),
  targetId: optionalText,
});
export const snapshotSchema = z.object({
  settings: settingsSchema,
  connections: z.array(connectionSchema),
  activities: z.array(activitySchema),
  issues: z.array(issueSchema),
  refreshing: z.boolean(),
  lastUpdatedAt: date.nullish(),
});
export const discoverySchema = z.object({
  connection: connectionSchema,
  targets: z.array(targetSchema),
  awsProfiles: z.array(z.string()),
  issues: z.array(issueSchema),
});
export const loginSchema = z.object({
  connectionId: z.string(),
  provider: providerSchema,
  state: z.enum(["waiting", "complete", "error"]),
  message: z.string(),
  url: optionalText,
  code: optionalText,
});
export type Provider = z.infer<typeof providerSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Target = z.infer<typeof targetSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Discovery = z.infer<typeof discoverySchema>;
export type LoginStatus = z.infer<typeof loginSchema>;
export const PROVIDERS: readonly Provider[] = ["github", "vercel", "aws"];
export const PROVIDER_NAMES: Record<Provider, string> = {
  github: "GitHub Actions",
  vercel: "Vercel",
  aws: "AWS",
};
export const STATUS_LABELS: Record<Activity["status"], string> = {
  queued: "대기 중",
  running: "실행 중",
  waiting: "승인 대기",
  success: "성공",
  failed: "실패",
  canceled: "취소",
  skipped: "건너뜀",
  unknown: "상태 미확인",
};
export const isActive = (activity: Activity) =>
  ["queued", "running", "waiting"].includes(activity.status);

export function visibleActivities(
  snapshot: Snapshot,
  provider: Provider | "all",
  search: string,
  now = Date.now(),
  connectionId = "all",
) {
  const query = search.trim().toLocaleLowerCase();
  const cutoff = now - snapshot.settings.historyHours * 60 * 60 * 1000;
  const candidates = snapshot.activities.filter(
    (activity) =>
      (connectionId === "all" || activity.connectionId === connectionId) &&
      (provider === "all" || activity.provider === provider),
  );
  const reconciled = candidates.reduce<Record<string, Activity>>(
    (previous, activity) => {
      const key = `${activity.provider}:${activity.id}`;
      const existing = previous[key];
      if (!existing) return { ...previous, [key]: activity };
      const delta =
        Date.parse(activity.updatedAt) - Date.parse(existing.updatedAt);
      const terminal = (item: Activity) =>
        !isActive(item) && item.status !== "unknown";
      const newer =
        delta > 0 || (delta === 0 && terminal(activity) && !terminal(existing));
      const sameState =
        delta === 0 && terminal(activity) === terminal(existing);
      const latest =
        newer || (sameState && activity.ownership === "mine")
          ? activity
          : existing;
      const ownership =
        existing.ownership === "mine" || activity.ownership === "mine"
          ? "mine"
          : latest.ownership;
      return { ...previous, [key]: { ...latest, ownership } };
    },
    {},
  );
  const filtered = Object.values(reconciled).filter(
    (activity) =>
      (snapshot.settings.scope === "all" || activity.ownership === "mine") &&
      (isActive(activity) ||
        activity.status === "unknown" ||
        Date.parse(activity.finishedAt ?? activity.updatedAt) >= cutoff) &&
      (!query ||
        [
          activity.title,
          activity.project,
          activity.branch,
          activity.actor,
        ].some((part) => part?.toLocaleLowerCase().includes(query))),
  );
  return filtered.sort(
    (a, b) =>
      Date.parse(b.finishedAt ?? b.updatedAt) -
      Date.parse(a.finishedAt ?? a.updatedAt),
  );
}

export const targetKey = (target: Target) =>
  `${target.provider}:${target.connectionId}:${target.id}`;

export function timeAgo(value: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 60) return "방금";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

export function duration(activity: Activity, now = Date.now()): string {
  const end = activity.finishedAt
    ? Date.parse(activity.finishedAt)
    : isActive(activity)
      ? now
      : null;
  if (end === null) return "—";
  const seconds = Math.max(
    0,
    Math.floor((end - Date.parse(activity.startedAt)) / 1000),
  );
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}
