import { z } from "zod";

export const PROVIDERS = [
  "github",
  "vercel",
  "aws",
  "github-deployments",
  "railway",
  "netlify",
  "render",
  "cloudflare-pages",
  "cloudflare-workers",
  "heroku",
  "fly",
  "gitlab",
  "digitalocean",
  "gcloud",
  "azure",
  "eas",
  "firebase",
  "supabase",
  "fastlane",
] as const;
export const providerSchema = z.enum(PROVIDERS);
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
export const panelSettingsSchema = z.object({
  providers: z
    .array(providerSchema)
    .max(PROVIDERS.length)
    .default(["github", "vercel", "aws"]),
  hiddenTargets: z.array(z.string().min(1).max(1600)).max(500).default([]),
  showActive: z.boolean().default(true),
  showCompleted: z.boolean().default(true),
  rowLimit: z.number().int().min(1).max(10).default(5),
});
export type PanelSettings = z.infer<typeof panelSettingsSchema>;

export const settingsSchema = z.object({
  scope: z.enum(["mine", "all"]),
  historyHours: z.union([z.literal(24), z.literal(168)]),
  targets: z.array(targetSchema),
  accounts: z.array(accountSchema),
  panel: panelSettingsSchema.prefault({}),
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
export const targetHistorySchema = z.object({
  connectionId: z.string(),
  targetId: z.string(),
  provider: providerSchema,
  nextCursor: z.string().nullish(),
  checkedAt: date,
  generation: z.number().int().nonnegative(),
});
export type TargetHistory = z.infer<typeof targetHistorySchema>;
export const snapshotSchema = z.object({
  settings: settingsSchema,
  connections: z.array(connectionSchema),
  activities: z.array(activitySchema),
  issues: z.array(issueSchema),
  refreshing: z.boolean(),
  history: z.array(targetHistorySchema).default([]),
  pendingTargets: z.array(z.string()).default([]),
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
export const PROVIDER_NAMES: Record<Provider, string> = {
  github: "GitHub Actions",
  vercel: "Vercel",
  aws: "AWS",
  "github-deployments": "GitHub Deployments",
  railway: "Railway",
  netlify: "Netlify",
  render: "Render",
  "cloudflare-pages": "Cloudflare Pages",
  "cloudflare-workers": "Cloudflare Workers",
  heroku: "Heroku",
  fly: "Fly.io",
  gitlab: "GitLab",
  digitalocean: "DigitalOcean",
  gcloud: "Google Cloud",
  azure: "Azure App Service",
  eas: "Expo / EAS",
  firebase: "Firebase",
  supabase: "Supabase",
  fastlane: "fastlane",
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
  ["queued", "running", "waiting"].includes(activity.status) &&
  !(
    activity.provider === "vercel" &&
    activity.rawStatus.toUpperCase() === "BLOCKED"
  );

const MAX_ACTIVE_AGE_MS = 24 * 60 * 60 * 1000;
export const isVisibleActivity = (activity: Activity, now = Date.now()) =>
  !(
    activity.provider === "vercel" &&
    activity.rawStatus.toUpperCase() === "BLOCKED"
  ) &&
  (!isActive(activity) ||
    Date.parse(activity.startedAt) >= now - MAX_ACTIVE_AGE_MS);

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
      isVisibleActivity(activity, now) &&
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

export function panelActivities(snapshot: Snapshot, now = Date.now()) {
  const { panel } = snapshot.settings;
  const activities = snapshot.activities.filter(
    (activity) =>
      panel.providers.includes(activity.provider) &&
      snapshot.settings.targets.some(
        (target) =>
          target.provider === activity.provider &&
          target.connectionId === activity.connectionId &&
          target.id === activity.targetId &&
          !panel.hiddenTargets.includes(targetKey(target)),
      ),
  );
  return visibleActivities({ ...snapshot, activities }, "all", "", now);
}

export function latestCompleted(activities: Activity[]): Activity[] {
  return Object.values(
    activities
      .filter((item) => !isActive(item) && item.status !== "unknown")
      .reduce<Record<string, Activity>>((groups, item) => {
        // Account and stable target IDs prevent same-name projects from merging.
        const key = JSON.stringify([
          item.provider,
          item.connectionId,
          item.targetId,
          item.kind,
          item.branch,
          item.provider === "github" ? item.title : "",
        ]);
        const previous = groups[key];
        return !previous ||
          Date.parse(item.finishedAt ?? item.updatedAt) >
            Date.parse(previous.finishedAt ?? previous.updatedAt)
          ? { ...groups, [key]: item }
          : groups;
      }, {}),
  );
}
