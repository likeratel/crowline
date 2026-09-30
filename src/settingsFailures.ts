import { settingsChangeKey, type SettingsChange } from "./settingsChanges";
import type { SettingsFailure } from "./settingsQueue";

/** Retain failed fields that have not been replaced by a newer user choice. */
export function remainingChange(
  original: SettingsChange,
  newer: SettingsChange,
): SettingsChange | null {
  if (
    original.kind === "notificationRules" &&
    newer.kind === "notificationRules"
  ) {
    const rules = original.rules.flatMap((rule) => {
      const replacement = newer.rules.find(
        (item) => item.targetKey === rule.targetKey,
      );
      if (!replacement) return [rule];
      const rest = Object.fromEntries(
        Object.entries(rule).filter(
          ([key]) => key === "targetKey" || !(key in replacement),
        ),
      ) as typeof rule;
      return Object.keys(rest).length > 1 ? [rest] : [];
    });
    return rules.length ? { kind: "notificationRules", rules } : null;
  }
  if (original.kind === "panel" && newer.kind === "panel") {
    const patch = Object.fromEntries(
      Object.entries(original.patch).filter(([key]) => !(key in newer.patch)),
    );
    return Object.keys(patch).length ? { kind: "panel", patch } : null;
  }
  return settingsChangeKey(original) === settingsChangeKey(newer)
    ? null
    : original;
}

export function addFailure(
  failures: Record<string, SettingsFailure>,
  failure: SettingsFailure,
): Record<string, SettingsFailure> {
  const key = settingsChangeKey(failure.change);
  const existing = failures[key];
  let change = failure.change;
  if (
    existing?.change.kind === "notificationRules" &&
    change.kind === "notificationRules"
  ) {
    const oldRules = existing.change.rules;
    change = {
      kind: "notificationRules",
      rules: change.rules.map((rule) => ({
        ...oldRules.find((old) => old.targetKey === rule.targetKey),
        ...rule,
      })),
    };
  } else if (existing?.change.kind === "panel" && change.kind === "panel") {
    change = {
      kind: "panel",
      patch: { ...existing.change.patch, ...change.patch },
    };
  }
  return { ...failures, [key]: { ...failure, change } };
}

export function replaceFailedFields(
  failures: Record<string, SettingsFailure>,
  newer: SettingsChange,
): Record<string, SettingsFailure> {
  return Object.values(failures).reduce<Record<string, SettingsFailure>>(
    (next, failure) => {
      const change = remainingChange(failure.change, newer);
      return change ? addFailure(next, { ...failure, change }) : next;
    },
    {},
  );
}
