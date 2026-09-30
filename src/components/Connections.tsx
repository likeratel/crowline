import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { bridge, errorMessage } from "../bridge";
import {
  PROVIDERS,
  PROVIDER_NAMES,
  targetKey,
  type Account,
  type Discovery,
  type LoginStatus,
  type Provider,
  type Settings,
  type Snapshot,
  type Target,
} from "../domain";
import { ProviderIcon } from "./ProviderIcon";
import { AccountPicker } from "./AccountPicker";
import { getPlatformDetails } from "../platformDetails";
import { selectedTargets, type TargetChanges } from "../targetSelection";
interface Props {
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (settings: Settings) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onReload?: () => Promise<void>;
}
export function Connections({
  snapshot,
  onClose,
  onSave,
  onRefresh,
  onReload,
}: Props) {
  const [provider, setProvider] = useState<Provider>("github");
  const [connectionId, setConnectionId] = useState(
    snapshot.settings.accounts.find((account) => account.provider === "github")
      ?.id ?? "",
  );
  const [awsProfiles, setAwsProfiles] = useState<string[]>([]);
  const [results, setResults] = useState<Partial<Record<string, Discovery>>>(
    {},
  );
  const [targetChanges, setTargetChanges] = useState<TargetChanges>({});
  const selected = selectedTargets(snapshot.settings, targetChanges);
  const [region, setRegion] = useState("ap-northeast-2");
  const [search, setSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logins, setLogins] = useState<Partial<Record<string, LoginStatus>>>(
    {},
  );
  const login = logins[connectionId];
  const details = getPlatformDetails(provider);
  const reload = onReload ?? onRefresh;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (login?.state !== "waiting") return;
    let active = true;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void bridge
        .loginStatus(login.provider, login.connectionId)
        .then((value) => {
          if (active)
            setLogins((previous) => ({
              ...previous,
              [value.connectionId]: value,
            }));
        })
        .catch((cause: unknown) => {
          if (active) setError(errorMessage(cause));
        })
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [login?.state, login?.provider, login?.connectionId]);
  const accounts = snapshot.settings.accounts.filter(
    (account) => account.provider === provider,
  );
  const account = accounts.find((item) => item.id === connectionId);
  const selectAccount = (value: Account) => {
    setConnectionId(value.id);
    setSearch("");
    setError(null);
  };
  const discoverConnection = async (
    nextProvider: Provider,
    nextConnectionId: string,
    profile: string | null,
  ) => {
    const found = await bridge.discover(
      nextProvider,
      nextConnectionId,
      profile,
      nextProvider === "aws" ? region || null : null,
    );
    setResults((previous) => ({ ...previous, [nextConnectionId]: found }));
    if (nextProvider === "aws") setAwsProfiles(found.awsProfiles);
  };
  const createAccount = async (label: string, profile: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const created = await bridge.createConnection(provider, label, profile);
      await reload();
      selectAccount(created);
      try {
        await discoverConnection(
          created.provider,
          created.id,
          created.profile ?? null,
        );
      } catch (cause) {
        setError(
          `연결은 추가했지만 대상을 확인하지 못했습니다. ${errorMessage(cause)}`,
        );
      }
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const removeAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await bridge.removeConnection(connectionId);
      setLogins((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id]) => id !== connectionId),
        ),
      );
      setResults((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id]) => id !== connectionId),
        ),
      );
      setTargetChanges((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(
            ([, change]) => change.target.connectionId !== connectionId,
          ),
        ),
      );
      setConnectionId(
        saved.accounts.find((item) => item.provider === provider)?.id ?? "",
      );
      await reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const loadProfiles = async () => {
    setBusy(true);
    setError(null);
    try {
      setAwsProfiles(
        (await bridge.discover("aws", null, null, null)).awsProfiles,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const discover = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!connectionId) return;
      await discoverConnection(
        provider,
        connectionId,
        account?.profile ?? null,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const beginLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await bridge.login(
        provider,
        connectionId,
        account?.profile ?? null,
      );
      setLogins((previous) => ({ ...previous, [connectionId]: status }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    if (await onSave({ ...snapshot.settings, targets: selected })) {
      onClose();
      void onRefresh();
    } else {
      setError("설정을 저장하지 못했습니다. 다시 시도해 주세요.");
      setBusy(false);
    }
  };
  const toggle = (target: Target) =>
    setTargetChanges((previous) => ({
      ...previous,
      [targetKey(target)]: {
        target,
        selected: !selected.some(
          (item) => targetKey(item) === targetKey(target),
        ),
      },
    }));
  const result = results[connectionId];
  const connection =
    result?.connection ??
    snapshot.connections.find((item) => item.connectionId === connectionId);
  const mergedTargets = [
    ...(result?.targets ?? []),
    ...[...snapshot.settings.targets, ...selected].filter(
      (target) =>
        target.connectionId === connectionId &&
        !result?.targets.some((item) => targetKey(item) === targetKey(target)),
    ),
  ];
  const uniqueTargets = mergedTargets.filter(
    (target, index, all) =>
      all.findIndex((item) => targetKey(item) === targetKey(target)) === index,
  );
  const targets = uniqueTargets.filter((target) =>
    `${target.name} ${target.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const catalog = PROVIDERS.filter((item) =>
    `${PROVIDER_NAMES[item]} ${item}`
      .toLocaleLowerCase()
      .includes(providerSearch.trim().toLocaleLowerCase()),
  );
  const activeCatalogProvider = catalog.includes(provider)
    ? provider
    : catalog[0];
  const selectProvider = (nextProvider: Provider) => {
    setProvider(nextProvider);
    setConnectionId(
      snapshot.settings.accounts.find(
        (account) => account.provider === nextProvider,
      )?.id ?? "",
    );
    setSearch("");
    setError(null);
  };
  const handleProviderKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentProvider: Provider,
  ) => {
    const currentIndex = catalog.indexOf(currentProvider);
    const offsets: Partial<Record<string, number>> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const offset = offsets[event.key];
    let nextProvider: Provider | undefined;

    if (event.key === "Home") nextProvider = catalog[0];
    else if (event.key === "End") nextProvider = catalog[catalog.length - 1];
    else if (offset !== undefined && currentIndex >= 0) {
      nextProvider =
        catalog[(currentIndex + offset + catalog.length) % catalog.length];
    }
    if (!nextProvider) return;

    event.preventDefault();
    selectProvider(nextProvider);
    window.requestAnimationFrame(() => {
      dialog.current
        ?.querySelector<HTMLButtonElement>(`#provider-tab-${nextProvider}`)
        ?.focus();
    });
  };
  const canConnect = Boolean(account) && !details.unsupportedMessage;
  return (
    <dialog
      ref={dialog}
      className="connections-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="connections-title"
    >
      <div className="dialog-header">
        <div>
          <h2 id="connections-title">서비스 연결</h2>
          <p>이 기기의 기존 인증을 읽기 전용으로 사용합니다.</p>
        </div>
        <button
          className="icon-button"
          aria-label="설정 닫기"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div
        className="dialog-body"
        tabIndex={0}
        aria-label="서비스 연결 설정 내용"
      >
        <div className="provider-catalog">
          <label className="search-box provider-search">
            <Search size={15} />
            <input
              aria-label="플랫폼 검색"
              value={providerSearch}
              placeholder="플랫폼 검색"
              onChange={(event) => setProviderSearch(event.target.value)}
            />
          </label>
          <div
            className="provider-tabs"
            role="tablist"
            aria-label="연결 서비스"
          >
            {catalog.map((item) => (
              <button
                id={`provider-tab-${item}`}
                key={item}
                role="tab"
                aria-controls="connection-provider-panel"
                aria-selected={provider === item}
                tabIndex={activeCatalogProvider === item ? 0 : -1}
                disabled={busy}
                onClick={() => selectProvider(item)}
                onKeyDown={(event) => handleProviderKeyDown(event, item)}
              >
                <ProviderIcon provider={item} />
                {PROVIDER_NAMES[item]}
              </button>
            ))}
            {catalog.length === 0 && (
              <p className="catalog-empty" role="status">
                일치하는 플랫폼이 없습니다.
              </p>
            )}
          </div>
        </div>
        <section
          id="connection-provider-panel"
          className="connection-provider-panel"
          role="tabpanel"
          aria-label={`${PROVIDER_NAMES[provider]} 연결 설정`}
        >
          {!details.unsupportedMessage && (
            <section
              className="connection-guide"
              aria-labelledby="connection-guide-title"
            >
              <h3 id="connection-guide-title">연결 순서</h3>
              <ol>
                <li>
                  <span>1</span>
                  <div>
                    <strong>연결 준비</strong>
                    <p>
                      {connection?.status === "connected" && account ? (
                        <>
                          현재 선택한 ‘{account.label}’ 연결의 기존 인증을
                          재사용합니다. 다시 로그인할 필요가 없습니다.
                        </>
                      ) : provider === "aws" ? (
                        account ? (
                          <>
                            선택한 ‘{account.profile ?? account.label}’ 프로필과
                            리전을 확인한 뒤 앱의 ‘SSO 로그인’을 사용하세요.
                            터미널에서 직접 로그인할 때는{" "}
                            <code>aws sso login --profile &lt;프로필&gt;</code>
                            을 실행합니다.
                          </>
                        ) : (
                          <>기존 AWS 프로필을 불러오거나 추가해 주세요.</>
                        )
                      ) : account?.mode === "isolated" ? (
                        <>
                          앱의 ‘브라우저로 로그인’을 사용해 이 연결만
                          인증하세요. 기존 {PROVIDER_NAMES[provider]} CLI 기본
                          세션은 바뀌지 않습니다.
                        </>
                      ) : account && details.cliCommand ? (
                        <>
                          선택한 기존 CLI 연결을 사용합니다. 세션이 없거나
                          만료됐을 때만 터미널에서{" "}
                          <code>{details.cliCommand}</code>을 실행하세요.
                        </>
                      ) : details.cliCommand ? (
                        <>
                          터미널에서 <code>{details.cliCommand}</code>을 완료한
                          뒤 ‘CLI 세션 연결’을 선택하세요.
                        </>
                      ) : (
                        details.connectionSummary
                      )}
                    </p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>연결 확인</strong>
                    <p>선택한 연결로 조회 가능한 대상을 불러옵니다.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>대상 선택 및 저장</strong>
                    <p>모니터링할 대상만 선택해 설정을 저장하세요.</p>
                  </div>
                </li>
              </ol>
              <p className="read-only-note">
                Crowline은 배포 상태만 조회하며 배포를 변경하지 않습니다.
              </p>
            </section>
          )}
          <AccountPicker
            key={provider}
            provider={provider}
            accounts={accounts}
            selectedId={connectionId}
            busy={busy}
            profiles={awsProfiles}
            onSelect={selectAccount}
            onCreate={createAccount}
            onRemove={removeAccount}
            onLoadProfiles={loadProfiles}
          />
          {!details.unsupportedMessage && (
            <>
              <div className="connection-state" role="status">
                <span
                  aria-hidden="true"
                  className={`connection-dot ${connection?.status === "connected" ? "connected" : ""}`}
                />
                <div>
                  <strong>
                    {connection?.account ?? "연결을 확인해 주세요"}
                  </strong>
                  <p>
                    {connection?.message ??
                      (connection?.status === "connected"
                        ? "기존 인증을 사용합니다. 토큰 입력이 필요하지 않아요."
                        : "아래 버튼으로 로그인과 조회 가능한 대상을 확인하세요.")}
                  </p>
                </div>
              </div>
              {provider === "aws" && account && (
                <div className="aws-fields">
                  <label>
                    프로필
                    <input value={account.profile ?? ""} readOnly />
                  </label>
                  <label>
                    리전
                    <input
                      value={region}
                      onChange={(event) => setRegion(event.target.value)}
                      placeholder="ap-northeast-2"
                    />
                  </label>
                </div>
              )}
              <div className="connection-actions">
                <button
                  className="button primary"
                  onClick={() => void discover()}
                  disabled={busy || !canConnect}
                >
                  {busy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Search size={15} />
                  )}
                  연결 및 대상 확인
                </button>
                {details.canStartAppLogin && (
                  <button
                    className="button"
                    onClick={() => void beginLogin()}
                    disabled={
                      busy ||
                      !canConnect ||
                      (login?.connectionId === connectionId &&
                        login.state === "waiting")
                    }
                  >
                    {provider === "aws" ? "SSO 로그인" : "브라우저로 로그인"}
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
              {login?.connectionId === connectionId && (
                <div
                  className={`notice ${login.state === "error" ? "warning" : ""}`}
                  role="status"
                >
                  <span>{login.message}</span>
                  {login.code && (
                    <code className="device-code">{login.code}</code>
                  )}
                  {login.url && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void bridge
                          .open(login.url!)
                          .catch((cause: unknown) =>
                            setError(errorMessage(cause)),
                          )
                      }
                    >
                      인증 페이지 열기 <ArrowUpRight size={13} />
                    </button>
                  )}
                  {login.state === "complete" && (
                    <button
                      className="text-button"
                      onClick={() => void discover()}
                    >
                      조회 대상 불러오기
                    </button>
                  )}
                </div>
              )}
              {result?.issues.map((issue, index) => (
                <div
                  className="notice warning"
                  key={`${issue.provider}-${index}`}
                  role="status"
                >
                  {issue.message}
                </div>
              ))}
              <div className="target-heading">
                <h3>
                  모니터링 대상 <span>{uniqueTargets.length}</span>
                </h3>
                <span>
                  {
                    selected.filter(
                      (target) => target.connectionId === connectionId,
                    ).length
                  }
                  개 선택
                </span>
              </div>
              {mergedTargets.length > 0 && (
                <label className="search-box target-search">
                  <Search size={15} />
                  <input
                    aria-label="대상 검색"
                    value={search}
                    placeholder="이름으로 검색"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              )}
              <div className="target-list">
                {targets.length ? (
                  targets.map((target) => (
                    <label key={targetKey(target)} className="target-option">
                      <input
                        type="checkbox"
                        checked={selected.some(
                          (item) => targetKey(item) === targetKey(target),
                        )}
                        onChange={() => toggle(target)}
                      />
                      <div>
                        <strong>{target.name}</strong>
                        <span>
                          {target.description ||
                            PROVIDER_NAMES[target.provider]}
                        </span>
                      </div>
                    </label>
                  ))
                ) : (
                  <p className="targets-empty">
                    {result
                      ? "조회할 수 있는 대상이 없습니다. 계정·권한·리전을 확인해 주세요."
                      : "연결을 확인하면 선택할 수 있는 대상이 여기에 표시됩니다."}
                  </p>
                )}
              </div>
              {!details.supportsActorAttribution && (
                <p className="field-help">
                  실행자 정보가 확인되지 않을 수 있습니다. “내 실행”에서 보이지
                  않는 항목은 전체 실행에서 확인해 주세요.
                </p>
              )}
            </>
          )}
          {error && (
            <div className="notice warning" role="alert">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </section>
      </div>
      <div className="dialog-footer">
        <span>총 {selected.length}개 대상</span>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          <Check size={16} />
          설정 저장
        </button>
      </div>
    </dialog>
  );
}
