import { describe, expect, it } from "vitest";
import { targetKey, type Target } from "../domain";
import { targetsChangedByBulkSelection } from "./connectionTargets";

const target = (index: number): Target => ({
  id: `org/project-${index}`,
  connectionId: "github:local",
  provider: "github",
  name: `project-${index}`,
  description: null,
  metadata: {},
});

describe("connection target bulk selection", () => {
  it("deselects only selected targets when more than 500 results are visible", () => {
    const visible = Array.from({ length: 501 }, (_, index) => target(index));
    const selected = new Set([targetKey(visible[3]), targetKey(visible[499])]);

    expect(
      targetsChangedByBulkSelection(visible, selected, false).map(targetKey),
    ).toEqual([...selected]);
  });

  it("selects every unselected target so capacity validation stays atomic", () => {
    const visible = Array.from({ length: 501 }, (_, index) => target(index));
    const selected = new Set(visible.slice(0, 499).map(targetKey));

    expect(
      targetsChangedByBulkSelection(visible, selected, true).map(targetKey),
    ).toEqual(visible.slice(499).map(targetKey));
  });
});
