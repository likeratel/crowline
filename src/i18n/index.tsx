import { createContext, useContext, useMemo, type ReactNode } from "react";
import { en } from "./en";
import { ja } from "./ja";
import { ko, type TranslationKey } from "./ko";
import { zhCN } from "./zh-CN";

export type Locale = "ko" | "en" | "ja" | "zh-CN";
export type LanguagePreference = "system" | Locale;
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (
  key: TranslationKey,
  values?: TranslationValues,
) => string;

const catalogs: Record<Locale, Partial<Record<TranslationKey, string>>> = {
  ko,
  en,
  ja,
  "zh-CN": zhCN,
};

function localeFromLanguageTag(tag: string): Locale | null {
  const normalized = tag.toLowerCase();
  // Simplified Chinese is the only supported Chinese catalog, so every
  // Chinese system locale follows it consistently across frontend and Rust.
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("en")) return "en";
  return null;
}

export function resolveLocale(
  preference: LanguagePreference | null | undefined,
  languages: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages,
): Locale {
  if (preference && preference !== "system") return preference;
  return languages.map(localeFromLanguageTag).find(Boolean) ?? "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: TranslationValues = {},
): string {
  const template = catalogs[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

let activeLocale = resolveLocale("system");

export function setActiveLanguage(
  preference: LanguagePreference | null | undefined,
): Locale {
  activeLocale = resolveLocale(preference);
  if (typeof document !== "undefined")
    document.documentElement.lang = activeLocale;
  return activeLocale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

export function tr(key: TranslationKey, values?: TranslationValues): string {
  return translate(activeLocale, key, values);
}

type I18nValue = { locale: Locale; t: Translate };
const defaultLocale = activeLocale;
const I18nContext = createContext<I18nValue>({
  locale: defaultLocale,
  t: (key, values) => translate(defaultLocale, key, values),
});

export function I18nProvider({
  language,
  children,
}: {
  language?: LanguagePreference | null;
  children: ReactNode;
}) {
  const locale = resolveLocale(language);
  const value = useMemo<I18nValue>(
    () => ({ locale, t: (key, values) => translate(locale, key, values) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function formatRelativeTime(
  value: string | number | Date,
  locale: Locale,
  now = Date.now(),
): string {
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsedSeconds < 60) return formatter.format(-elapsedSeconds, "second");
  if (elapsedSeconds < 3600)
    return formatter.format(-Math.floor(elapsedSeconds / 60), "minute");
  if (elapsedSeconds < 86400)
    return formatter.format(-Math.floor(elapsedSeconds / 3600), "hour");
  return formatter.format(-Math.floor(elapsedSeconds / 86400), "day");
}

export function formatDuration(
  startedAt: string | number | Date,
  endedAt: string | number | Date,
  locale: Locale,
): string {
  const start =
    startedAt instanceof Date
      ? startedAt.getTime()
      : typeof startedAt === "number"
        ? startedAt
        : Date.parse(startedAt);
  const end =
    endedAt instanceof Date
      ? endedAt.getTime()
      : typeof endedAt === "number"
        ? endedAt
        : Date.parse(endedAt);
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const formatter = new Intl.NumberFormat(locale);
  if (seconds < 60) {
    const secondUnit =
      locale === "ko"
        ? "초"
        : locale === "ja"
          ? "秒"
          : locale === "zh-CN"
            ? "秒"
            : "s";
    return `${formatter.format(seconds)}${secondUnit}`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (locale === "ko")
    return `${formatter.format(minutes)}분 ${formatter.format(remainder)}초`;
  if (locale === "ja")
    return `${formatter.format(minutes)}分 ${formatter.format(remainder)}秒`;
  if (locale === "zh-CN")
    return `${formatter.format(minutes)}分钟 ${formatter.format(remainder)}秒`;
  return `${formatter.format(minutes)}m ${formatter.format(remainder)}s`;
}
