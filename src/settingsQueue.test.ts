import { describe, expect, it } from "vitest";
import { demoSnapshot } from "./demo";
import { applySettingsChange, type SettingsChange } from "./settingsChanges";
import { createSettingsQueue } from "./settingsQueue";
import { accountDisplayName } from "./accountNames";
import { targetKey, type Settings } from "./domain";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("immediate settings", () => {
  it("serializes writes while showing rapid edits and preserving newer unrelated settings", async () => {
    let stored = demoSnapshot().settings;
    const gates = [deferred<void>(), deferred<void>()];
    const calls: SettingsChange[] = [];
    const queue = createSettingsQueue(
      async (change) => {
        const index = calls.length;
        calls.push(change);
        await gates[index].promise;
        stored = applySettingsChange(stored, change);
        return stored;
      },
      async () => stored,
    );
    queue.update(stored);
    const first = queue.change({ kind: "panel", patch: { showActive: false } });
    const second = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(queue.getSnapshot().settings?.preferences.language).toBe("en");
    expect(queue.getSnapshot().settings?.panel.showActive).toBe(false);
    stored = {
      ...stored,
      preferences: { ...stored.preferences, checkUpdatesAutomatically: false },
    };
    queue.update(stored);
    gates[0].resolve();
    expect(await first).toBe(true);
    gates[1].resolve();
    expect(await second).toBe(true);
    expect(stored.panel.showActive).toBe(false);
    expect(stored.preferences).toMatchObject({
      language: "en",
      checkUpdatesAutomatically: false,
    });
    expect(queue.getSnapshot().settings).toEqual(stored);
  });

  it("rolls back a failed change and retries its intent against current settings", async () => {
    let stored = demoSnapshot().settings;
    let fail = true;
    const queue = createSettingsQueue(
      async (change) => {
        if (fail) throw new Error("Synthetic disk failure");
        stored = applySettingsChange(stored, change);
        return stored;
      },
      async () => stored,
    );
    queue.update(stored);
    expect(await queue.change({ kind: "language", value: "ja" })).toBe(false);
    expect(queue.getSnapshot().settings?.preferences.language).toBe(
      stored.preferences.language,
    );
    expect(queue.getSnapshot().failures.language.message).toBe(
      "Synthetic disk failure",
    );
    stored = { ...stored, scope: "all" };
    queue.update(stored);
    fail = false;
    expect(await queue.retry("language")).toBe(true);
    expect(stored.scope).toBe("all");
    expect(stored.preferences.language).toBe("ja");
    expect(queue.getSnapshot().failures).toEqual({});
  });

  it("does not resurrect an older failed selection over a later edit", async () => {
    let stored = demoSnapshot().settings;
    const gate = deferred<Settings>();
    let calls = 0;
    const queue = createSettingsQueue(
      async (change) => {
        if (++calls === 1) return gate.promise;
        stored = applySettingsChange(stored, change);
        return stored;
      },
      async () => stored,
    );
    queue.update(stored);
    const old = queue.change({ kind: "language", value: "ja" });
    const latest = queue.change({ kind: "language", value: "en" });
    gate.reject(new Error("Synthetic old write failed"));
    expect(await old).toBe(false);
    expect(await latest).toBe(true);
    expect(queue.getSnapshot().settings?.preferences.language).toBe("en");
    expect(queue.getSnapshot().failures).toEqual({});
  });

  it("applies bulk targets once and preserves targets outside the changed set", () => {
    const settings = demoSnapshot().settings;
    const [github, vercel, aws] = settings.targets;
    const removed = applySettingsChange(settings, {
      kind: "targets",
      targets: [github, vercel],
      selected: false,
    });
    expect(removed.targets).toEqual([aws]);
    const restored = applySettingsChange(removed, {
      kind: "targets",
      targets: [github, vercel],
      selected: true,
    });
    expect(restored.targets.map(targetKey)).toEqual(
      expect.arrayContaining(settings.targets.map(targetKey)),
    );
  });

  it("drops overlapping failed bulk target intent after a newer individual choice", async () => {
    let stored = demoSnapshot().settings;
    const [github, vercel] = stored.targets;
    let fail = true;
    const queue = createSettingsQueue(
      async (change) => {
        if (fail) throw new Error("Synthetic failure");
        stored = applySettingsChange(stored, change);
        return stored;
      },
      async () => stored,
    );
    queue.update(stored);
    await queue.change({
      kind: "targets",
      targets: [github, vercel],
      selected: false,
    });
    fail = false;
    await queue.change({ kind: "target", target: github, selected: true });
    const failure = Object.values(queue.getSnapshot().failures)[0];
    expect(failure.change).toEqual({
      kind: "targets",
      targets: [vercel],
      selected: false,
    });
    const failureKey = Object.keys(queue.getSnapshot().failures)[0];
    expect(await queue.retry(failureKey)).toBe(true);
    expect(stored.targets.map(targetKey)).toContain(targetKey(github));
    expect(stored.targets.map(targetKey)).not.toContain(targetKey(vercel));
  });

  it("keeps a newer published snapshot when an older IPC response completes", async () => {
    const original = demoSnapshot().settings;
    const response = deferred<Settings>();
    let stored = original;
    const queue = createSettingsQueue(
      () => response.promise,
      async () => stored,
    );
    queue.update(original);
    const saving = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    const saved = applySettingsChange(original, {
      kind: "language",
      value: "en",
    });
    const newer = { ...saved, scope: "all" as const };
    stored = newer;
    queue.update(newer);
    response.resolve(saved);
    await saving;
    expect(queue.getSnapshot().settings).toEqual(newer);
  });

  it("merges success with an unrelated snapshot received before the write commits", async () => {
    const original = demoSnapshot().settings;
    const response = deferred<Settings>();
    let stored = original;
    const queue = createSettingsQueue(
      () => response.promise,
      async () => stored,
    );
    queue.update(original);
    const saving = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    const external = { ...original, scope: "all" as const };
    queue.update(external);
    stored = applySettingsChange(external, { kind: "language", value: "en" });
    response.resolve(stored);
    await saving;
    expect(queue.getSnapshot().settings).toMatchObject({
      scope: "all",
      preferences: { language: "en" },
    });
  });

  it("does not undo a newer choice after the local write was published", async () => {
    const original = demoSnapshot().settings;
    const response = deferred<Settings>();
    let stored = original;
    const queue = createSettingsQueue(
      () => response.promise,
      async () => stored,
    );
    queue.update(original);
    const saving = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    const saved = applySettingsChange(original, {
      kind: "language",
      value: "en",
    });
    queue.update(saved);
    stored = applySettingsChange(saved, { kind: "language", value: "ja" });
    queue.update(stored);
    response.resolve(saved);
    await saving;
    expect(queue.getSnapshot().settings?.preferences.language).toBe("ja");
  });

  it("defaults only new notification rules to all outcomes", () => {
    const settings = demoSnapshot().settings;
    const key = targetKey(settings.targets[0]);
    const enabled = applySettingsChange(settings, {
      kind: "notificationRules",
      rules: [{ targetKey: key, enabled: true }],
    });
    expect(enabled.preferences.notifications.rules[0].statuses).toEqual([
      "success",
      "failed",
      "canceled",
    ]);
    const custom = applySettingsChange(enabled, {
      kind: "notificationRules",
      rules: [{ targetKey: key, statuses: ["success"] }],
    });
    const scope = applySettingsChange(custom, {
      kind: "notificationRules",
      rules: [{ targetKey: key, scope: "all" }],
    });
    expect(scope.preferences.notifications.rules[0]).toMatchObject({
      statuses: ["success"],
      scope: "all",
    });
  });

  it("confirms persisted state instead of inferring ownership from matching values", async () => {
    let stored = demoSnapshot().settings;
    const response = deferred<Settings>();
    const queue = createSettingsQueue(
      () => response.promise,
      async () => stored,
    );
    queue.update(stored);
    const saving = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    stored = applySettingsChange(stored, { kind: "language", value: "en" });
    queue.update(stored);
    stored = applySettingsChange(stored, { kind: "language", value: "ja" });
    queue.update(stored);
    stored = applySettingsChange(stored, { kind: "language", value: "en" });
    response.resolve(stored);
    await saving;
    expect(queue.getSnapshot().settings?.preferences.language).toBe("en");
  });

  it("distinguishes an unconfirmed success from a failed write", async () => {
    let stored = demoSnapshot().settings;
    const response = deferred<Settings>();
    const queue = createSettingsQueue(
      () => response.promise,
      async () => {
        throw new Error("Synthetic read failure");
      },
    );
    queue.update(stored);
    const saving = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    stored = { ...stored, scope: "all" };
    queue.update(stored);
    stored = applySettingsChange(stored, { kind: "language", value: "en" });
    response.resolve(stored);
    expect(await saving).toBe(false);
    expect(queue.getSnapshot().failures.language.phase).toBe("confirm");
    expect(stored.preferences.language).toBe("en");
  });

  it("keeps a newer event received while confirmation is pending", async () => {
    const original = demoSnapshot().settings;
    const response = deferred<Settings>();
    const confirmation = deferred<Settings>();
    const reading = deferred<void>();
    const queue = createSettingsQueue(
      () => response.promise,
      () => {
        reading.resolve();
        return confirmation.promise;
      },
    );
    queue.update(original);
    const saving = queue.change({ kind: "language", value: "en" });
    await Promise.resolve();
    const external = { ...original, scope: "all" as const };
    queue.update(external);
    const saved = applySettingsChange(external, {
      kind: "language",
      value: "en",
    });
    response.resolve(saved);
    await reading.promise;
    const newest = applySettingsChange(saved, {
      kind: "language",
      value: "ja",
    });
    queue.update(newest);
    confirmation.resolve(saved);
    expect(await saving).toBe(true);
    expect(queue.getSnapshot().settings).toEqual(newest);
  });

  it("retries confirmation failures and continues with the next queued setting", async () => {
    let stored = demoSnapshot().settings;
    let readFails = true;
    const queue = createSettingsQueue(
      async (change) => {
        stored = applySettingsChange(stored, change);
        queue.update(stored);
        return stored;
      },
      async () => {
        if (readFails) throw new Error("Synthetic confirmation failure");
        return stored;
      },
    );
    queue.update(stored);
    expect(await queue.change({ kind: "language", value: "en" })).toBe(false);
    readFails = false;
    const retry = queue.retry("language");
    const next = queue.change({ kind: "panel", patch: { showActive: false } });
    expect(await retry).toBe(true);
    expect(await next).toBe(true);
    expect(queue.getSnapshot().failures).toEqual({});
    expect(queue.getSnapshot().settings).toMatchObject({
      preferences: { language: "en" },
      panel: { showActive: false },
    });
  });

  it("retains unsaved bulk fields when a later edit changes only one project's outcome", async () => {
    let stored = demoSnapshot().settings;
    const [a, b] = stored.targets.map(targetKey);
    const gate = deferred<Settings>();
    let calls = 0;
    const queue = createSettingsQueue(
      async (change) => {
        if (++calls === 1) return gate.promise;
        stored = applySettingsChange(stored, change);
        return stored;
      },
      async () => stored,
    );
    queue.update(stored);
    const bulk = queue.change({
      kind: "notificationRules",
      rules: [
        { targetKey: a, scope: "all" },
        { targetKey: b, scope: "all" },
      ],
    });
    const outcome = queue.change({
      kind: "notificationRules",
      rules: [{ targetKey: a, statuses: ["success"] }],
    });
    gate.reject(new Error("Synthetic bulk failure"));
    await bulk;
    await outcome;
    const failureKey = Object.keys(queue.getSnapshot().failures)[0];
    expect(queue.getSnapshot().failures[failureKey].change).toMatchObject({
      rules: [
        { targetKey: a, scope: "all" },
        { targetKey: b, scope: "all" },
      ],
    });
    await queue.retry(failureKey);
    expect(
      stored.preferences.notifications.rules.find(
        (rule) => rule.targetKey === a,
      ),
    ).toMatchObject({ scope: "all", statuses: ["success"] });
    expect(
      stored.preferences.notifications.rules.find(
        (rule) => rule.targetKey === b,
      )?.scope,
    ).toBe("all");
  });

  it("keeps other projects retryable after replacing one failed bulk choice", async () => {
    let stored = demoSnapshot().settings;
    const [a, b] = stored.targets.map(targetKey);
    let fail = true;
    const queue = createSettingsQueue(
      async (change) => {
        if (fail) throw new Error("Synthetic failure");
        stored = applySettingsChange(stored, change);
        return stored;
      },
      async () => stored,
    );
    queue.update(stored);
    await queue.change({
      kind: "notificationRules",
      rules: [
        { targetKey: a, scope: "all" },
        { targetKey: b, scope: "all" },
      ],
    });
    fail = false;
    await queue.change({
      kind: "notificationRules",
      rules: [{ targetKey: a, scope: "mine" }],
    });
    const failure = queue.getSnapshot().failures[`notificationRules:${b}`];
    expect(failure.change).toEqual({
      kind: "notificationRules",
      rules: [{ targetKey: b, scope: "all" }],
    });
    await queue.retry(`notificationRules:${b}`);
    expect(
      stored.preferences.notifications.rules.find(
        (rule) => rule.targetKey === a,
      )?.scope,
    ).toBe("mine");
    expect(
      stored.preferences.notifications.rules.find(
        (rule) => rule.targetKey === b,
      )?.scope,
    ).toBe("all");
  });

  it("uses service identity for generated names but preserves aliases and existing custom names", () => {
    const snapshot = demoSnapshot();
    const account = {
      ...snapshot.settings.accounts[0],
      label: "GitHub (local)",
    };
    const connections = [
      {
        ...snapshot.connections[0],
        connectionId: account.id,
        account: "example-person",
        status: "connected" as const,
      },
    ];
    expect(accountDisplayName(account, snapshot.settings, connections)).toBe(
      "example-person",
    );
    expect(
      accountDisplayName(
        { ...account, label: "Work" },
        snapshot.settings,
        connections,
      ),
    ).toBe("Work");
    const renamed = applySettingsChange(snapshot.settings, {
      kind: "accountAlias",
      connectionId: account.id,
      alias: "Personal",
    });
    expect(accountDisplayName(account, renamed, connections)).toBe("Personal");
    const reset = applySettingsChange(renamed, {
      kind: "accountAlias",
      connectionId: account.id,
      alias: null,
    });
    expect(accountDisplayName(account, reset, connections)).toBe(
      "example-person",
    );
  });
});
