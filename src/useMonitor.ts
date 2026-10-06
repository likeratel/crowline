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
import { shouldRequestRefresh } from "./queryHealth";
import { monitorCopy } from "./monitorCopy";
import { getActiveLocale } from "./i18n";

const RESUME_COOLDOWN_MS = 2_000;

export function useMonitor() {
  const eventRevision = useRef(0);
  const refreshRequest = useRef<Promise<void> | null>(null);
  const lastResumeRequest = useRef(0);
  const ensureSubscription = useRef<() => Promise<void>>(async () => {});
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
    const resume = (event: Event) => {
      const networkRestored = event.type === "online";
      if (
        (!networkRestored && document.visibilityState !== "visible") ||
        !snapshot ||
        !shouldRequestRefresh(snapshot, Date.now(), networkRestored) ||
        (!networkRestored &&
          Date.now() - lastResumeRequest.current < RESUME_COOLDOWN_MS)
      )
        return;
      lastResumeRequest.current = Date.now();
      void bridge.requestRefresh().catch(() => {
        lastResumeRequest.current = 0;
        if (!disposed)
          setError(monitorCopy(getActiveLocale(), "recoveryError"));
      });
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [snapshot]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let subscriptionRequest: Promise<void> | null = null;
    const update = (value: Snapshot) => {
      if (!disposed) {
        setActiveLanguage(value.settings.preferences.language);
        eventRevision.current += 1;
        queue.update(value.settings);
        setSnapshot(value);
      }
    };
    const subscribe = (): Promise<void> => {
      if (unlisten) return Promise.resolve();
      if (subscriptionRequest) return subscriptionRequest;
      const request = (async () => {
        const unsubscribe = await bridge.subscribe(update, (message) => {
          if (!disposed) setError(message);
        });
        if (disposed) unsubscribe();
        else unlisten = unsubscribe;
      })();
      subscriptionRequest = request;
      const clearRequest = () => {
        if (subscriptionRequest === request) subscriptionRequest = null;
      };
      void request.then(clearRequest, clearRequest);
      return request;
    };
    ensureSubscription.current = subscribe;
    void (async () => {
      try {
        await subscribe();
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
      if (ensureSubscription.current === subscribe)
        ensureSubscription.current = async () => {};
      unlisten?.();
    };
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (refreshRequest.current) return refreshRequest.current;
    setRefreshing(true);
    setError(null);
    const request = (async () => {
      try {
        await ensureSubscription.current();
        const revision = eventRevision.current;
        const value = await bridge.refresh();
        if (revision === eventRevision.current) {
          setActiveLanguage(value.settings.preferences.language);
          queue.update(value.settings);
          setSnapshot(value);
        }
      } catch (cause) {
        setError(errorMessage(cause));
      }
    })();
    refreshRequest.current = request;
    void request.finally(() => {
      if (refreshRequest.current === request) {
        refreshRequest.current = null;
        setRefreshing(false);
      }
    });
    return request;
  }, []);
  const reload = useCallback(async () => {
    setError(null);
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
      throw cause;
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
