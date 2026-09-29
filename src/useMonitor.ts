import { useCallback, useEffect, useState } from "react";
import { bridge, errorMessage } from "./bridge";
import type { Settings, Snapshot } from "./domain";

export function useMonitor() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = (value: Snapshot) => {
      if (!disposed) setSnapshot(value);
    };
    void (async () => {
      try {
        const unsubscribe = await bridge.subscribe(update, setError);
        if (disposed) unsubscribe();
        else unlisten = unsubscribe;
        update(await bridge.snapshot());
      } catch (cause) {
        if (!disposed) setError(errorMessage(cause));
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await bridge.refresh());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);
  const save = useCallback(async (settings: Settings) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await bridge.save(settings);
      setSnapshot((current) =>
        current ? { ...current, settings: saved } : current,
      );
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return {
    snapshot,
    error,
    setError,
    busy: busy || snapshot?.refreshing === true,
    refresh,
    save,
  };
}
