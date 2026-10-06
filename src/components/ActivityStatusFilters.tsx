import type { Activity } from "../domain";
import {
  ACTIVITY_FILTERS,
  matchesActivityFilter,
  type ActivityFilter,
} from "../activityView";
import { monitorCopy } from "../monitorCopy";
import { useI18n } from "../i18n";

export function ActivityStatusFilters({
  activities,
  value,
  onChange,
}: {
  activities: Activity[];
  value: ActivityFilter;
  onChange: (value: ActivityFilter) => void;
}) {
  const { locale } = useI18n();
  return (
    <div
      className="activity-status-filters"
      role="group"
      aria-label={monitorCopy(locale, "filters")}
      title={monitorCopy(locale, "filterHelp")}
    >
      {ACTIVITY_FILTERS.map((filter) => (
        <button
          key={filter}
          className={`status-filter ${filter}`}
          aria-pressed={value === filter}
          onClick={() => onChange(filter)}
        >
          <span>{monitorCopy(locale, filter)}</span>
          <strong>
            {
              activities.filter((activity) =>
                matchesActivityFilter(activity, filter),
              ).length
            }
          </strong>
        </button>
      ))}
    </div>
  );
}
