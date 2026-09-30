import { preferencesSchema, panelSettingsSchema } from "./domain";
import type { Account, Activity, Provider, Snapshot, Target } from "./domain";

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: "github:local",
    provider: "github",
    label: "GitHub CLI",
    mode: "local",
  },
  {
    id: "vercel:local",
    provider: "vercel",
    label: "Vercel CLI",
    mode: "local",
  },
  {
    id: "aws:development",
    provider: "aws",
    label: "Development",
    mode: "local",
    profile: "development",
  },
];

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
export const DEMO_TARGETS: Target[] = [
  {
    id: "github:orbit/web",
    connectionId: "github:local",
    provider: "github",
    name: "orbit/web",
    description: "웹 애플리케이션",
    metadata: { repo: "orbit/web" },
  },
  {
    id: "vercel:orbit-web",
    connectionId: "vercel:local",
    provider: "vercel",
    name: "orbit-web",
    description: "Orbit 팀",
    metadata: { projectId: "prj_demo", teamId: "team_demo" },
  },
  {
    id: "aws:api",
    connectionId: "aws:development",
    provider: "aws",
    name: "orbit-api",
    description: "development · ap-northeast-2",
    metadata: { profile: "development", region: "ap-northeast-2" },
  },
];
function activity(
  id: string,
  provider: Provider,
  title: string,
  status: Activity["status"],
  minutes: number,
  ownership: Activity["ownership"] = "mine",
): Activity {
  return {
    id,
    provider,
    targetId: DEMO_TARGETS.find((target) => target.provider === provider)?.id,
    connectionId: provider === "aws" ? "aws:development" : `${provider}:local`,
    title,
    status,
    ownership,
    kind: provider === "github" ? "workflow" : "deployment",
    project:
      provider === "github"
        ? "orbit/web"
        : provider === "vercel"
          ? "orbit-web"
          : "orbit-api",
    branch: "main",
    actor: ownership === "mine" ? "alex" : ownership === "other" ? "sam" : null,
    rawStatus: status.toUpperCase(),
    url:
      provider === "github"
        ? "https://github.com"
        : provider === "vercel"
          ? "https://vercel.com"
          : "https://console.aws.amazon.com",
    startedAt: ago(minutes),
    updatedAt: ago(Math.max(minutes - 2, 0)),
    finishedAt: ["success", "failed", "canceled"].includes(status)
      ? ago(Math.max(minutes - 2, 0))
      : null,
  };
}
export function demoSnapshot(): Snapshot {
  return {
    settings: {
      scope: "mine",
      historyHours: 24,
      panel: panelSettingsSchema.parse({}),
      preferences: preferencesSchema.parse({}),
      targets: DEMO_TARGETS,
      accounts: DEMO_ACCOUNTS,
    },
    connections: [
      {
        connectionId: "github:local",
        provider: "github",
        status: "connected",
        account: "alex",
      },
      {
        connectionId: "vercel:local",
        provider: "vercel",
        status: "connected",
        account: "alex / Orbit",
      },
      {
        connectionId: "aws:development",
        provider: "aws",
        status: "connected",
        account: "development",
      },
    ],
    activities: [
      activity("g1", "github", "Deploy production", "running", 4),
      activity("v1", "vercel", "Improve workspace navigation", "running", 2),
      activity(
        "a1",
        "aws",
        "orbit-api · 스택 업데이트",
        "running",
        7,
        "unknown",
      ),
      activity("g2", "github", "Test & typecheck", "success", 16),
      activity(
        "v2",
        "vercel",
        "Fix notification preferences",
        "success",
        32,
        "other",
      ),
      activity("g3", "github", "Preview deployment", "failed", 68),
      activity("v3", "vercel", "Update account settings", "success", 110),
    ],
    issues: [],
    refreshing: false,
    history: [],
    pendingTargets: [],
    lastUpdatedAt: ago(0),
  };
}
