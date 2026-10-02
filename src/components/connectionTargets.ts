import { targetKey, type Target } from "../domain";

export function targetsChangedByBulkSelection(
  visibleTargets: readonly Target[],
  selectedKeys: ReadonlySet<string>,
  shouldSelect: boolean,
): Target[] {
  return visibleTargets.filter(
    (target) => selectedKeys.has(targetKey(target)) !== shouldSelect,
  );
}
