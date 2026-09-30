import { accountDisplayName } from "../accountNames";
import { useState } from "react";
import {
  targetKey,
  PROVIDER_NAMES,
  type Provider,
  type Snapshot,
  type TargetHistory,
} from "../domain";
import { useI18n } from "../i18n";

type Props = {
  snapshot: Snapshot;
  provider: Provider | "all";
  accountId: string;
  loading: boolean;
  onLoad: (page: TargetHistory) => Promise<void>;
};
export function HistoryBrowser({
  snapshot,
  provider,
  accountId,
  loading,
  onLoad,
}: Props) {
  const { t } = useI18n();
  const [selected, setSelected] = useState("");
  const targets = snapshot.settings.targets.filter(
    (target) =>
      (provider === "all" || target.provider === provider) &&
      (accountId === "all" || target.connectionId === accountId),
  );
  const target = targets.find((item) => targetKey(item) === selected);
  const page =
    target &&
    snapshot.history.find(
      (item) =>
        item.provider === target.provider &&
        item.connectionId === target.connectionId &&
        item.targetId === target.id,
    );
  if (!targets.length) return null;
  return (
    <section className="history-browser" aria-label={t("history.label")}>
      <label>
        {t("history.target")}
        <select
          aria-label={t("history.target")}
          className="period-select"
          value={target ? selected : ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t("history.selectTarget")}</option>
          {targets.map((item) => (
            <option key={targetKey(item)} value={targetKey(item)}>
              {PROVIDER_NAMES[item.provider]} · {item.name} ·{" "}
              {(() => {
                const account = snapshot.settings.accounts.find(
                  (account) => account.id === item.connectionId,
                );
                return account
                  ? accountDisplayName(
                      account,
                      snapshot.settings,
                      snapshot.connections,
                    )
                  : "";
              })()}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button"
        disabled={loading || !page?.nextCursor}
        onClick={() => {
          if (page) void onLoad(page);
        }}
      >
        {loading ? t("history.loading") : t("history.loadMore")}
      </button>
      {target && page && !page.nextCursor && <small>{t("history.end")}</small>}
    </section>
  );
}
