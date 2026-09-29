import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PROVIDER_NAMES, type Account, type Provider } from "../domain";

interface Props {
  provider: Provider;
  accounts: Account[];
  selectedId: string;
  busy: boolean;
  profiles: string[];
  onSelect: (account: Account) => void;
  onCreate: (label: string, profile: string | null) => Promise<boolean>;
  onRemove: () => Promise<void>;
  onLoadProfiles: () => Promise<void>;
}
export function AccountPicker({
  provider,
  accounts,
  selectedId,
  busy,
  profiles,
  onSelect,
  onCreate,
  onRemove,
  onLoadProfiles,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState("");
  const add = async () => {
    if (
      await onCreate(
        label.trim() || profile.trim() || `${PROVIDER_NAMES[provider]} 계정`,
        provider === "aws" ? profile.trim() : null,
      )
    ) {
      setAdding(false);
      setLabel("");
      setProfile("");
    }
  };
  return (
    <div className="account-picker">
      {accounts.length > 0 && (
        <div className="account-picker-row">
          <label>
            계정 연결
            <select
              aria-label="연결할 계정"
              value={selectedId}
              disabled={busy}
              onChange={(event) => {
                const account = accounts.find(
                  (item) => item.id === event.target.value,
                );
                if (account) onSelect(account);
              }}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.label}
                  {account.profile ? ` · ${account.profile}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="계정 추가"
            disabled={busy}
            onClick={() => setAdding(!adding)}
          >
            <Plus size={16} />
          </button>
          {selectedId !== "github:local" && selectedId !== "vercel:local" && (
            <button
              className="icon-button"
              aria-label="이 계정 연결 제거"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      {(adding || accounts.length === 0) && (
        <div className="account-create">
          <label>
            계정 이름
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="개인 / 회사"
              maxLength={80}
            />
          </label>
          {provider === "aws" && (
            <>
              <label>
                AWS 프로필
                <input
                  list="new-aws-profiles"
                  value={profile}
                  onChange={(event) => setProfile(event.target.value)}
                  placeholder="development"
                  maxLength={128}
                />
              </label>
              <datalist id="new-aws-profiles">
                {profiles.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void onLoadProfiles()}
              >
                로컬 프로필 불러오기
              </button>
            </>
          )}
          <button
            className="button"
            disabled={busy || (provider === "aws" && !profile.trim())}
            onClick={() => void add()}
          >
            {provider === "aws" ? "프로필 연결 추가" : "계정 연결 추가"}
          </button>
          {provider !== "aws" && (
            <p>
              추가한 계정은 아래 로그인 버튼으로 연결합니다. 기존 CLI 계정은
              바뀌지 않습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
