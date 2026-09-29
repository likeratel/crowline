import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import {
  accountSchema,
  connectionSchema,
  discoverySchema,
  loginSchema,
  settingsSchema,
  snapshotSchema,
  type Provider,
  type Settings,
  type Snapshot,
} from "./domain";
import { DEMO_TARGETS, demoSnapshot } from "./demo";

export const isPreview = !isTauri();
let preview = demoSnapshot();
const call = async <T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> => schema.parse(await invoke(command, args));
export const bridge = {
  snapshot: async () =>
    isPreview ? preview : call("get_snapshot", snapshotSchema),
  refresh: async () => (isPreview ? preview : call("refresh", snapshotSchema)),
  save: async (settings: Settings) => {
    const validated = settingsSchema.parse(settings);
    if (!isPreview)
      return call("save_settings", settingsSchema, { settings: validated });
    preview = { ...preview, settings: validated };
    return validated;
  },
  discover: async (
    provider: Provider,
    connectionId: string | null,
    profile: string | null = null,
    region: string | null = null,
  ) => {
    if (!isPreview)
      return call("discover", discoverySchema, {
        provider,
        connectionId,
        profile,
        region,
      });
    return discoverySchema.parse({
      connection: connectionSchema.parse({
        connectionId: connectionId ?? "aws:local",
        provider,
        status: "connected",
        account: "alex (미리보기)",
      }),
      targets: connectionId
        ? DEMO_TARGETS.filter((target) => target.provider === provider).map(
            (target) => ({ ...target, connectionId }),
          )
        : [],
      awsProfiles: ["development"],
      issues: [],
    });
  },
  login: async (
    provider: Provider,
    connectionId: string,
    profile: string | null,
  ) => {
    if (isPreview)
      return loginSchema.parse({
        connectionId,
        provider,
        state: "error",
        message: "로그인은 데스크톱 앱에서 사용할 수 있습니다.",
      });
    return call("begin_login", loginSchema, {
      provider,
      connectionId,
      profile,
    });
  },
  loginStatus: (provider: Provider, connectionId: string) =>
    call("get_login_status", loginSchema, { provider, connectionId }),
  createConnection: async (
    provider: Provider,
    label: string,
    profile: string | null,
  ) => {
    if (!isPreview)
      return call("create_connection", accountSchema, {
        provider,
        label,
        profile,
      });
    const account = accountSchema.parse({
      id: `${provider}:demo-${Date.now()}`,
      provider,
      label,
      profile,
      mode: provider === "aws" ? "local" : "isolated",
    });
    preview = {
      ...preview,
      settings: {
        ...preview.settings,
        accounts: [...preview.settings.accounts, account],
      },
    };
    return account;
  },
  removeConnection: async (connectionId: string) => {
    if (!isPreview)
      return call("remove_connection", settingsSchema, { connectionId });
    const settings = {
      ...preview.settings,
      accounts: preview.settings.accounts.filter(
        (item) => item.id !== connectionId,
      ),
      targets: preview.settings.targets.filter(
        (item) => item.connectionId !== connectionId,
      ),
    };
    preview = {
      ...preview,
      settings,
      activities: preview.activities.filter(
        (item) => item.connectionId !== connectionId,
      ),
    };
    return settings;
  },
  open: async (url: string) => {
    if (isPreview) return;
    await invoke("open_external", { url });
  },
  dashboard: async () => {
    if (isPreview) {
      window.location.search = "?view=dashboard";
      return;
    }
    await invoke("open_dashboard");
  },
  hide: async () => {
    if (!isPreview) await invoke("hide_panel");
  },
  subscribe: async (
    handler: (snapshot: Snapshot) => void,
    onError: (message: string) => void,
  ) => {
    if (isPreview) return () => {};
    return listen("snapshot-updated", (event) => {
      const parsed = snapshotSchema.safeParse(event.payload);
      if (parsed.success) handler(parsed.data);
      else
        onError("조회 결과 형식을 확인할 수 없습니다. 앱을 업데이트해 주세요.");
    });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return "조회 결과 형식을 확인할 수 없습니다. 앱을 업데이트해 주세요.";
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "작업을 완료하지 못했습니다. 다시 시도해 주세요.";
}
