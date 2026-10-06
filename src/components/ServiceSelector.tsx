import { useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { PROVIDERS, PROVIDER_NAMES, type Provider } from "../domain";
import { useI18n } from "../i18n";
import { uxCopy } from "../uxCopy";
import { getPlatformDetails } from "../platformDetails";
import { ProviderIcon } from "./ProviderIcon";

export function ServiceSelector({
  provider,
  disabled,
  onSelect,
}: {
  provider: Provider;
  disabled: boolean;
  onSelect: (provider: Provider) => void;
}) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const catalogRef = useRef<HTMLDivElement>(null);
  const catalog = PROVIDERS.filter((item) =>
    `${PROVIDER_NAMES[item]} ${item}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const active = catalog.includes(provider) ? provider : catalog[0];
  const choose = (value: Provider, focusPanel = false) => {
    onSelect(value);
    setOpen(false);
    if (focusPanel)
      requestAnimationFrame(() =>
        document
          .getElementById("connection-provider-panel")
          ?.focus({ preventScroll: true }),
      );
  };
  const keyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: Provider,
  ) => {
    const index = catalog.indexOf(current);
    const offsets: Partial<Record<string, number>> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const offset = offsets[event.key];
    const next =
      event.key === "Home"
        ? catalog[0]
        : event.key === "End"
          ? catalog[catalog.length - 1]
          : offset !== undefined && index >= 0
            ? catalog[(index + offset + catalog.length) % catalog.length]
            : undefined;
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    requestAnimationFrame(() =>
      catalogRef.current
        ?.querySelector<HTMLButtonElement>(`#provider-tab-${next}`)
        ?.focus(),
    );
  };
  const unsupportedLabel = (value: Provider) =>
    getPlatformDetails(value, locale).unsupportedMessage
      ? uxCopy(locale, "unsupported")
      : "";
  return (
    <>
      <div className="service-selector">
        <label>
          <span>{uxCopy(locale, "service")}</span>
          <select
            aria-label={uxCopy(locale, "service")}
            value={provider}
            disabled={disabled}
            onChange={(event) => choose(event.currentTarget.value as Provider)}
          >
            {PROVIDERS.map((item) => (
              <option key={item} value={item}>
                {PROVIDER_NAMES[item]}
                {unsupportedLabel(item) ? ` · ${unsupportedLabel(item)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          aria-expanded={open}
          aria-controls="service-catalog"
          onClick={() => setOpen((value) => !value)}
        >
          {uxCopy(locale, open ? "catalogClose" : "catalog")}
        </button>
      </div>
      <div
        id="service-catalog"
        className="provider-catalog"
        hidden={!open}
        ref={catalogRef}
      >
        <label className="search-box provider-search">
          <Search size={15} />
          <input
            aria-label={t("connections.searchPlatform")}
            value={query}
            placeholder={t("connections.searchPlatform")}
            onChange={(event) => setQuery(event.currentTarget.value)}
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
              tabIndex={active === item ? 0 : -1}
              disabled={disabled}
              onClick={() => choose(item, true)}
              onKeyDown={(event) => keyDown(event, item)}
            >
              <ProviderIcon provider={item} />
              <span>
                {PROVIDER_NAMES[item]}
                {unsupportedLabel(item) && (
                  <small>{unsupportedLabel(item)}</small>
                )}
              </span>
            </button>
          ))}
          {catalog.length === 0 && (
            <p className="catalog-empty" role="status">
              {t("connections.noPlatforms")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
