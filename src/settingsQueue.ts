import type { Settings } from "./domain";
import {
  addFailure,
  remainingChange,
  replaceFailedFields,
} from "./settingsFailures";
import {
  affectedSettingsKeys,
  applySettingsChange,
  settingsChangeKey,
  settingsChangeSchema,
  type SettingsChange,
} from "./settingsChanges";

type Entry = { id: number; change: SettingsChange };
export type SettingsFailure = Entry & {
  message: string;
  phase: "write" | "confirm";
};
export type SettingsQueueState = {
  settings: Settings | null;
  pendingKeys: string[];
  failures: Record<string, SettingsFailure>;
};

export function createSettingsQueue(
  send: (change: SettingsChange) => Promise<Settings>,
  readLatest: () => Promise<Settings>,
) {
  let base: Settings | null = null;
  let revision = 0;
  let sequence = 0;
  let pending: Entry[] = [];
  let failures: Record<string, SettingsFailure> = {};
  let tail = Promise.resolve();
  let state: SettingsQueueState = { settings: null, pendingKeys: [], failures };
  const listeners = new Set<() => void>();
  const emit = () => {
    state = {
      settings: base
        ? pending.reduce(
            (settings, entry) => applySettingsChange(settings, entry.change),
            base,
          )
        : null,
      pendingKeys: [
        ...new Set(
          pending.flatMap((entry) => [
            settingsChangeKey(entry.change),
            ...affectedSettingsKeys(entry.change),
          ]),
        ),
      ],
      failures,
    };
    listeners.forEach((listener) => listener());
  };
  const update = (settings: Settings) => {
    base = settings;
    revision += 1;
    emit();
  };
  const change = (input: SettingsChange): Promise<boolean> => {
    const mutation = settingsChangeSchema.parse(input);
    const entry = { id: ++sequence, change: mutation };
    failures = replaceFailedFields(failures, mutation);
    pending = [...pending, entry];
    emit();
    const result = tail.then(async () => {
      const started = revision;
      let phase: "write" | "confirm" = "write";
      try {
        const settings = await send(mutation);
        if (revision === started) base = settings;
        else {
          phase = "confirm";
          const beforeRead = revision;
          const latest = await readLatest();
          if (beforeRead === revision) base = latest;
        }
        return true;
      } catch (cause) {
        const remaining = pending
          .filter((item) => item.id > entry.id)
          .reduce<SettingsChange | null>(
            (rest, item) => (rest ? remainingChange(rest, item.change) : null),
            mutation,
          );
        if (remaining) {
          failures = addFailure(failures, {
            ...entry,
            change: remaining,
            message: cause instanceof Error ? cause.message : String(cause),
            phase,
          });
        }
        return false;
      } finally {
        pending = pending.filter((item) => item.id !== entry.id);
        emit();
      }
    });
    tail = result.then(() => undefined);
    return result;
  };
  return {
    update,
    change,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry: (key: string) => {
      const failure = failures[key];
      return failure ? change(failure.change) : Promise.resolve(false);
    },
  };
}
