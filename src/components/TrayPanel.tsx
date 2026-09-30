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
  X,
} from "lucide-react";
import { bridge, errorMessage, isPreview } from "../bridge";
import {
  duration,
  isActive,
  PROVIDER_NAMES,
  STATUS_LABELS,
  timeAgo,
  panelActivities,
  latestCompleted,
  type Activity,
} from "../domain";
import { ProviderIcon } from "./ProviderIcon";
import { useMonitor } from "../useMonitor";
import "../styles/panel.css";

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
      <span
        className="panel-provider"
        title={PROVIDER_NAMES[item.provider]}
        aria-label={`${PROVIDER_NAMES[item.provider]} · ${STATUS_LABELS[item.status]}`}
        role="img"
      >
        <ProviderIcon provider={item.provider} size={22} />
        <Icon
          size={10}
          className={`run-symbol ${item.status} ${item.status === "running" ? "spin" : ""}`}
          aria-hidden="true"
        />
      </span>
      <span className="panel-run-copy">
        <span className="panel-run-title">{item.title}</span>
        <span className="panel-run-meta">
          {item.project}
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
  const { snapshot, refreshing: busy, error, setError, refresh } = useMonitor();
  const [, tick] = useState(0);
  useEffect(() => {
    document.documentElement.classList.add("panel-mode");
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape")
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
  }, [setError]);
  const items = snapshot ? panelActivities(snapshot) : [];
  const active = items.filter(isActive);
  const complete = latestCompleted(items);
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
      <div className="panel-scroll">
        {snapshot && snapshot.pendingTargets.length > 0 && (
          <p className="panel-empty-row" role="status">
            최근 결과부터 표시 중 · {snapshot.pendingTargets.length}개 대상의
            진행 상태 확인 중
          </p>
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
            <button onClick={openDashboard}>
              대시보드에서 연결 <ChevronRight size={13} />
            </button>
          </div>
        ) : (
          <>
            {snapshot.settings.panel.showActive && (
              <RunSection
                title="진행 중"
                items={active}
                limit={snapshot.settings.panel.rowLimit}
                onError={setError}
              />
            )}
            {snapshot.settings.panel.showCompleted && (
              <RunSection
                title={
                  snapshot.settings.historyHours === 24
                    ? "최근 24시간"
                    : "최근 7일"
                }
                items={complete}
                limit={snapshot.settings.panel.rowLimit}
                onError={setError}
              />
            )}
            {!snapshot.settings.panel.showActive &&
              !snapshot.settings.panel.showCompleted && (
                <p className="panel-empty-row">
                  표시할 섹션은 대시보드에서 설정할 수 있습니다.
                </p>
              )}
            {unresolved.length > 0 && (
              <RunSection
                title="상태 확인 필요"
                items={unresolved}
                limit={snapshot.settings.panel.rowLimit}
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
          대시보드 열기 <ArrowUpRight size={13} />
        </button>
      </footer>
    </main>
  );
}
