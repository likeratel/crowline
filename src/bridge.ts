import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { resolveLocale, type LanguagePreference } from "./i18n";
import { copy } from "./featureCopy";
import {
  targetKey,
  accountSchema,
  connectionSchema,
  discoverySchema,
  loginSchema,
  settingsSchema,
  snapshotSchema,
  type Provider,
  type Settings,
  type Snapshot,
  type TargetHistory,
} from "./domain";
import { DEMO_TARGETS, demoSnapshot } from "./demo";
import {
  applySettingsChange,
  settingsChangeSchema,
  type SettingsChange,
} from "./settingsChanges";

export const isPreview = !isTauri();
let preview = demoSnapshot();
let language: LanguagePreference = "system";
const rememberLanguage = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const candidate = record.settings ?? record;
    const settings = settingsSchema.safeParse(candidate);
    if (settings.success) language = settings.data.preferences.language;
  }
  return value;
};
const message = (key: Parameters<typeof copy>[1]) =>
  copy(resolveLocale(language), key);
const call = async <T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> => rememberLanguage(schema.parse(await invoke(command, args)));
export const bridge = {
  change: async (change: SettingsChange) => {
    const validated = settingsChangeSchema.parse(change);
    if (!isPreview)
      return call("change_settings", settingsSchema, { change: validated });
    const settings = settingsSchema.parse(
      applySettingsChange(preview.settings, validated),
    );
    preview = { ...preview, settings };
    return rememberLanguage(settings);
  },
  snapshot: async () =>
    isPreview
      ? rememberLanguage(preview)
      : call("get_snapshot", snapshotSchema),
  refresh: async () => (isPreview ? preview : call("refresh", snapshotSchema)),
  save: async (settings: Settings) => {
    const validated = settingsSchema.parse(settings);
    if (!isPreview)
      return call("save_settings", settingsSchema, { settings: validated });
    preview = { ...preview, settings: validated };
    return rememberLanguage(validated);
  },
  loadMore: async (page: TargetHistory) => {
    if (!page.nextCursor) throw new Error(message("noMorePages"));
    if (isPreview) return preview;
    return call("load_more", snapshotSchema, {
      connectionId: page.connectionId,
      targetId: page.targetId,
      cursor: page.nextCursor,
      generation: page.generation,
    });
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
        account: message("previewAccount"),
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
        message: message("desktopOnly"),
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
      id: ["github", "vercel", "aws"].includes(provider)
        ? `${provider}:demo-${Date.now()}`
        : `${provider}:local`,
      provider,
      label,
      profile,
      mode: ["github", "vercel"].includes(provider) ? "isolated" : "local",
    });
    preview = {
      ...preview,
      settings: {
        ...preview.settings,
        accounts: [...preview.settings.accounts, account],
        panel: {
          ...preview.settings.panel,
          providers: Array.from(
            new Set([...preview.settings.panel.providers, provider]),
          ),
        },
      },
    };
    return account;
  },
  removeConnection: async (connectionId: string) => {
    if (!isPreview)
      return call("remove_connection", settingsSchema, { connectionId });
    const targets = preview.settings.targets.filter(
      (item) => item.connectionId !== connectionId,
    );
    const keys = new Set(targets.map(targetKey));
    const settings = {
      ...preview.settings,
      panel: {
        ...preview.settings.panel,
        pinnedTargets: preview.settings.panel.pinnedTargets.filter((key) =>
          keys.has(key),
        ),
      },
      preferences: {
        ...preview.settings.preferences,
        accountAliases: Object.fromEntries(
          Object.entries(preview.settings.preferences.accountAliases).filter(
            ([id]) => id !== connectionId,
          ),
        ),
        notifications: {
          ...preview.settings.preferences.notifications,
          rules: preview.settings.preferences.notifications.rules.filter(
            (rule) => keys.has(rule.targetKey),
          ),
        },
      },
      accounts: preview.settings.accounts.filter(
        (item) => item.id !== connectionId,
      ),
      targets,
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
      if (parsed.success) handler(rememberLanguage(parsed.data));
      else onError(message("invalidPayload"));
    });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return message("invalidPayload");
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : message("requestFailed");
}
