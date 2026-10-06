import { useState } from "react";
import { activityIdentity, type Activity, type ActivityKey } from "./domain";
import { activityCopy } from "./activityCopy";
import { useI18n } from "./i18n";
import type { SettingsChange } from "./settingsChanges";

export function useActivityDismissal(
  change: (change: SettingsChange) => Promise<boolean>,
  onError: (message: string) => void,
) {
  const { locale } = useI18n();
  const [lastHidden, setLastHidden] = useState<ActivityKey | null>(null);
  const [undoing, setUndoing] = useState(false);
  const hide = async (activity: Activity) => {
    const key = activityIdentity(activity);
    try {
      if (
        await change({
          kind: "activityVisibility",
          activity: key,
          hidden: true,
        })
      ) {
        setLastHidden(key);
      } else {
        onError(activityCopy(locale, "failed"));
      }
    } catch {
      onError(activityCopy(locale, "failed"));
    }
  };
  const undo = async () => {
    if (!lastHidden || undoing) return;
    const key = lastHidden;
    setUndoing(true);
    try {
      if (
        await change({
          kind: "activityVisibility",
          activity: key,
          hidden: false,
        })
      ) {
        setLastHidden((current) => (current === key ? null : current));
      } else {
        onError(activityCopy(locale, "failed"));
      }
    } catch {
      onError(activityCopy(locale, "failed"));
    } finally {
      setUndoing(false);
    }
  };
  return { hide, undo, undoing, lastHidden };
}
