import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertCircle,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  CircleDot,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { isPreview } from "./bridge";
import {
  isActive,
  PROVIDERS,
  PROVIDER_NAMES,
  timeAgo,
  visibleActivities,
  type Provider,
} from "./domain";
import { ActivityList } from "./components/ActivityList";
import { Connections } from "./components/Connections";
import { ProviderIcon } from "./components/ProviderIcon";
import { useMonitor } from "./useMonitor";
import "./App.css";

export default function App() {
  const monitor = useMonitor();
  const [provider, setProvider] = useState<Provider | "all">("all");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const { snapshot, busy, error, setError, refresh, save } = monitor;
  if (!snapshot)
    return (
      <main className="boot">
        <img className="boot-logo" src="/crowline.png" alt="" />
        <h1>crowline</h1>
        <p>{error ?? "연결 상태를 확인하고 있습니다…"}</p>
        {error ? (
          <button className="button" onClick={() => void refresh()}>
            다시 시도
          </button>
        ) : (
          <LoaderCircle className="spin" size={22} />
        )}
      </main>
    );
  const activities = visibleActivities(snapshot, provider, search);
  const active = activities.filter(isActive);
  const completed = activities.filter(
    (activity) => !isActive(activity) && activity.status !== "unknown",
  );
  const unresolved = activities.filter(
    (activity) => activity.status === "unknown",
  );
  const unknown = snapshot.activities.filter(
    (activity) =>
      activity.ownership === "unknown" &&
      (provider === "all" || activity.provider === provider),
  ).length;
  const connected = snapshot.connections.filter(
    (connection) => connection.status === "connected",
  ).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setProvider("all");
          }}
        >
          <span className="brand-mark">
            <img src="/crowline.png" alt="" />
          </span>
          <span>
            crowline<small>DEPLOYMENT MONITOR</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">CW</span>
          <div>
            내 워크스페이스<small>이 기기에서 실행 중</small>
          </div>
          <span className="live-dot" />
        </div>
        <p className="nav-label">모니터링</p>
        <nav aria-label="서비스 필터">
          <button
            className={`nav-item ${provider === "all" ? "selected" : ""}`}
            onClick={() => setProvider("all")}
          >
            <ActivityIcon size={17} />
            전체 서비스
            <span className="nav-count">
              {snapshot.settings.targets.length}
            </span>
          </button>
          {PROVIDERS.map((item) => (
            <button
              key={item}
              className={`nav-item ${provider === item ? "selected" : ""}`}
              onClick={() => setProvider(item)}
            >
              <ProviderIcon provider={item} />
              {PROVIDER_NAMES[item]}
              <span className="nav-count">
                {
                  snapshot.settings.targets.filter(
                    (target) => target.provider === item,
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item settings-nav"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} />
            연결 및 설정
            <ChevronRight size={15} />
          </button>
          <div className="privacy-note">
            <ShieldCheck size={15} />
            <span>각자의 계정으로, 이 기기에서만.</span>
          </div>
          <div className="version">
            crowline <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        {isPreview && (
          <div className="preview-banner">
            <Radio size={14} />
            <span>
              화면 미리보기 · 가상 데이터입니다. 실제 연결은 데스크톱 앱에서
              사용할 수 있어요.
            </span>
          </div>
        )}
        <header className="main-header">
          <div>
            <div className="eyebrow">
              <span className="live-dot" />
              YOUR RELEASES, IN SIGHT
            </div>
            <h1>
              {provider === "all" ? "배포 현황" : PROVIDER_NAMES[provider]}
            </h1>
            <p>여러 곳의 실행을 한눈에. 배포의 다음 순간을 확인하세요.</p>
          </div>
          <button
            className="button refresh-button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} className={busy ? "spin" : ""} />
            새로고침
          </button>
        </header>
        <div className="summary-grid">
          <div className="summary-card active-summary">
            <span>
              <CircleDot size={16} />
              진행 중
            </span>
            <div>
              <strong>{active.length}</strong>
              <small>실행</small>
              <span className="summary-pulse">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
          <div className="summary-card">
            <span>
              <CheckCheck size={16} />
              최근 종료
            </span>
            <div>
              <strong>{completed.length}</strong>
              <small>
                지난 {snapshot.settings.historyHours === 24 ? "24시간" : "7일"}
              </small>
            </div>
          </div>
          <button
            className="summary-card connection-summary"
            onClick={() => setSettingsOpen(true)}
          >
            <span>
              <Radio size={16} />
              서비스 연결
              <ArrowUpRight size={15} />
            </span>
            <div>
              <strong>
                {connected}
                <em>/ 3</em>
              </strong>
              <small>{snapshot.settings.targets.length}개 대상 모니터링</small>
            </div>
          </button>
        </div>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="실행자 범위">
            <button
              aria-pressed={snapshot.settings.scope === "mine"}
              disabled={busy}
              onClick={() => void save({ ...snapshot.settings, scope: "mine" })}
            >
              내 실행만
            </button>
            <button
              aria-pressed={snapshot.settings.scope === "all"}
              disabled={busy}
              onClick={() => void save({ ...snapshot.settings, scope: "all" })}
            >
              전체 실행
            </button>
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="실행명, 프로젝트, 브랜치 검색"
              aria-label="실행 검색"
            />
            {search && (
              <button
                className="clear-search"
                aria-label="검색 지우기"
                onClick={() => setSearch("")}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <select
            className="period-select"
            aria-label="조회 기간"
            value={snapshot.settings.historyHours}
            disabled={busy}
            onChange={(event) =>
              void save({
                ...snapshot.settings,
                historyHours: event.target.value === "168" ? 168 : 24,
              }).then((saved) => {
                if (saved) void refresh();
              })
            }
          >
            <option value={24}>최근 24시간</option>
            <option value={168}>최근 7일</option>
          </select>
        </div>
        <div className="scope-description">
          {snapshot.settings.scope === "mine"
            ? "내 push · PR · 수동 실행 · 재실행"
            : "내 계정이 접근할 수 있는 모든 실행"}
          {unknown > 0 && snapshot.settings.scope === "mine" && (
            <button
              disabled={busy}
              onClick={() => void save({ ...snapshot.settings, scope: "all" })}
            >
              실행자 미확인 {unknown}건은 전체에서 확인{" "}
              <ChevronRight size={12} />
            </button>
          )}
        </div>
        {error && (
          <div className="notice warning" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="오류 알림 닫기"
              onClick={() => setError(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {snapshot.issues.map((issue, index) => (
          <div
            className="notice warning"
            role="status"
            key={`${issue.provider}-${index}`}
          >
            <AlertCircle size={16} />
            <span>
              <strong>{PROVIDER_NAMES[issue.provider]}</strong> ·{" "}
              {issue.message}
            </span>
          </div>
        ))}
        {snapshot.settings.targets.length === 0 ? (
          <div className="onboarding-empty">
            <span className="empty-orbit">
              <Radio size={37} />
            </span>
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <h2>첫 번째 연결을 추가해 보세요</h2>
            <p>
              GitHub와 Vercel의 기존 로그인, AWS 프로필을 사용해
              <br />
              진행 중인 실행과 최근 배포를 모아 보여드립니다.
            </p>
            <button
              className="button primary"
              onClick={() => setSettingsOpen(true)}
            >
              <Plus size={16} />
              서비스 연결하기
            </button>
            <small>토큰을 복사하거나 별도 서버를 만들 필요가 없어요.</small>
          </div>
        ) : (
          <>
            <ActivityList
              title="진행 중"
              activities={active}
              empty="현재 조건에 해당하는 진행 중인 실행이 없습니다."
              onError={setError}
            />
            <ActivityList
              title="최근 종료"
              activities={completed}
              empty="현재 조건에 해당하는 최근 실행이 없습니다."
              onError={setError}
            />
            {unresolved.length > 0 && (
              <ActivityList
                title="상태 확인 필요"
                activities={unresolved}
                empty=""
                onError={setError}
              />
            )}
          </>
        )}
        <footer className="main-footer">
          <span>
            <span
              className={`live-dot ${snapshot.issues.length ? "amber" : ""}`}
            />
            {busy
              ? "최신 상태 확인 중…"
              : snapshot.lastUpdatedAt
                ? `${timeAgo(snapshot.lastUpdatedAt)} 조회`
                : "아직 조회하지 않았습니다"}
          </span>
          <span>실행 중 30초 · 대기 시 2분마다 갱신</span>
        </footer>
      </main>
      {settingsOpen && (
        <Connections
          snapshot={snapshot}
          onClose={() => setSettingsOpen(false)}
          onSave={save}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
