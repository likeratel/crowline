import { useEffect, useRef, useState } from "react";
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
import { selectedTargets, type TargetChanges } from "../targetSelection";
interface Props {
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (settings: Settings) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}
export function Connections({ snapshot, onClose, onSave, onRefresh }: Props) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logins, setLogins] = useState<Partial<Record<string, LoginStatus>>>(
    {},
  );
  const login = logins[connectionId];
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
  const createAccount = async (label: string, profile: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const created = await bridge.createConnection(provider, label, profile);
      await onRefresh();
      selectAccount(created);
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
      await onRefresh();
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
      const found = await bridge.discover(
        provider,
        connectionId || null,
        account?.profile ?? null,
        region || null,
      );
      setResults((previous) => ({ ...previous, [connectionId]: found }));
      if (provider === "aws") setAwsProfiles(found.awsProfiles);
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
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2 id="connections-title">서비스 연결</h2>
          <p>기존 로그인을 사용하고, 보고 싶은 대상만 선택하세요.</p>
        </div>
        <button
          className="icon-button"
          aria-label="설정 닫기"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="provider-tabs" role="tablist" aria-label="연결 서비스">
        {PROVIDERS.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={provider === item}
            disabled={busy}
            onClick={() => {
              setProvider(item);
              setConnectionId(
                snapshot.settings.accounts.find(
                  (account) => account.provider === item,
                )?.id ?? "",
              );
              setSearch("");
              setError(null);
            }}
          >
            <ProviderIcon provider={item} />
            {PROVIDER_NAMES[item]}
          </button>
        ))}
      </div>
      <div className="dialog-body">
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
        <div className="connection-state">
          <span
            className={`connection-dot ${connection?.status === "connected" ? "connected" : ""}`}
          />
          <div>
            <strong>{connection?.account ?? "연결을 확인해 주세요"}</strong>
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
            disabled={busy || !account}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Search size={15} />
            )}
            연결 및 대상 확인
          </button>
          <button
            className="button"
            onClick={() => void beginLogin()}
            disabled={
              busy ||
              !account ||
              (login?.connectionId === connectionId &&
                login.state === "waiting")
            }
          >
            {provider === "aws" ? "SSO 로그인" : "브라우저로 로그인"}
            <ArrowUpRight size={14} />
          </button>
        </div>
        {login?.connectionId === connectionId && (
          <div
            className={`notice ${login.state === "error" ? "warning" : ""}`}
            role="status"
          >
            <span>{login.message}</span>
            {login.code && <code className="device-code">{login.code}</code>}
            {login.url && (
              <button
                className="text-button"
                onClick={() =>
                  void bridge
                    .open(login.url!)
                    .catch((cause: unknown) => setError(errorMessage(cause)))
                }
              >
                인증 페이지 열기 <ArrowUpRight size={13} />
              </button>
            )}
            {login.state === "complete" && (
              <button className="text-button" onClick={() => void discover()}>
                조회 대상 불러오기
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="notice warning" role="alert">
            <AlertCircle size={16} />
            {error}
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
              selected.filter((target) => target.connectionId === connectionId)
                .length
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
                    {target.description || PROVIDER_NAMES[target.provider]}
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
        {provider === "aws" && (
          <p className="field-help">
            CloudFormation과 ECS를 조회합니다. 공용 역할의 실행자는 미확인으로
            표시됩니다.
          </p>
        )}
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
