import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  LoaderCircle,
  Minus,
  Pause,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { bridge, errorMessage, isPreview } from "../bridge";
import {
  duration,
  isActive,
  PROVIDER_NAMES,
  STATUS_LABELS,
  timeAgo,
  visibleActivities,
  type Activity,
  type Provider,
} from "../domain";
import { useMonitor } from "../useMonitor";
import { Connections } from "./Connections";
import { AccountFilter } from "./AccountFilter";
import "../styles/panel.css";

const SOURCE: Record<Provider, string> = {
  github: "GH",
  vercel: "VC",
  aws: "AWS",
};

function RunRow({
  item,
  onError,
}: {
  item: Activity;
  onError: (message: string) => void;
}) {
  const Icon =
    item.status === "running"
      ? LoaderCircle
      : item.status === "success"
        ? Check
        : item.status === "failed"
          ? X
          : item.status === "waiting"
            ? Pause
            : item.status === "canceled"
              ? Minus
              : Circle;
  return (
    <button
      className="panel-run"
      onClick={() =>
        void bridge
          .open(item.url)
          .catch((cause: unknown) => onError(errorMessage(cause)))
      }
    >
      <Icon
        size={14}
        className={`run-symbol ${item.status} ${item.status === "running" ? "spin" : ""}`}
        aria-label={STATUS_LABELS[item.status]}
      />
      <span className="panel-run-copy">
        <span className="panel-run-title">{item.title}</span>
        <span className="panel-run-meta">
          <span>{SOURCE[item.provider]}</span> {item.project}
          {item.branch ? ` · ${item.branch}` : ""}
        </span>
      </span>
      <span className="panel-run-time" title={item.rawStatus}>
        {isActive(item) && item.provider !== "aws"
          ? duration(item)
          : `${timeAgo(item.finishedAt ?? item.updatedAt)}${item.finishedAt ? "" : " 갱신"}`}
      </span>
    </button>
  );
}

function RunSection({
  title,
  items,
  limit,
  onError,
}: {
  title: string;
  items: Activity[];
  limit: number;
  onError: (message: string) => void;
}) {
  return (
    <section className="panel-section" aria-label={title}>
      <h2>
        {title}
        <span>{items.length}</span>
      </h2>
      {items.length ? (
        items
          .slice(0, limit)
          .map((item) => (
            <RunRow
              key={`${item.provider}:${item.id}`}
              item={item}
              onError={onError}
            />
          ))
      ) : (
        <p className="panel-empty-row">해당하는 실행이 없습니다.</p>
      )}
      {items.length > limit && (
        <button
          className="panel-more"
          onClick={() =>
            void bridge
              .dashboard()
              .catch((cause: unknown) => onError(errorMessage(cause)))
          }
        >
          나머지 {items.length - limit}개 보기 <ChevronRight size={12} />
        </button>
      )}
    </section>
  );
}

