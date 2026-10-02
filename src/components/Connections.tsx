import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ArrowUpRight, LoaderCircle, Search } from "lucide-react";
import { bridge, errorMessage } from "../bridge";
import {
  PROVIDERS,
  PROVIDER_NAMES,
  targetKey,
  type Account,
  type Discovery,
  type LoginStatus,
  type Provider,
  type Snapshot,
  type Target,
} from "../domain";
import { ProviderIcon } from "./ProviderIcon";
import { AccountPicker } from "./AccountPicker";
import { getPlatformDetails } from "../platformDetails";
import { useSettingsChanges } from "../settingsChangesContext";
import { SettingFeedback } from "./SettingFeedback";
import { accountDisplayName } from "../accountNames";
import { useI18n } from "../i18n";
import { settingsCopy } from "../settingsCopy";
import { targetsChangedByBulkSelection } from "./connectionTargets";
interface Props {
  snapshot: Snapshot;
  saving?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onReload?: () => Promise<void>;
}
export function Connections({
  snapshot,
  saving = false,
  onBusyChange,
  onRefresh,
  onReload,
}: Props) {
  const { locale, t } = useI18n();
  const { change, failures, pendingKeys } = useSettingsChanges();
  const [provider, setProvider] = useState<Provider>("github");
  const [connectionId, setConnectionId] = useState(
    snapshot.settings.accounts.find((account) => account.provider === "github")
      ?.id ?? "",
  );
  const [awsProfiles, setAwsProfiles] = useState<string[]>([]);
  const [results, setResults] = useState<Partial<Record<string, Discovery>>>(
    {},
  );
  const selected = snapshot.settings.targets;
  const [knownTargets, setKnownTargets] = useState(snapshot.settings.targets);
  useEffect(() => {
    setKnownTargets((previous) => {
      const retained = previous.filter((target) =>
        snapshot.settings.accounts.some(
          (account) => account.id === target.connectionId,
        ),
      );
      return [
        ...retained.filter(
          (target) =>
            !snapshot.settings.targets.some(
              (item) => targetKey(item) === targetKey(target),
            ),
        ),
        ...snapshot.settings.targets,
      ];
    });
  }, [snapshot.settings.targets, snapshot.settings.accounts]);
  const [region, setRegion] = useState("ap-northeast-2");
  const [search, setSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const bulkSavePending = useRef(false);
  const working = busy || saving || bulkSaving;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const [error, setError] = useState<string | null>(null);
  const [pendingBitbucket, setPendingBitbucket] = useState<Account | null>(
    null,
  );
  const [logins, setLogins] = useState<Partial<Record<string, LoginStatus>>>(
    {},
  );
  const login = logins[connectionId];
  const details = getPlatformDetails(provider, locale);
  const reload = onReload ?? onRefresh;
  const dialog = useRef<HTMLElement>(null);
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
      nextProvider === "aws" ? profile : null,
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
          t("connections.addedDiscoveryFailed", { error: errorMessage(cause) }),
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
  const connectBitbucket = async (
    email: string,
    token: string,
    id: string | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const connected = await bridge.connectBitbucket(email, token, id);
      try {
        await reload();
      } catch {
        setPendingBitbucket(connected);
        return true;
      }
      selectAccount(connected);
      try {
        await discoverConnection("bitbucket", connected.id, null);
      } catch (cause) {
        setError(
          t("connections.addedDiscoveryFailed", { error: errorMessage(cause) }),
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
  const retryBitbucketReload = async () => {
    if (!pendingBitbucket || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reload();
      selectAccount(pendingBitbucket);
      setPendingBitbucket(null);
      try {
        await discoverConnection("bitbucket", pendingBitbucket.id, null);
      } catch (cause) {
        setError(
          t("connections.addedDiscoveryFailed", { error: errorMessage(cause) }),
        );
      }
    } catch {
      setError(t("bitbucket.reloadFailed"));
    } finally {
      setBusy(false);
    }
  };
  const removeAccount = async (): Promise<boolean> => {
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
      setConnectionId(
        saved.accounts.find((item) => item.provider === provider)?.id ?? "",
      );
      await reload();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
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
  const toggle = (target: Target) => {
    void change({
      kind: "target",
      target,
      selected: !selected.some((item) => targetKey(item) === targetKey(target)),
    }).then((saved) => {
      if (saved) void onRefresh();
    });
  };
  const result = results[connectionId];
  const connection =
    result?.connection ??
    snapshot.connections.find((item) => item.connectionId === connectionId);
  const mergedTargets = [
    ...(result?.targets ?? []),
    ...knownTargets.filter(
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
  const selectedTargetKeys = new Set(selected.map(targetKey));
  const allVisibleSelected =
    targets.length > 0 &&
    targets.every((target) => selectedTargetKeys.has(targetKey(target)));
  const anyVisibleSelected = targets.some((target) =>
    selectedTargetKeys.has(targetKey(target)),
  );
  const currentTargetPrefix = `${provider}:${connectionId}:`;
  const bulkFeedbackKeys = [
    ...pendingKeys.filter(
      (key) =>
        key.startsWith(`targets:${currentTargetPrefix}`) ||
        key.includes(`|${currentTargetPrefix}`),
    ),
    ...Object.entries(failures).flatMap(([key, failure]) =>
      failure.change.kind === "targets" &&
      failure.change.targets.every(
        (target) =>
          target.provider === provider && target.connectionId === connectionId,
      )
        ? [key]
        : [],
    ),
  ].filter((key, index, all) => all.indexOf(key) === index);
  const setVisibleTargetsSelected = async (shouldSelect: boolean) => {
    if (bulkSavePending.current || targets.length === 0) return;
    const changedTargets = targetsChangedByBulkSelection(
      targets,
      selectedTargetKeys,
      shouldSelect,
    );
    if (changedTargets.length === 0) return;
    bulkSavePending.current = true;
    setBulkSaving(true);
    setError(null);
    try {
      const bulkChange = {
        kind: "targets" as const,
        targets: changedTargets,
        selected: shouldSelect,
      };
      if (await change(bulkChange)) await onRefresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      bulkSavePending.current = false;
      setBulkSaving(false);
    }
  };
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
    <section
      ref={dialog}
      className="connections-settings"
      aria-label={t("connections.title")}
    >
      <div
        className="dialog-body"
        tabIndex={0}
        aria-label={t("connections.content")}
      >
        <div className="provider-catalog">
          <label className="search-box provider-search">
            <Search size={15} />
            <input
              aria-label={t("connections.searchPlatform")}
              value={providerSearch}
              placeholder={t("connections.searchPlatform")}
              onChange={(event) => setProviderSearch(event.target.value)}
            />
          </label>
          <div
            className="provider-tabs"
            role="tablist"
            aria-label={t("connections.services")}
          >
            {catalog.map((item) => (
              <button
                id={`provider-tab-${item}`}
                key={item}
                role="tab"
                aria-controls="connection-provider-panel"
                aria-selected={provider === item}
                tabIndex={activeCatalogProvider === item ? 0 : -1}
                disabled={working}
                onClick={() => selectProvider(item)}
                onKeyDown={(event) => handleProviderKeyDown(event, item)}
              >
                <ProviderIcon provider={item} />
                {PROVIDER_NAMES[item]}
              </button>
            ))}
            {catalog.length === 0 && (
              <p className="catalog-empty" role="status">
                {t("connections.noPlatforms")}
              </p>
            )}
          </div>
        </div>
        <section
          id="connection-provider-panel"
          className="connection-provider-panel"
          role="tabpanel"
          aria-label={t("connections.providerSettings", {
            provider: PROVIDER_NAMES[provider],
          })}
        >
          {provider === "bitbucket" && pendingBitbucket ? (
            <div className="notice warning" role="status">
              <span>{t("bitbucket.reloadFailed")}</span>
              <button
                className="button"
                disabled={working}
                onClick={() => void retryBitbucketReload()}
              >
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <AccountPicker
              key={provider}
              provider={provider}
              accounts={accounts}
              settings={snapshot.settings}
              connections={snapshot.connections.map((item) =>
                item.connectionId === connectionId && result?.connection
                  ? result.connection
                  : item,
              )}
              discoveredConnection={result?.connection}
              selectedId={connectionId}
              busy={working}
              profiles={awsProfiles}
              onSelect={selectAccount}
              onCreate={createAccount}
              onRemove={removeAccount}
              onConnectBitbucket={connectBitbucket}
              onLoadProfiles={loadProfiles}
              savedTargetCount={
                snapshot.settings.targets.filter(
                  (target) => target.connectionId === connectionId,
                ).length
              }
            />
          )}
          {!details.unsupportedMessage &&
            (provider !== "bitbucket" || account) && (
              <>
                <div className="connection-state" role="status">
                  <span
                    aria-hidden="true"
                    className={`connection-dot ${connection?.status === "connected" ? "connected" : ""}`}
                  />
                  <div>
                    <strong>
                      {account
                        ? accountDisplayName(
                            account,
                            snapshot.settings,
                            connection ? [connection] : [],
                          )
                        : t("connections.checkConnection")}
                    </strong>
                    {connection?.status !== "connected" &&
                      connection?.message && <p>{connection.message}</p>}
                  </div>
                </div>
                {provider !== "bitbucket" && (
                  <details className="connection-help">
                    <summary>{settingsCopy(locale, "connectionHelp")}</summary>
                    <p>
                      {provider === "aws"
                        ? account
                          ? t("connections.awsSelected", {
                              profile: account.profile ?? account.label,
                              command: "aws sso login --profile <profile>",
                            })
                          : t("connections.awsAdd")
                        : account?.mode === "isolated"
                          ? t("connections.appLogin", {
                              provider: PROVIDER_NAMES[provider],
                            })
                          : details.cliCommand
                            ? t("connections.completeCli", {
                                command: details.cliCommand,
                              })
                            : details.connectionSummary}
                    </p>
                  </details>
                )}
                {provider === "aws" && account && (
                  <div className="aws-fields">
                    <label>
                      {t("connections.profile")}
                      <input value={account.profile ?? ""} readOnly />
                    </label>
                    <label>
                      {t("connections.region")}
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
                    {t("connections.verifyTargets")}
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
                      {provider === "aws"
                        ? t("connections.ssoLogin")
                        : t("connections.browserLogin")}
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
                        {t("connections.openAuth")} <ArrowUpRight size={13} />
                      </button>
                    )}
                    {login.state === "complete" && (
                      <button
                        className="text-button"
                        onClick={() => void discover()}
                      >
                        {t("connections.loadTargets")}
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
                    {t("connections.targets")}{" "}
                    <span>{uniqueTargets.length}</span>
                  </h3>
                  <span>
                    {t("common.selectedCount", {
                      count: selected.filter(
                        (target) => target.connectionId === connectionId,
                      ).length,
                    })}
                  </span>
                </div>
                {mergedTargets.length > 0 && (
                  <div className="target-controls">
                    <label className="search-box target-search">
                      <Search size={15} />
                      <input
                        aria-label={t("connections.searchTargets")}
                        value={search}
                        placeholder={t("connections.searchByName")}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <div className="target-bulk-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={
                          working || targets.length === 0 || allVisibleSelected
                        }
                        onClick={() => void setVisibleTargetsSelected(true)}
                      >
                        {t("connections.selectAllVisible")}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={working || !anyVisibleSelected}
                        onClick={() => void setVisibleTargetsSelected(false)}
                      >
                        {t("connections.deselectAllVisible")}
                      </button>
                      {bulkFeedbackKeys.map((key) => (
                        <SettingFeedback key={key} changeKey={key} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="target-list">
                  {targets.length ? (
                    targets.map((target) => (
                      <label key={targetKey(target)} className="target-option">
                        <input
                          type="checkbox"
                          disabled={working}
                          checked={selected.some(
                            (item) => targetKey(item) === targetKey(target),
                          )}
                          onChange={() => toggle(target)}
                        />
                        <div>
                          <strong>{target.name}</strong>
                          {target.description && (
                            <span>{target.description}</span>
                          )}
                          <SettingFeedback
                            changeKey={`target:${targetKey(target)}`}
                          />
                        </div>
                      </label>
                    ))
                  ) : (
                    <p className="targets-empty">
                      {result
                        ? t("connections.noTargets")
                        : t("connections.verifyFirst")}
                    </p>
                  )}
                </div>
                {!details.supportsActorAttribution && (
                  <p className="field-help">{t("connections.actorHelp")}</p>
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
    </section>
  );
}
