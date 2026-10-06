import { describe, expect, it } from "vitest";
import { demoSnapshot } from "./demo";
import {
  activityIdentity,
  panelActivities,
  settingsSchema,
  visibleActivities,
} from "./domain";
import { applySettingsChange, settingsChangeKey } from "./settingsChanges";

describe("persistent execution visibility", () => {
  it("hides the same execution across accounts and status changes, but not a new execution", () => {
    const base = demoSnapshot();
    const item = base.activities[0];
    const settings = applySettingsChange(base.settings, {
      kind: "activityVisibility",
      activity: activityIdentity(item),
      hidden: true,
    });
    const updated = {
      ...item,
      connectionId: "github:another",
      status: "success" as const,
      updatedAt: new Date().toISOString(),
    };
    const next = { ...item, id: "new-execution" };
    const snapshot = { ...base, settings, activities: [item, updated, next] };
    expect(visibleActivities(snapshot, "all", "").map((run) => run.id)).toEqual(
      [next.id],
    );
    expect(panelActivities(snapshot).map((run) => run.id)).toEqual([next.id]);
    const restored = applySettingsChange(settings, {
      kind: "activityVisibility",
      activity: activityIdentity(item),
      hidden: false,
    });
    expect(
      visibleActivities({ ...snapshot, settings: restored }, "all", ""),
    ).toHaveLength(2);
  });

  it("keeps project identities separate and round-trips the persistent setting", () => {
    const base = demoSnapshot();
    const item = base.activities[0];
    const key = activityIdentity(item);
    const change = {
      kind: "activityVisibility" as const,
      activity: key,
      hidden: true,
    };
    const settings = settingsSchema.parse(
      JSON.parse(JSON.stringify(applySettingsChange(base.settings, change))),
    );
    const differentProject = { ...item, targetId: "other/project" };
    expect(
      visibleActivities(
        { ...base, settings, activities: [item, differentProject] },
        "all",
        "",
      ),
    ).toEqual([differentProject]);
    expect(settingsChangeKey(change)).not.toEqual(
      settingsChangeKey({
        ...change,
        activity: activityIdentity(differentProject),
      }),
    );
    const { hiddenActivities: _old, ...legacy } = base.settings;
    expect(settingsSchema.parse(legacy).hiddenActivities).toEqual([]);
  });
});
