import { SearchX } from "lucide-react";
import { useI18n } from "../i18n";
import { uxCopy } from "../uxCopy";
import "../styles/empty-states.css";

export function FilteredRunsEmpty({
  search,
  accountName,
  onReset,
}: {
  search: string;
  accountName?: string;
  onReset: () => void;
}) {
  const { locale } = useI18n();
  return (
    <section
      className="filtered-runs-empty"
      aria-labelledby="filtered-runs-title"
    >
      <SearchX size={24} aria-hidden="true" />
      <h2 id="filtered-runs-title">{uxCopy(locale, "noFilteredRuns")}</h2>
      {(search.trim() || accountName) && (
        <p className="filter-values">
          {search.trim() && <span>“{search.trim()}”</span>}
          {accountName && <span>{accountName}</span>}
        </p>
      )}
      <p>{uxCopy(locale, "noFilteredRunsHelp")}</p>
      <button className="button" onClick={onReset}>
        {uxCopy(locale, "resetRunFilters")}
      </button>
    </section>
  );
}
