import { useState } from "react";
import {
  PROVIDERS,
  PROVIDER_NAMES,
  targetKey,
  type PanelSettings,
  type Settings,
} from "../domain";
import "../styles/preferences.css";

type Props = {
  settings: Settings;
  busy: boolean;
  error: string | null;
  onSave: (settings: Settings) => Promise<boolean>;
};

export function PanelPreferences({ settings, busy, error, onSave }: Props) {
  const [changes, setChanges] = useState<Partial<PanelSettings>>({});
  const [saved, setSaved] = useState(false);
  const panel = { ...settings.panel, ...changes };
  const change = (patch: Partial<PanelSettings>) => {
    setChanges((previous) => ({ ...previous, ...patch }));
    setSaved(false);
  };
  const save = async () => {
    const savedPanel = {
      ...panel,
      hiddenTargets: panel.hiddenTargets.filter((key) =>
        settings.targets.some((target) => targetKey(target) === key),
      ),
    };
    if (await onSave({ ...settings, panel: savedPanel })) {
      setChanges({});
      setSaved(true);
    }
  };
  return (
    <section className="panel-preferences" aria-label="상태바 표시 설정">
      <header className="main-header">
        <div>
          <div className="eyebrow">MENU BAR</div>
          <h1>상태바 표시 설정</h1>
          <p>상태바를 눌렀을 때 확인할 서비스와 프로젝트를 골라 주세요.</p>
        </div>
      </header>
      <p className="preferences-note">
        대시보드의 모니터링 대상은 그대로 유지됩니다. 실행자 범위는 배포 현황의
        ‘내 실행만 / 전체 실행’ 설정을 따릅니다.
      </p>
      <fieldset disabled={busy}>
        <legend>표시할 서비스</legend>
        {PROVIDERS.filter((provider) =>
          settings.accounts.some((account) => account.provider === provider),
        ).map((provider) => (
          <label key={provider} className="preference-option">
            <input
              type="checkbox"
              checked={panel.providers.includes(provider)}
              onChange={(event) =>
                change({
                  providers: event.target.checked
                    ? [...panel.providers, provider]
                    : panel.providers.filter((item) => item !== provider),
                })
              }
            />
            {PROVIDER_NAMES[provider]}
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>표시할 프로젝트</legend>
        {settings.targets.length === 0 && (
          <p>‘연결 및 설정’에서 모니터링 대상을 먼저 추가해 주세요.</p>
        )}
        {settings.targets.map((target) => {
          const key = targetKey(target);
          const account = settings.accounts.find(
            (item) => item.id === target.connectionId,
          );
          return (
            <label key={key} className="preference-option">
              <input
                type="checkbox"
                disabled={!panel.providers.includes(target.provider)}
                checked={!panel.hiddenTargets.includes(key)}
                onChange={(event) =>
                  change({
                    hiddenTargets: event.target.checked
                      ? panel.hiddenTargets.filter((item) => item !== key)
                      : [...panel.hiddenTargets, key],
                  })
                }
              />
              <span>
                {target.name}
                <small>
                  {PROVIDER_NAMES[target.provider]} ·{" "}
                  {account?.label ?? target.connectionId}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>요약 구성</legend>
        <label className="preference-option">
          <input
            type="checkbox"
            checked={panel.showActive}
            onChange={(event) => change({ showActive: event.target.checked })}
          />
          진행 중 표시
        </label>
        <label className="preference-option">
          <input
            type="checkbox"
            checked={panel.showCompleted}
            onChange={(event) =>
              change({ showCompleted: event.target.checked })
            }
          />
          최근 종료 표시
        </label>
        <label className="preference-option">
          섹션별 표시 건수
          <select
            className="period-select"
            value={panel.rowLimit}
            onChange={(event) =>
              change({ rowLimit: Number(event.target.value) })
            }
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map(
              (count) => (
                <option key={count} value={count}>
                  {count}개
                </option>
              ),
            )}
          </select>
        </label>
        <p>
          상태 미확인과 조회 오류는 별도로 안내합니다. Vercel BLOCKED와 시작 후
          24시간을 넘긴 진행·대기 항목은 표시하지 않습니다.
        </p>
      </fieldset>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <div className="preferences-save">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          표시 설정 저장
        </button>
        {saved && <span role="status">상태바 표시 설정을 저장했습니다.</span>}
      </div>
    </section>
  );
}
