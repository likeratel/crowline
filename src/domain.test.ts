import { describe, expect, it } from "vitest";
import { demoSnapshot } from "./demo";
import {
  duration,
  isActive,
  panelActivities,
  panelSettingsSchema,
  targetKey,
  settingsSchema,
  snapshotSchema,
  visibleActivities,
  type Activity,
} from "./domain";

describe("activity filtering", () => {
  it("uses the latest cross-account state while preserving verified Mine attribution", () => {
    const base = demoSnapshot();
    const cached = {
      ...base.activities[0],
      ownership: "mine" as const,
      status: "running" as const,
      updatedAt: "2026-09-29T00:00:00Z",
    };
    const fresh = {
      ...cached,
      connectionId: "github:work",
      ownership: "other" as const,
      status: "success" as const,
      updatedAt: "2026-09-29T00:10:00Z",
      finishedAt: "2026-09-29T00:10:00Z",
    };
    const now = Date.parse("2026-09-29T00:20:00Z");
    for (const activities of [
      [cached, fresh],
      [fresh, cached],
    ]) {
      const snapshot = { ...base, activities };
      expect(visibleActivities(snapshot, "all", "", now)).toEqual([
        { ...fresh, ownership: "mine" },
      ]);
      expect(
        visibleActivities(snapshot, "all", "", now, cached.connectionId),
      ).toEqual([cached]);
      expect(
        visibleActivities(snapshot, "all", "", now, fresh.connectionId),
      ).toEqual([]);
    }
    const tied = { ...cached, updatedAt: fresh.updatedAt };
    expect(
      visibleActivities(
        { ...base, activities: [fresh, tied] },
        "all",
        "",
        now,
      )[0].status,
    ).toBe("success");
  });
  it("combines accounts without double-counting the same execution and prefers verified mine", () => {
    const base = demoSnapshot();
    const run = base.activities[0];
    const other = {
      ...run,
      connectionId: "github:work",
      ownership: "other" as const,
    };
    const snapshot = {
      ...base,
      settings: { ...base.settings, scope: "all" as const },
      activities: [other, run],
    };
    const combined = visibleActivities(snapshot, "all", "");
    expect(combined).toHaveLength(1);
    expect(combined[0].connectionId).toBe("github:local");
    expect(
      visibleActivities(snapshot, "all", "", undefined, "github:work"),
    ).toEqual([other]);
    expect(
      visibleActivities(
        { ...snapshot, settings: { ...snapshot.settings, scope: "mine" } },
        "all",
        "",
        undefined,
        "github:work",
      ),
    ).toEqual([]);
  });
  it("mine excludes other users and unknown ownership", () => {
    expect(
      visibleActivities(demoSnapshot(), "all", "").every(
        (item) => item.ownership === "mine",
      ),
    ).toBe(true);
  });
  it("all includes other users and unknown ownership without changing the source", () => {
    const original = demoSnapshot();
    const ids = original.activities.map((item) => item.id);
    const all = visibleActivities(
      { ...original, settings: { ...original.settings, scope: "all" } },
      "all",
      "",
    );
    expect(all.some((item) => item.ownership === "other")).toBe(true);
    expect(all.some((item) => item.ownership === "unknown")).toBe(true);
    expect(original.activities.map((item) => item.id)).toEqual(ids);
  });
  it("combines provider and text filters", () => {
    expect(
      visibleActivities(demoSnapshot(), "github", "production").map(
        (item) => item.id,
      ),
    ).toEqual(["g1"]);
    expect(visibleActivities(demoSnapshot(), "vercel", "production")).toEqual(
      [],
    );
  });
  it("hides active runs older than 24 hours", () => {
    const snapshot = demoSnapshot();
    const old = {
      ...snapshot.activities[0],
      startedAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
    };
    expect(
      visibleActivities({ ...snapshot, activities: [old] }, "all", ""),
    ).toHaveLength(0);
  });
  it("uses completion time rather than creation time for recent runs", () => {
    const snapshot = demoSnapshot();
    const item = {
      ...snapshot.activities[0],
      status: "success" as const,
      startedAt: "2020-01-01T00:00:00Z",
      finishedAt: new Date().toISOString(),
    };
    expect(
      visibleActivities({ ...snapshot, activities: [item] }, "all", ""),
    ).toHaveLength(1);
  });
  it("excludes old terminal activities, allows longer history", () => {
    const snapshot = demoSnapshot();
    const finishedAt = new Date(Date.now() - 48 * 3600_000).toISOString();
    const changed = {
      ...snapshot,
      activities: [
        { ...snapshot.activities[0], status: "success" as const, finishedAt },
      ],
    };
    expect(visibleActivities(changed, "all", "")).toEqual([]);
    expect(
      visibleActivities(
        { ...changed, settings: { ...changed.settings, historyHours: 168 } },
        "all",
        "",
      ),
    ).toHaveLength(1);
  });
  it("does not invent terminal duration when completion time is missing", () => {
    const item: Activity = {
      ...demoSnapshot().activities[0],
      status: "failed",
      finishedAt: null,
    };
    expect(duration(item)).toBe("—");
    expect(isActive(item)).toBe(false);
  });
  it("keeps unknown status visible without claiming it is running", () => {
    const snapshot = demoSnapshot();
    const item: Activity = {
      ...snapshot.activities[0],
      status: "unknown",
      updatedAt: "2020-01-01T00:00:00Z",
      finishedAt: null,
    };
    expect(isActive(item)).toBe(false);
    expect(duration(item)).toBe("—");
    expect(
      visibleActivities({ ...snapshot, activities: [item] }, "all", ""),
    ).toEqual([item]);
  });
});
describe("IPC validation", () => {
  it("accepts a valid snapshot and rejects unknown source states", () => {
    expect(snapshotSchema.safeParse(demoSnapshot()).success).toBe(true);
    expect(
      settingsSchema.safeParse({
        scope: "everyone",
        historyHours: 24,
        targets: [],
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ scope: "mine", historyHours: 0, targets: [] })
        .success,
    ).toBe(false);
  });
  it("rejects invalid dates in backend responses", () => {
    const snapshot = demoSnapshot();
    expect(
      snapshotSchema.safeParse({ ...snapshot, lastUpdatedAt: "not a date" })
        .success,
    ).toBe(false);
  });
});

