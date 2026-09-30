import { useState } from "react";
import {
  targetKey,
  PROVIDER_NAMES,
  type Provider,
  type Snapshot,
  type TargetHistory,
} from "../domain";

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
    <section className="history-browser" aria-label="이전 배포 조회">
      <div>
        <strong>최근 결과를 먼저 표시합니다</strong>
        <p>
          이전 이력이 필요하면 대상을 선택해 추가로 불러오세요. 조회 기간과
          실행자 필터는 그대로 적용됩니다.
        </p>
      </div>
      <label>
        이력 조회 대상
        <select
          aria-label="이력 조회 대상"
          className="period-select"
          value={target ? selected : ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">대상 선택</option>
          {targets.map((item) => (
            <option key={targetKey(item)} value={targetKey(item)}>
              {PROVIDER_NAMES[item.provider]} · {item.name} ·{" "}
              {
                snapshot.settings.accounts.find(
                  (account) => account.id === item.connectionId,
                )?.label
              }
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
        {loading ? "이력 불러오는 중…" : "이전 배포 더 보기"}
      </button>
      {target && page && !page.nextCursor && (
        <small>
          이 대상의 추가 이력이 없거나 플랫폼에서 제공하는 조회 범위 끝입니다.
        </small>
      )}
    </section>
  );
}
