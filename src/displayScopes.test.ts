import { describe, expect, it } from "vitest";
import { demoSnapshot } from "./demo";
import {
  effectiveDisplayScope,
  settingsSchema,
  targetKey,
  visibleActivities,
  type Activity,
  type Target,
} from "./domain";
import { applySettingsChange } from "./settingsChanges";

describe("display scope settings", () => {
  it("defaults legacy settings to empty overrides", () => {
    const current = demoSnapshot().settings;
    const { displayScopes: _displayScopes, ...legacy } = current;

    expect(settingsSchema.parse(legacy).displayScopes).toEqual({
      providers: {},
      targets: {},
    });
  });

  it("resolves target, provider, and global scope in that order", () => {
    const settings = demoSnapshot().settings;
    const github = settings.targets[0];
    const overridden = {
      ...settings,
      scope: "mine" as const,
      displayScopes: {
        providers: { github: "all" as const },
        targets: { [targetKey(github)]: "mine" as const },
      },
    };

    expect(
      effectiveDisplayScope(overridden, {
        provider: github.provider,
        connectionId: github.connectionId,
        targetId: github.id,
      }),
    ).toBe("mine");
    expect(effectiveDisplayScope(overridden, { provider: "github" })).toBe(
      "all",
    );
    expect(effectiveDisplayScope(overridden, { provider: "vercel" })).toBe(
      "mine",
    );
  });

  it("keeps an eligible account identity while merging a newer terminal state", () => {
    const base = demoSnapshot();
    const selected = base.settings.targets[0];
    const mine: Activity = {
      ...base.activities[0],
      connectionId: selected.connectionId,
      ownership: "mine",
      actor: "current-user",
      status: "running",
      updatedAt: "2026-09-29T00:00:00Z",
    };
    const other: Activity = {
      ...mine,
      connectionId: "github:work",
      ownership: "other",
      actor: "other-user",
      status: "failed",
      rawStatus: "FAILED",
      finishedAt: "2026-09-29T00:10:00Z",
      updatedAt: "2026-09-29T00:10:00Z",
    };

    const [visible] = visibleActivities(
      { ...base, activities: [mine, other] },
      "all",
      "",
      Date.parse("2026-09-29T00:20:00Z"),
    );

    expect(visible).toMatchObject({
      connectionId: selected.connectionId,
      actor: "current-user",
      ownership: "mine",
      status: "failed",
      rawStatus: "FAILED",
      updatedAt: other.updatedAt,
    });
  });

  it("does not let an all override on one target expose a distinct target", () => {
    const base = demoSnapshot();
    const first = base.settings.targets[0];
    const second: Target = {
      ...first,
      id: "github:orbit/api",
      name: "orbit/api",
    };
    const shared = {
      ...base.activities[0],
      id: "provider-local-id",
      ownership: "other" as const,
    };
    const activities = [
      { ...shared, targetId: first.id },
      { ...shared, targetId: second.id, title: "Private API deployment" },
    ];
    const snapshot = {
      ...base,
      settings: {
        ...base.settings,
        targets: [first, second],
        displayScopes: {
          providers: {},
          targets: { [targetKey(first)]: "all" as const },
        },
      },
      activities,
    };

    expect(
      visibleActivities(snapshot, "all", "").map((item) => item.targetId),
    ).toEqual([first.id]);
  });
});

describe("display scope changes and target defaults", () => {
  it("sets and clears immutable provider and target overrides", () => {
    const settings = demoSnapshot().settings;
    const selected = settings.targets[0];
    const providerChanged = applySettingsChange(settings, {
      kind: "displayProviderScope",
      provider: selected.provider,
      scope: "all",
    });
    const targetChanged = applySettingsChange(providerChanged, {
      kind: "displayTargetScope",
      targetKey: targetKey(selected),
      scope: "mine",
    });
    const cleared = applySettingsChange(targetChanged, {
      kind: "displayTargetScope",
      targetKey: targetKey(selected),
      scope: null,
    });

    expect(providerChanged).not.toBe(settings);
    expect(targetChanged.displayScopes.targets[targetKey(selected)]).toBe(
      "mine",
    );
    expect(cleared.displayScopes.targets).toEqual({});
    expect(cleared.displayScopes.providers.github).toBe("all");
  });

  it("adds enabled mine rules only for newly selected targets", () => {
    const settings = demoSnapshot().settings;
    const existing = settings.targets[0];
    const newTarget: Target = {
      ...existing,
      id: "github:orbit/new",
      name: "orbit/new",
    };
    const withDisabled = {
      ...settings,
      preferences: {
        ...settings.preferences,
        notifications: {
          enabled: false,
          rules: [
            {
              targetKey: targetKey(existing),
              enabled: false,
              scope: "mine" as const,
              statuses: ["failed" as const],
            },
          ],
        },
      },
    };
    const unchanged = applySettingsChange(withDisabled, {
      kind: "target",
      target: existing,
      selected: true,
    });
    const selected = applySettingsChange(unchanged, {
      kind: "target",
      target: newTarget,
      selected: true,
    });

    expect(selected.preferences.notifications.enabled).toBe(false);
    expect(
      selected.preferences.notifications.rules.find(
        (rule) => rule.targetKey === targetKey(existing),
      ),
    ).toMatchObject({ enabled: false, statuses: ["failed"] });
    expect(
      selected.preferences.notifications.rules.find(
        (rule) => rule.targetKey === targetKey(newTarget),
      ),
    ).toEqual({
      targetKey: targetKey(newTarget),
      enabled: true,
      scope: "mine",
      statuses: ["success", "failed", "canceled"],
    });
  });

  it("prunes a removed target override and rule", () => {
    const settings = demoSnapshot().settings;
    const removed = settings.targets[0];
    const key = targetKey(removed);
    const configured = {
      ...settings,
      displayScopes: {
        ...settings.displayScopes,
        targets: { [key]: "all" as const },
      },
      preferences: {
        ...settings.preferences,
        notifications: {
          ...settings.preferences.notifications,
          rules: [
            {
              targetKey: key,
              enabled: false,
              scope: "all" as const,
              statuses: ["failed" as const],
            },
          ],
        },
      },
    };

    const changed = applySettingsChange(configured, {
      kind: "target",
      target: removed,
      selected: false,
    });

    expect(changed.displayScopes.targets).toEqual({});
    expect(changed.preferences.notifications.rules).toEqual([]);
  });
});