describe("status panel policy", () => {
  it("excludes blocked even from old cached waiting states without hiding other approvals", () => {
    const base = demoSnapshot();
    const blocked: Activity = {
      ...base.activities[1],
      status: "waiting",
      rawStatus: "BLOCKED",
    };
    const approval: Activity = {
      ...base.activities[0],
      status: "waiting",
      rawStatus: "waiting",
    };
    expect(
      visibleActivities(
        { ...base, activities: [blocked, approval] },
        "all",
        "",
      ),
    ).toEqual([approval]);
    expect(isActive(blocked)).toBe(false);
  });
  it("uses the start time and exact 24-hour boundary regardless of the history setting", () => {
    const base = demoSnapshot();
    const now = Date.parse("2026-09-29T12:00:00Z");
    for (const status of ["queued", "running", "waiting"] as const) {
      for (const historyHours of [24, 168] as const) {
        const item = {
          ...base.activities[0],
          status,
          startedAt: "2026-09-28T12:00:00Z",
          updatedAt: new Date(now).toISOString(),
        };
        const snapshot = {
          ...base,
          settings: { ...base.settings, historyHours },
          activities: [item],
        };
        expect(visibleActivities(snapshot, "all", "", now)).toEqual([item]);
        expect(visibleActivities(snapshot, "all", "", now + 1)).toEqual([]);
      }
    }
  });
  it("filters panel services and account-specific projects without changing the dashboard", () => {
    const base = demoSnapshot();
    const settings = {
      ...base.settings,
      panel: {
        ...base.settings.panel,
        providers: ["github"] as const,
        hiddenTargets: [targetKey(base.settings.targets[0])],
      },
    };
    const snapshot = {
      ...base,
      settings: {
        ...settings,
        panel: { ...settings.panel, providers: [...settings.panel.providers] },
      },
    };
    expect(panelActivities(snapshot)).toEqual([]);
    expect(visibleActivities(snapshot, "all", "")).toEqual(
      visibleActivities(base, "all", ""),
    );
  });
  it("defaults old settings and rejects invalid limits", () => {
    const { panel: _panel, ...legacy } = demoSnapshot().settings;
    expect(settingsSchema.parse(legacy).panel).toEqual(
      panelSettingsSchema.parse({}),
    );
    for (const rowLimit of [0, 11, 1.5]) {
      expect(panelSettingsSchema.safeParse({ rowLimit }).success).toBe(false);
    }
  });
});