export function TrayPanel() {
  const { snapshot, busy, error, setError, refresh, save } = useMonitor();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [provider, setProvider] = useState<Provider | "all">("all");
  const [accountId, setAccountId] = useState("all");
  const [, tick] = useState(0);
  useEffect(() => {
    document.documentElement.classList.add("panel-mode");
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !settingsOpen)
        void bridge
          .hide()
          .catch((cause: unknown) => setError(errorMessage(cause)));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("panel-mode");
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen, setError]);
  const selectedAccount = snapshot?.settings.accounts.some(
    (account) => account.id === accountId,
  )
    ? accountId
    : "all";
  const items = snapshot
    ? visibleActivities(snapshot, provider, "", undefined, selectedAccount)
    : [];
  const active = items.filter(isActive);
  const complete = items.filter(
    (item) => !isActive(item) && item.status !== "unknown",
  );
  const unresolved = items.filter((item) => item.status === "unknown");
  const openDashboard = () =>
    void bridge
      .dashboard()
      .catch((cause: unknown) => setError(errorMessage(cause)));
  return (
    <main className="tray-panel" aria-label="배포 요약">
      <header className="panel-header">
        <span className="panel-brand">
          <img src="/crowline.png" alt="" />
          crowline
        </span>
        <div className="panel-actions">
          <button
            className="panel-icon"
            aria-label="새로고침"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
          </button>
          <button
            className="panel-icon"
            aria-label="연결 및 설정"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={15} />
          </button>
          <button
            className="panel-icon"
            aria-label="패널 닫기"
            onClick={() =>
              void bridge
                .hide()
                .catch((cause: unknown) => setError(errorMessage(cause)))
            }
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {isPreview && <div className="panel-preview">미리보기 · 가상 데이터</div>}
      {snapshot && (
        <div className="panel-filters">
          <div role="group" aria-label="실행자 범위">
            <button
              aria-pressed={snapshot.settings.scope === "mine"}
              disabled={busy}
              onClick={() => void save({ ...snapshot.settings, scope: "mine" })}
            >
              내 실행
            </button>
            <button
              aria-pressed={snapshot.settings.scope === "all"}
              disabled={busy}
              onClick={() => void save({ ...snapshot.settings, scope: "all" })}
            >
              전체
            </button>
          </div>
          <select
            aria-label="서비스 필터"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as Provider | "all");
              setAccountId("all");
            }}
          >
            <option value="all">모든 서비스</option>
            <option value="github">GitHub Actions</option>
            <option value="vercel">Vercel</option>
            <option value="aws">AWS</option>
          </select>
        </div>
      )}
      <div className="panel-scroll">
        {snapshot && (
          <div className="panel-account-filter">
            <AccountFilter
              snapshot={snapshot}
              provider={provider}
              value={selectedAccount}
              onChange={setAccountId}
            />
          </div>
        )}
        {error && (
          <p className="panel-error" role="alert">
            {error}
          </p>
        )}
        {snapshot && snapshot.issues.length > 0 && (
          <details className="panel-issues">
            <summary>
              조회 알림 {snapshot.issues.length}개 · 일부 정보가 늦을 수
              있습니다
            </summary>
            {snapshot.issues.map((issue, index) => (
              <p key={`${issue.provider}:${index}`}>
                {PROVIDER_NAMES[issue.provider]} · {issue.message}
              </p>
            ))}
          </details>
        )}
        {!snapshot ? (
          <p className="panel-empty-row">
            {error ? "연결 상태를 확인해 주세요." : "연결 확인 중…"}
          </p>
        ) : snapshot.settings.targets.length === 0 ? (
          <div className="panel-onboarding">
            <h1>감시할 프로젝트를 선택하세요.</h1>
            <p>
              GitHub · Vercel · AWS
              <br />이 기기의 기존 로그인을 사용합니다.
            </p>
            <button onClick={() => setSettingsOpen(true)}>
              서비스 연결 <ChevronRight size={13} />
            </button>
          </div>
        ) : (
          <>
            <RunSection
              title="진행 중"
              items={active}
              limit={12}
              onError={setError}
            />
            <RunSection
              title={
                snapshot.settings.historyHours === 24
                  ? "최근 24시간"
                  : "최근 7일"
              }
              items={complete}
              limit={8}
              onError={setError}
            />
            {unresolved.length > 0 && (
              <RunSection
                title="상태 확인 필요"
                items={unresolved}
                limit={4}
                onError={setError}
              />
            )}
          </>
        )}
      </div>
      <footer className="panel-footer">
        <span>
          {busy
            ? "확인 중…"
            : snapshot?.lastUpdatedAt
              ? `${timeAgo(snapshot.lastUpdatedAt)} 확인`
              : "연결 대기"}
        </span>
        <button onClick={openDashboard}>
          상세 보기 <ArrowUpRight size={13} />
        </button>
      </footer>
      {settingsOpen && snapshot && (
        <Connections
          snapshot={snapshot}
          onClose={() => setSettingsOpen(false)}
          onSave={save}
          onRefresh={refresh}
        />
      )}
    </main>
  );
}
