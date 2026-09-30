import type { Provider } from "./domain";
import {
  resolveLocale,
  translate,
  type Locale,
  type TranslationValues,
} from "./i18n";
import type { TranslationKey } from "./i18n/ko";

export interface PlatformDetails {
  canStartAppLogin: boolean;
  cliCommand: string | null;
  connectionSummary: string;
  supportsMultipleAccounts: boolean;
  supportsActorAttribution: boolean;
  unsupportedMessage?: string;
}

type LocalizedText = { key: TranslationKey; values?: TranslationValues };
type PlatformDefinition = Omit<
  PlatformDetails,
  "connectionSummary" | "unsupportedMessage"
> & {
  connectionSummary: LocalizedText;
  unsupportedMessage?: LocalizedText;
};
const cliSession = (provider: string): LocalizedText => ({
  key: "platform.cliSession",
  values: { provider },
});

const platformDetails: Record<Provider, PlatformDefinition> = {
  github: {
    canStartAppLogin: true,
    cliCommand: "gh auth login",
    connectionSummary: { key: "platform.github" },
    supportsMultipleAccounts: true,
    supportsActorAttribution: true,
  },
  vercel: {
    canStartAppLogin: true,
    cliCommand: "vercel login",
    connectionSummary: { key: "platform.vercel" },
    supportsMultipleAccounts: true,
    supportsActorAttribution: true,
  },
  aws: {
    canStartAppLogin: true,
    cliCommand: "aws sso login",
    connectionSummary: { key: "platform.aws" },
    supportsMultipleAccounts: true,
    supportsActorAttribution: false,
  },
  "github-deployments": {
    canStartAppLogin: false,
    cliCommand: "gh auth login",
    connectionSummary: { key: "platform.github" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: true,
  },
  railway: {
    canStartAppLogin: false,
    cliCommand: "railway login",
    connectionSummary: cliSession("Railway"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  netlify: {
    canStartAppLogin: false,
    cliCommand: "netlify login",
    connectionSummary: cliSession("Netlify"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  render: {
    canStartAppLogin: false,
    cliCommand: "render login",
    connectionSummary: cliSession("Render"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  "cloudflare-pages": {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.cloudflarePagesSummary" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage: { key: "platform.cloudflarePagesUnsupported" },
  },
  "cloudflare-workers": {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.cloudflareWorkersSummary" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage: { key: "platform.cloudflareWorkersUnsupported" },
  },
  heroku: {
    canStartAppLogin: false,
    cliCommand: "heroku login",
    connectionSummary: cliSession("Heroku"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  fly: {
    canStartAppLogin: false,
    cliCommand: "fly auth login",
    connectionSummary: cliSession("flyctl"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  bitbucket: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.bitbucket" },
    supportsMultipleAccounts: true,
    supportsActorAttribution: true,
  },
  gitlab: {
    canStartAppLogin: false,
    cliCommand: "glab auth login",
    connectionSummary: cliSession("GitLab"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  digitalocean: {
    canStartAppLogin: false,
    cliCommand: "doctl auth init",
    connectionSummary: cliSession("doctl"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  gcloud: {
    canStartAppLogin: false,
    cliCommand: "gcloud auth login",
    connectionSummary: cliSession("Google Cloud"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  azure: {
    canStartAppLogin: false,
    cliCommand: "az login",
    connectionSummary: cliSession("Azure"),
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  eas: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.easSummary" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage: { key: "platform.easUnsupported" },
  },
  firebase: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.firebaseSummary" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage: { key: "platform.firebaseUnsupported" },
  },
  supabase: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.supabaseSummary" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage: { key: "platform.supabaseUnsupported" },
  },
  fastlane: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: { key: "platform.fastlaneSummary" },
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage: { key: "platform.fastlaneUnsupported" },
  },
};
const fallbackDetails: PlatformDefinition = {
  canStartAppLogin: false,
  cliCommand: null,
  connectionSummary: { key: "platform.existingSession" },
  supportsMultipleAccounts: false,
  supportsActorAttribution: false,
};

export function getPlatformDetails(
  provider: Provider,
  locale: Locale = resolveLocale("system"),
): PlatformDetails {
  const details = platformDetails[provider] ?? fallbackDetails;
  return {
    ...details,
    connectionSummary: translate(
      locale,
      details.connectionSummary.key,
      details.connectionSummary.values,
    ),
    unsupportedMessage: details.unsupportedMessage
      ? translate(
          locale,
          details.unsupportedMessage.key,
          details.unsupportedMessage.values,
        )
      : undefined,
  };
}
