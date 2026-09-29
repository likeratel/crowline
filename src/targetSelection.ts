import { targetKey, type Settings, type Target } from "./domain";

export type TargetChanges = Record<
  string,
  { target: Target; selected: boolean }
>;

// Apply only this dialog's explicit edits to the latest persisted selections.
export function selectedTargets(
  settings: Settings,
  changes: TargetChanges,
): Target[] {
  const retained = settings.targets.filter(
    (target) => changes[targetKey(target)]?.selected !== false,
  );
  const additions = Object.values(changes)
    .filter(
      ({ target, selected }) =>
        selected &&
        settings.accounts.some(
          (account) => account.id === target.connectionId,
        ) &&
        !retained.some((item) => targetKey(item) === targetKey(target)),
    )
    .map(({ target }) => target);
  return [...retained, ...additions];
}
