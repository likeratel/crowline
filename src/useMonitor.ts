import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { bridge, errorMessage } from "./bridge";
import type { Snapshot, TargetHistory } from "./domain";
import { createSettingsQueue } from "./settingsQueue";
import { setActiveLanguage } from "./i18n";

export function useMonitor() {
  const eventRevision = useRef(0);
  const [queue] = useState(() =>
    createSettingsQueue(
      bridge.change,
      async () => (await bridge.snapshot()).settings,
    ),
  );
  const changes = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = (value: Snapshot) => {
      if (!disposed) {
        setActiveLanguage(value.settings.preferences.language);
        eventRevision.current += 1;
        queue.update(value.settings);
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
        if (!disposed && revision === eventRevision.current) {
          setActiveLanguage(initial.settings.preferences.language);
          queue.update(initial.settings);
          setSnapshot(initial);
        }
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
      if (revision === eventRevision.current) {
        setActiveLanguage(value.settings.preferences.language);
        queue.update(value.settings);
        setSnapshot(value);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, []);
  const reload = useCallback(async () => {
    try {
      const revision = eventRevision.current;
      const value = await bridge.snapshot();
      if (revision === eventRevision.current) {
        setActiveLanguage(value.settings.preferences.language);
        queue.update(value.settings);
        setSnapshot(value);
      }
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
      if (revision === eventRevision.current) {
        setActiveLanguage(value.settings.preferences.language);
        queue.update(value.settings);
        setSnapshot(value);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingMore(false);
    }
  }, []);
  useEffect(() => {
    if (changes.settings)
      setActiveLanguage(changes.settings.preferences.language);
  }, [changes.settings]);
  return {
    snapshot:
      snapshot && changes.settings
        ? { ...snapshot, settings: changes.settings }
        : snapshot,
    settingsChanges: {
      change: queue.change,
      retry: queue.retry,
      pendingKeys: changes.pendingKeys,
      failures: changes.failures,
    },
    change: queue.change,
    error,
    setError,
    busy: false,
    refreshing: refreshing || snapshot?.refreshing === true,
    loadingMore,
    loadMore,
    reload,
    refresh,
  };
}
