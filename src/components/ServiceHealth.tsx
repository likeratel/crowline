import { accountDisplayName } from "../accountNames";
import { PROVIDER_NAMES, targetKey, type Snapshot } from "../domain";
import { useI18n } from "../i18n";
import { copy, type FeatureKey } from "../featureCopy";
import { ProviderIcon } from "./ProviderIcon";
export function ServiceHealth({
  snapshot,
  onConnect,
}: {
  snapshot: Snapshot;
  onConnect: () => void;
}) {
  const { locale } = useI18n();
  const accounts = snapshot.settings.accounts.filter((account) =>
    snapshot.settings.targets.some(
      (target) => target.connectionId === account.id,
    ),
  );
  if (!accounts.length) return null;
  return (
    <details className="service-health">
      <summary>
        {copy(locale, "health")}
        {snapshot.issues.length > 0
          ? ` · ${copy(locale, "issuesCount", { count: snapshot.issues.length })}`
          : ""}
        {snapshot.refreshing ? ` · ${copy(locale, "checking")}` : ""}
      </summary>
      {accounts.map((account) => {
        const targets = snapshot.settings.targets.filter(
          (target) => target.connectionId === account.id,
        );
        const pending = targets.filter((target) =>
          snapshot.pendingTargets.includes(targetKey(target)),
        ).length;
        const connection = snapshot.connections.find(
          (item) => item.connectionId === account.id,
        );
        const issues = snapshot.issues.filter(
          (issue) =>
            issue.connectionId === account.id ||
            (!issue.connectionId && issue.provider === account.provider),
        );
        const key: FeatureKey =
          connection?.status === "signed-out"
            ? "signedOut"
            : connection?.status === "missing-cli"
              ? "missingCli"
              : connection?.status === "error"
                ? "connectionError"
                : pending
                  ? "checking"
                  : issues.length
                    ? "partial"
                    : targets.every((target) =>
                          snapshot.history.some(
                            (history) =>
                              history.connectionId === target.connectionId &&
                              history.targetId === target.id,
                          ),
                        )
                      ? "checked"
                      : connection?.status === "connected"
                        ? "connected"
                        : "notChecked";
        const help: FeatureKey =
          key === "signedOut"
            ? "loginHelp"
            : key === "missingCli"
              ? "cliHelp"
              : "errorHelp";
        const needsHelp =
          issues.length > 0 ||
          ["signedOut", "missingCli", "connectionError"].includes(key);
        return (
          <section className="service-health-row" key={account.id}>
            <div className="service-health-title">
              <ProviderIcon provider={account.provider} />
              <strong>
                {PROVIDER_NAMES[account.provider]} ·{" "}
                {accountDisplayName(
                  account,
                  snapshot.settings,
                  snapshot.connections,
                )}
              </strong>
              <span role="status">{copy(locale, key)}</span>
            </div>
            {pending > 0 && (
              <p>{copy(locale, "pendingCount", { count: pending })}</p>
            )}
            {needsHelp && (
              <>
                <p>{copy(locale, help)}</p>
                <button className="text-button" onClick={onConnect}>
                  {copy(locale, "reconnect")}
                </button>
                <details>
                  <summary>{copy(locale, "details")}</summary>
                  {connection?.message && <p>{connection.message}</p>}
                  {issues.map((issue, index) => (
                    <p key={index}>{issue.message}</p>
                  ))}
                </details>
              </>
            )}
          </section>
        );
      })}
    </details>
  );
}
