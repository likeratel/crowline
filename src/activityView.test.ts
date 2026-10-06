import { expect, it } from "vitest";
import { demoSnapshot } from "./demo";
import { visibleActivities } from "./domain";
import { isLongRunning, matchesActivityFilter } from "./activityView";

it("status filters distinguish failed executions, active runs and unknown outcomes without changing inputs", () => {
  const snapshot = demoSnapshot();
  const original = JSON.stringify(snapshot);
  const rows = visibleActivities(snapshot, "all", "");
  expect(
    rows.filter((item) => matchesActivityFilter(item, "active")),
  ).toHaveLength(2);
  expect(
    rows
      .filter((item) => matchesActivityFilter(item, "failed"))
      .map((item) => item.id),
  ).toEqual(["g3"]);
  expect(
    rows.filter((item) => matchesActivityFilter(item, "completed")),
  ).toHaveLength(3);
  expect(
    rows.filter((item) => matchesActivityFilter(item, "unresolved")),
  ).toHaveLength(0);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it("searches workflow context and labels long running observations without changing their status", () => {
  const base = demoSnapshot();
  expect(
    visibleActivities(base, "github", "CI").map((item) => item.id),
  ).toEqual(["g2"]);
  const now = Date.now();
  const activity = {
    ...base.activities[0],
    startedAt: new Date(now - 25 * 3600_000).toISOString(),
  };
  expect(isLongRunning(activity, now)).toBe(true);
  expect(
    visibleActivities({ ...base, activities: [activity] }, "all", "", now)[0]
      .status,
  ).toBe("running");
  expect(isLongRunning({ ...activity, status: "success" }, now)).toBe(false);
});
