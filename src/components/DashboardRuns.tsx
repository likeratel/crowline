import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ListFilter } from "lucide-react";
import {
  isActive,
  visibleActivities,
  type Activity,
  type Snapshot,
} from "../domain";
import { matchesActivityFilter, type ActivityFilter } from "../activityView";
import { monitorCopy } from "../monitorCopy";
import { useI18n } from "../i18n";
import { ActivityList } from "./ActivityList";
import { ActivityDetails } from "./ActivityDetails";

const detailsIdentity = (activity: Activity) =>
  JSON.stringify([
    activity.provider,
    activity.connectionId,
    activity.targetId ?? "",
    activity.id,
  ]);

type DetailsSelection = {
  key: string;
  provider: Activity["provider"];
  connectionId: string;
};

export function DashboardRuns({
  snapshot,
  activities,
  filter,
  listKey,
  onResetFilter,
  onError,
  onHide,
}: {
  snapshot: Snapshot;
  activities: Activity[];
  filter: ActivityFilter;
  listKey: string;
  onResetFilter: () => void;
  onError: (error: string) => void;
  onHide: (activity: Activity) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [selection, setSelection] = useState<DetailsSelection | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const matching = activities.filter((item) =>
    matchesActivityFilter(item, filter),
  );
  const selected = selection
    ? visibleActivities(
        snapshot,
        selection.provider,
        "",
        Date.now(),
        selection.connectionId,
      ).find((item) => detailsIdentity(item) === selection.key)
    : undefined;
  const restoreFocus = useCallback((key: string | null) => {
    window.requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else {
        const matchingButton = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            "[data-activity-details-key]",
          ),
        ).find((button) => button.dataset.activityDetailsKey === key);
        (matchingButton ?? root.current)?.focus();
      }
    });
  }, []);
  const closeDetails = useCallback(() => {
    const key = selection?.key ?? null;
    setSelection(null);
    restoreFocus(key);
  }, [restoreFocus, selection]);
  useEffect(() => {
    if (selection && !selected) closeDetails();
  }, [closeDetails, selected, selection]);
  const showDetails = useCallback(
    (activity: Activity, element: HTMLButtonElement) => {
      trigger.current = element;
      setSelection({
        key: detailsIdentity(activity),
        provider: activity.provider,
        connectionId: activity.connectionId,
      });
    },
    [],
  );
  const common = {
    snapshot,
    settingsLocked: Boolean(snapshot.settingsError),
    onError,
    onHide,
    onShowDetails: showDetails,
  };
  const content =
    filter !== "all" ? (
      matching.length ? (
        <ActivityList
          key={`${listKey}:${filter}`}
          {...common}
          title={monitorCopy(locale, filter)}
          activities={matching}
          empty=""
        />
      ) : (
        <section
          className="status-empty"
          aria-label={monitorCopy(locale, "noStatus")}
        >
          <ListFilter size={22} aria-hidden="true" />
          <h2>{monitorCopy(locale, "noStatus")}</h2>
          <p>{monitorCopy(locale, "noStatusHelp")}</p>
          <button className="button" onClick={onResetFilter}>
            {monitorCopy(locale, "resetStatus")}
          </button>
        </section>
      )
    ) : (
      <AllActivityLists
        activities={activities}
        common={common}
        listKey={listKey}
        activeTitle={t("dashboard.active")}
        activeEmpty={t("dashboard.activeEmpty")}
        completedTitle={t("dashboard.completed")}
        completedEmpty={t("dashboard.completedEmpty")}
        unresolvedTitle={t("dashboard.needsAttention")}
      />
    );
  return (
    <div className="dashboard-runs" ref={root} tabIndex={-1}>
      {content}
      {selected && (
        <ActivityDetails
          activity={selected}
          snapshot={snapshot}
          settingsLocked={Boolean(snapshot.settingsError)}
          onClose={closeDetails}
          onError={onError}
          onHide={onHide}
        />
      )}
    </div>
  );
}

function AllActivityLists({
  activities,
  common,
  listKey,
  activeTitle,
  activeEmpty,
  completedTitle,
  completedEmpty,
  unresolvedTitle,
}: {
  activities: Activity[];
  common: Omit<
    ComponentProps<typeof ActivityList>,
    "title" | "activities" | "empty"
  >;
  listKey: string;
  activeTitle: string;
  activeEmpty: string;
  completedTitle: string;
  completedEmpty: string;
  unresolvedTitle: string;
}) {
  const active = activities.filter(isActive);
  const completed = activities.filter(
    (item) => !isActive(item) && item.status !== "unknown",
  );
  const unresolved = activities.filter((item) => item.status === "unknown");
  return (
    <>
      <ActivityList
        key={`${listKey}:active`}
        {...common}
        title={activeTitle}
        compactEmpty
        activities={active}
        empty={activeEmpty}
      />
      <ActivityList
        key={`${listKey}:completed`}
        {...common}
        title={completedTitle}
        activities={completed}
        empty={completedEmpty}
      />
      {unresolved.length > 0 && (
        <ActivityList
          key={`${listKey}:unknown`}
          {...common}
          title={unresolvedTitle}
          activities={unresolved}
          empty=""
        />
      )}
    </>
  );
}
