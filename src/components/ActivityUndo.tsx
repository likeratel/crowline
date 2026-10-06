import { activityCopy } from "../activityCopy";
import { useI18n } from "../i18n";

export function ActivityUndo({
  onUndo,
  busy,
}: {
  onUndo: () => Promise<void>;
  busy: boolean;
}) {
  const { locale } = useI18n();
  return (
    <div className="activity-undo" role="status">
      <span>{activityCopy(locale, "hidden")}</span>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void onUndo()}
      >
        {activityCopy(locale, "undo")}
      </button>
    </div>
  );
}
