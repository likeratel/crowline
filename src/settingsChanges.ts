import { z } from "zod";
import {
  languageSchema,
  providerSchema,
  targetSchema,
  notificationRuleSchema,
  targetKey,
  type Settings,
} from "./domain";

const key = z.string().min(1).max(1600);
export const settingsChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scope"), value: z.enum(["mine", "all"]) }),
  z.object({
    kind: z.literal("historyHours"),
    value: z.union([z.literal(24), z.literal(168)]),
  }),
  z.object({ kind: z.literal("language"), value: languageSchema }),
  z.object({ kind: z.literal("automaticUpdates"), value: z.boolean() }),
  z.object({
    kind: z.literal("panel"),
    patch: z.object({
      showActive: z.boolean().optional(),
      showCompleted: z.boolean().optional(),
      rowLimit: z.number().int().min(1).max(10).optional(),
    }),
  }),
  z.object({
    kind: z.literal("panelProvider"),
    provider: providerSchema,
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("panelTarget"),
    targetKey: key,
    visible: z.boolean(),
  }),
  z.object({ kind: z.literal("notificationEnabled"), enabled: z.boolean() }),
  z.object({
    kind: z.literal("notificationRules"),
    rules: z
      .array(notificationRuleSchema.partial().required({ targetKey: true }))
      .min(1)
      .max(500),
  }),
  z.object({
    kind: z.literal("target"),
    target: targetSchema,
    selected: z.boolean(),
  }),
  z.object({
    kind: z.literal("targets"),
    targets: z.array(targetSchema).min(1).max(500),
    selected: z.boolean(),
  }),
  z.object({
    kind: z.literal("accountAlias"),
    connectionId: key,
    alias: z.string().trim().min(1).max(80).nullable(),
  }),
]);
export type SettingsChange = z.infer<typeof settingsChangeSchema>;

export function settingsChangeKey(change: SettingsChange): string {
  switch (change.kind) {
    case "panel":
      return `panel:${Object.keys(change.patch).sort().join("|")}`;
    case "panelProvider":
      return `panelProvider:${change.provider}`;
    case "panelTarget":
      return `panelTarget:${change.targetKey}`;
    case "notificationRules":
      return `notificationRules:${change.rules
        .map((rule) => rule.targetKey)
        .sort()
        .join("|")}`;
    case "target":
      return `target:${targetKey(change.target)}`;
    case "targets":
      return `targets:${change.targets.map(targetKey).sort().join("|")}`;
    case "accountAlias":
      return `accountAlias:${change.connectionId}`;
    default:
      return change.kind;
  }
}

export function affectedSettingsKeys(change: SettingsChange): string[] {
  if (change.kind === "notificationRules")
    return change.rules.map((rule) => `notificationRules:${rule.targetKey}`);
  if (change.kind === "panel")
    return Object.keys(change.patch).map((field) => `panel:${field}`);
  if (change.kind === "targets")
    return change.targets.map((target) => `target:${targetKey(target)}`);
  return [settingsChangeKey(change)];
}

export function applySettingsChange(
  settings: Settings,
  change: SettingsChange,
): Settings {
  const preferences = settings.preferences;
  const panel = settings.panel;
  switch (change.kind) {
    case "scope":
      return { ...settings, scope: change.value };
    case "historyHours":
      return { ...settings, historyHours: change.value };
    case "language":
      return {
        ...settings,
        preferences: { ...preferences, language: change.value },
      };
    case "automaticUpdates":
      return {
        ...settings,
        preferences: {
          ...preferences,
          checkUpdatesAutomatically: change.value,
        },
      };
    case "panel":
      return { ...settings, panel: { ...panel, ...change.patch } };
    case "panelProvider":
      return {
        ...settings,
        panel: {
          ...panel,
          providers: change.enabled
            ? [...new Set([...panel.providers, change.provider])]
            : panel.providers.filter(
                (provider) => provider !== change.provider,
              ),
        },
      };
    case "panelTarget":
      return {
        ...settings,
        panel: {
          ...panel,
          hiddenTargets: change.visible
            ? panel.hiddenTargets.filter((key) => key !== change.targetKey)
            : [...new Set([...panel.hiddenTargets, change.targetKey])],
        },
      };
    case "notificationEnabled":
      return {
        ...settings,
        preferences: {
          ...preferences,
          notifications: {
            ...preferences.notifications,
            enabled: change.enabled,
          },
        },
      };
    case "notificationRules": {
      const keys = new Set(settings.targets.map(targetKey));
      const patches = change.rules.filter((rule) => keys.has(rule.targetKey));
      const rules = patches.reduce((current, patch) => {
        const previous = current.find(
          (rule) => rule.targetKey === patch.targetKey,
        );
        const next = {
          enabled: false,
          scope: "mine" as const,
          statuses: ["success", "failed", "canceled"] as (
            "success" | "failed" | "canceled"
          )[],
          ...previous,
          ...patch,
        };
        return previous
          ? current.map((rule) =>
              rule.targetKey === patch.targetKey ? next : rule,
            )
          : [...current, next];
      }, preferences.notifications.rules);
      return {
        ...settings,
        preferences: {
          ...preferences,
          notifications: { ...preferences.notifications, rules },
        },
      };
    }
    case "accountAlias": {
      const aliases = Object.fromEntries(
        Object.entries(preferences.accountAliases).filter(
          ([id]) => id !== change.connectionId,
        ),
      );
      return {
        ...settings,
        preferences: {
          ...preferences,
          accountAliases:
            change.alias === null
              ? aliases
              : { ...aliases, [change.connectionId]: change.alias },
        },
      };
    }
    case "target": {
      const key = targetKey(change.target);
      const targets = change.selected
        ? [
            ...settings.targets.filter((target) => targetKey(target) !== key),
            change.target,
          ]
        : settings.targets.filter((target) => targetKey(target) !== key);
      const keys = new Set(targets.map(targetKey));
      return {
        ...settings,
        targets,
        panel: {
          ...panel,
          hiddenTargets: panel.hiddenTargets.filter((key) => keys.has(key)),
          pinnedTargets: panel.pinnedTargets.filter((key) => keys.has(key)),
        },
        preferences: {
          ...preferences,
          notifications: {
            ...preferences.notifications,
            rules: preferences.notifications.rules.filter((rule) =>
              keys.has(rule.targetKey),
            ),
          },
        },
      };
    }
    case "targets": {
      const changedKeys = new Set(change.targets.map(targetKey));
      const retained = settings.targets.filter(
        (target) => !changedKeys.has(targetKey(target)),
      );
      const targets = change.selected
        ? [
            ...retained,
            ...change.targets.filter(
              (target, index, all) =>
                all.findIndex(
                  (item) => targetKey(item) === targetKey(target),
                ) === index,
            ),
          ]
        : retained;
      const keys = new Set(targets.map(targetKey));
      return {
        ...settings,
        targets,
        panel: {
          ...panel,
          hiddenTargets: panel.hiddenTargets.filter((key) => keys.has(key)),
          pinnedTargets: panel.pinnedTargets.filter((key) => keys.has(key)),
        },
        preferences: {
          ...preferences,
          notifications: {
            ...preferences.notifications,
            rules: preferences.notifications.rules.filter((rule) =>
              keys.has(rule.targetKey),
            ),
          },
        },
      };
    }
  }
}
