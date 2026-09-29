import { describe, expect, it } from "vitest";
import { demoSnapshot } from "./demo";
import {
  duration,
  isActive,
  settingsSchema,
  snapshotSchema,
  visibleActivities,
  type Activity,
} from "./domain";

describe("activity filtering", () => {
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
  it("retains active runs older than the history window", () => {
    const snapshot = demoSnapshot();
    const old = {
      ...snapshot.activities[0],
      startedAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
    };
    expect(
      visibleActivities({ ...snapshot, activities: [old] }, "all", ""),
    ).toHaveLength(1);
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
