import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, errorMessage } from "./bridge";
import type { Settings, Snapshot, TargetHistory } from "./domain";

export function useMonitor() {
  const eventRevision = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = (value: Snapshot) => {
      if (!disposed) {
        eventRevision.current += 1;
        setSnapshot(value);
      }
    };
    void (async () => {
      try {
        const unsubscribe = await bridge.subscribe(update, setError);
        if (disposed) unsubscribe();
        else unlisten = unsubscribe;
        const revision = eventRevision.current;
        const initial = await bridge.snapshot();
        if (!disposed && revision === eventRevision.current)
          setSnapshot(initial);
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
    setRefreshing(true);
    setError(null);
    try {
      const revision = eventRevision.current;
      const value = await bridge.refresh();
      if (revision === eventRevision.current) setSnapshot(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, []);
  const save = useCallback(async (settings: Settings) => {
    setBusy(true);
    setError(null);
    try {
      const revision = eventRevision.current;
      const saved = await bridge.save(settings);
      if (revision === eventRevision.current)
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
  const reload = useCallback(async () => {
    try {
      const revision = eventRevision.current;
      const value = await bridge.snapshot();
      if (revision === eventRevision.current) setSnapshot(value);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);
  const loadMore = useCallback(async (page: TargetHistory) => {
    setLoadingMore(true);
    setError(null);
    try {
      const revision = eventRevision.current;
      const value = await bridge.loadMore(page);
      if (revision === eventRevision.current) setSnapshot(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingMore(false);
    }
  }, []);
  return {
    snapshot,
    error,
    setError,
    busy,
    refreshing: refreshing || snapshot?.refreshing === true,
    loadingMore,
    loadMore,
    reload,
    refresh,
    save,
  };
}
