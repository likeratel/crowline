import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, LoaderCircle, Search } from "lucide-react";
import { bridge, errorMessage } from "../bridge";
import {
  PROVIDER_NAMES,
  targetKey,
  type Account,
  type Discovery,
  type Connection,
  type LoginStatus,
  type Provider,
  type Snapshot,
} from "../domain";
import { ServiceSelector } from "./ServiceSelector";
import { AccountPicker } from "./AccountPicker";
import { getPlatformDetails } from "../platformDetails";
import { accountDisplayName } from "../accountNames";
import { useI18n } from "../i18n";
import { settingsCopy } from "../settingsCopy";
import { isGithubProvider } from "../cliAccounts";
import { GithubCliConnect } from "./GithubCliConnect";
import { LocalCliHelp } from "./LocalCliHelp";
import { ProjectSelection } from "./ProjectSelection";
import { useSettingsChanges } from "../settingsChangesContext";
import {
  ConnectionProgress,
  type ConnectionProgressAction,
} from "./ConnectionProgress";
import { copy } from "../featureCopy";
import { uxCopy } from "../uxCopy";
import "../styles/connection-progress.css";
interface Props {
  snapshot: Snapshot;
  saving?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onReload?: () => Promise<void>;
  requestedProvider?: Provider;
  requestedConnectionId?: string;
  connectionRequest?: number;
  onNotifications?: () => void;
}
export function Connections({
  snapshot,
  saving = false,
  onBusyChange,
  onRefresh,
  onReload,
  requestedProvider,
  requestedConnectionId,
  connectionRequest,
  onNotifications,
}: Props) {
  const { locale, t } = useI18n();
  const { pendingKeys } = useSettingsChanges();
  const [provider, setProvider] = useState<Provider>("github");
  const [connectionId, setConnectionId] = useState(
    snapshot.settings.accounts.find((account) => account.provider === "github")
      ?.id ?? "",
  );
  const [awsProfiles, setAwsProfiles] = useState<string[]>([]);
  const [results, setResults] = useState<
    Partial<Record<string, Discovery & { previousConnection: string }>>
  >({});
  const [knownTargets, setKnownTargets] = useState(snapshot.settings.targets);
  useEffect(() => {
    setKnownTargets((previous) => {
      const accountIds = new Set(
        snapshot.settings.accounts.map((account) => account.id),
      );
      const targetMap = new Map(
        snapshot.settings.targets.map((target) => [targetKey(target), target]),
      );
      const retained = previous.filter(
        (target) =>
          accountIds.has(target.connectionId) &&
          !targetMap.has(targetKey(target)),
      );
      const next = [...retained, ...targetMap.values()];
      return next.length === previous.length &&
        next.every((target, index) => target === previous[index])
        ? previous
        : next;
    });
  }, [snapshot.settings.targets, snapshot.settings.accounts]);
  const [discoveryErrors, setDiscoveryErrors] = useState<
    Record<string, string>
  >({});
  const [region, setRegion] = useState("ap-northeast-2");
  const [busy, setBusy] = useState(false);
  const [cliBusy, setCliBusy] = useState(false);
  const working = busy || saving || cliBusy;
  useEffect(() => {
    onBusyChange?.(busy || cliBusy);
  }, [busy, cliBusy, onBusyChange]);
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
    setError(null);
  };
  const discoverConnection = async (
    nextProvider: Provider,
    nextConnectionId: string,
    profile: string | null,
  ) => {
    try {
      const found = await bridge.discover(
        nextProvider,
        nextConnectionId,
        nextProvider === "aws" ? profile : null,
        nextProvider === "aws" ? region || null : null,
      );
      setResults((previous) => ({
        ...previous,
        [nextConnectionId]: {
          ...found,
          previousConnection: JSON.stringify(
            snapshot.connections.find(
              (item) => item.connectionId === nextConnectionId,
            ),
          ),
        },
      }));
      setDiscoveryErrors((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id]) => id !== nextConnectionId),
        ),
      );
      if (nextProvider === "aws") setAwsProfiles(found.awsProfiles);
    } catch (cause) {
      setDiscoveryErrors((previous) => ({
        ...previous,
        [nextConnectionId]: errorMessage(cause),
      }));
      throw cause;
    }
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
        provider === "aws" ? (account?.profile ?? null) : null,
      );
      setLogins((previous) => ({ ...previous, [connectionId]: status }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const result = results[connectionId];
  const snapshotConnection = snapshot.connections.find(
    (item) => item.connectionId === connectionId,
  );
  const newerSnapshot =
    result && JSON.stringify(snapshotConnection) !== result.previousConnection;
  const connection: Connection | undefined = newerSnapshot
    ? snapshotConnection
    : (result?.connection ?? snapshotConnection);
  const discoveryError = discoveryErrors[connectionId];
  const connected = connection?.status === "connected";
  const statusLabel = discoveryError
    ? uxCopy(locale, "verificationFailed")
    : copy(
        locale,
        connected
          ? "connected"
          : connection?.status === "signed-out"
            ? "signedOut"
            : connection?.status === "missing-cli"
              ? "missingCli"
              : connection?.status === "error"
                ? "connectionError"
                : "notChecked",
      );
  const uniqueTargets = useMemo(
    () => [
      ...new Map(
        [
          ...knownTargets.filter(
            (target) => target.connectionId === connectionId,
          ),
          ...(result?.targets ?? []),
        ].map((target) => [targetKey(target), target]),
      ).values(),
    ],
    [knownTargets, connectionId, result],
  );
  const selectProvider = (nextProvider: Provider) => {
    setProvider(nextProvider);
    setConnectionId(
      snapshot.settings.accounts.find(
        (account) => account.provider === nextProvider,
      )?.id ?? "",
    );
    setError(null);
  };
  useEffect(() => {
    if (requestedProvider) {
      setProvider(requestedProvider);
      setConnectionId(
        snapshot.settings.accounts.find(
          (item) =>
            item.provider === requestedProvider &&
            (!requestedConnectionId || item.id === requestedConnectionId),
        )?.id ?? "",
      );
      setError(null);
    }
  }, [requestedProvider, requestedConnectionId, connectionRequest]);
  const canConnect = Boolean(account) && !details.unsupportedMessage;
  const selectedTargets = snapshot.settings.targets.filter(
    (target) =>
      target.provider === provider && target.connectionId === connectionId,
  );
  const selectionPrefix = `${provider}:${connectionId}:`;
  const selectionPending = pendingKeys.some(
    (key) =>
      key.startsWith(`target:${selectionPrefix}`) ||
      key.startsWith(`targets:${selectionPrefix}`) ||
      key.includes(`|${selectionPrefix}`),
  );
  const handleProgressAction = (action: ConnectionProgressAction) => {
    if (working) return;
    if (action === "verify") {
      void discover();
      return;
    }
    if (action === "query") {
      void onRefresh().catch((cause: unknown) => setError(errorMessage(cause)));
      return;
    }
    const sectionId =
      action === "projects"
        ? "connection-project-controls"
        : action === "authentication"
          ? "connection-authentication"
          : "connection-account-controls";
    const section = document.getElementById(sectionId);
    if (action === "authentication" && section instanceof HTMLDetailsElement)
      section.open = true;
    const control =
      action === "authentication"
        ? (section?.querySelector<HTMLElement>(
            "select:not(:disabled), input:not(:disabled), button:not(:disabled)",
          ) ?? section?.querySelector<HTMLElement>(":scope > summary"))
        : action === "projects"
          ? (section?.querySelector<HTMLElement>(
              ".target-option input:not(:disabled)",
            ) ?? document.getElementById("connection-verify-control"))
          : section?.querySelector<HTMLElement>(
              "button:not(:disabled), select:not(:disabled), input:not(:disabled), summary",
            );
    control?.focus();
  };
  const progress = (
    <ConnectionProgress
      snapshot={snapshot}
      provider={provider}
      accountPresent={Boolean(account)}
      connection={connection}
      selectedTargets={selectedTargets}
      selectionPending={selectionPending}
      requiresCli={provider !== "aws" && Boolean(details.cliCommand)}
      verificationError={discoveryError}
      onAction={handleProgressAction}
    />
  );
  return (
    <section
      className="connections-settings"
      aria-label={t("connections.title")}
    >
      <div
        className="dialog-body"
        tabIndex={0}
        aria-label={t("connections.content")}
      >
        {!connected && (
          <p className="section-intro">{uxCopy(locale, "connectionIntro")}</p>
        )}
        <ServiceSelector
          provider={provider}
          disabled={working}
          onSelect={selectProvider}
        />
        <section
          id="connection-provider-panel"
          className="connection-provider-panel"
          tabIndex={-1}
          role="tabpanel"
          aria-label={t("connections.providerSettings", {
            provider: PROVIDER_NAMES[provider],
          })}
        >
          {!connected && (
            <header className="setup-step-heading">
              <span aria-hidden="true">1</span>
              <div>
                <h2>{uxCopy(locale, "accountStep")}</h2>
                <p>{uxCopy(locale, "accountHelp")}</p>
              </div>
            </header>
          )}
          <div id="connection-account-controls">
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
                connections={snapshot.connections}
                discoveredConnection={connection}
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
          </div>
          {(error || discoveryError) && (
            <div className="notice warning connection-error" role="alert">
              <AlertCircle size={16} />
              <span>{error || discoveryError}</span>
            </div>
          )}
          {!details.unsupportedMessage &&
            provider === "bitbucket" &&
            !account &&
            progress}
          {!details.unsupportedMessage &&
            (provider !== "bitbucket" || account) && (
              <>
                <div className="connection-overview">
                  <div className="connection-state" role="status">
                    <span
                      aria-hidden="true"
                      className={`connection-dot ${connected && !discoveryError ? "connected" : ""}`}
                    />
                    <div>
                      <strong>
                        <span className="connection-status-label">
                          {statusLabel} ·{" "}
                        </span>
                        {account
                          ? accountDisplayName(
                              account,
                              snapshot.settings,
                              connection ? [connection] : [],
                            )
                          : t("connections.checkConnection")}
                      </strong>
                      {connection?.account &&
                        account &&
                        connection.account !==
                          accountDisplayName(
                            account,
                            snapshot.settings,
                            connection ? [connection] : [],
                          ) && <p>{connection.account}</p>}
                      {connection?.status !== "connected" &&
                        connection?.message && <p>{connection.message}</p>}
                    </div>
                  </div>
                  <div className="connection-actions">
                    <button
                      id="connection-verify-control"
                      className={`button ${connected ? "" : "primary"}`}
                      onClick={() => void discover()}
                      disabled={working || !canConnect}
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
                </div>
                {progress}
                <div id="connection-project-controls">
                  <ProjectSelection
                    key={connectionId}
                    snapshot={snapshot}
                    provider={provider}
                    connectionId={connectionId}
                    uniqueTargets={uniqueTargets}
                    discovered={Boolean(result)}
                    disabled={working}
                    onRefresh={onRefresh}
                    onError={(cause) => setError(errorMessage(cause))}
                    onNotifications={onNotifications}
                  />
                </div>
                {provider !== "bitbucket" && (
                  <details
                    id="connection-authentication"
                    className="authentication-details"
                    key={`auth-${connectionId}`}
                    open={connection?.status !== "connected"}
                  >
                    <summary>{uxCopy(locale, "authentication")}</summary>
                    {isGithubProvider(provider) && account && (
                      <GithubCliConnect
                        key={connectionId}
                        provider={provider}
                        connectionId={connectionId}
                        username={account.cliUsername}
                        busy={busy || saving}
                        onBusyChange={setCliBusy}
                        onConnected={async () => {
                          await reload();
                          await discoverConnection(
                            provider,
                            connectionId,
                            null,
                          );
                        }}
                      />
                    )}
                    {!isGithubProvider(provider) && (
                      <details className="connection-help">
                        <summary>
                          {settingsCopy(locale, "connectionHelp")}
                        </summary>
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
                    <LocalCliHelp
                      key={provider}
                      provider={provider}
                      version={connection?.cliVersion}
                    />
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
                {!details.supportsActorAttribution && (
                  <p className="field-help">{t("connections.actorHelp")}</p>
                )}
              </>
            )}
        </section>
      </div>
    </section>
  );
}
