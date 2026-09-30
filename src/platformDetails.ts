import type { Provider } from "./domain";

export interface PlatformDetails {
  canStartAppLogin: boolean;
  cliCommand: string | null;
  connectionSummary: string;
  supportsMultipleAccounts: boolean;
  supportsActorAttribution: boolean;
  unsupportedMessage?: string;
}

const platformDetails: Record<Provider, PlatformDetails> = {
  github: {
    canStartAppLogin: true,
    cliCommand: "gh auth login",
    connectionSummary: "이 기기의 GitHub CLI 로그인을 사용합니다.",
    supportsMultipleAccounts: true,
    supportsActorAttribution: true,
  },
  vercel: {
    canStartAppLogin: true,
    cliCommand: "vercel login",
    connectionSummary: "이 기기의 Vercel CLI 로그인을 사용합니다.",
    supportsMultipleAccounts: true,
    supportsActorAttribution: true,
  },
  aws: {
    canStartAppLogin: true,
    cliCommand: "aws sso login",
    connectionSummary: "선택한 AWS 프로필과 리전을 사용합니다.",
    supportsMultipleAccounts: true,
    supportsActorAttribution: false,
  },
  "github-deployments": {
    canStartAppLogin: false,
    cliCommand: "gh auth login",
    connectionSummary: "이 기기의 GitHub CLI 로그인을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: true,
  },
  railway: {
    canStartAppLogin: false,
    cliCommand: "railway login",
    connectionSummary: "이 기기에 로그인된 Railway CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  netlify: {
    canStartAppLogin: false,
    cliCommand: "netlify login",
    connectionSummary: "이 기기에 로그인된 Netlify CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  render: {
    canStartAppLogin: false,
    cliCommand: "render login",
    connectionSummary: "이 기기에 로그인된 Render CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  "cloudflare-pages": {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary:
      "Wrangler CLI는 Pages 배포의 시각과 상태를 신뢰성 있게 제공하지 않습니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage:
      "Cloudflare Pages 배포 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
  },
  "cloudflare-workers": {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary:
      "Wrangler CLI는 계정 전체 Workers 배포 대상을 자동으로 찾을 수 없습니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage:
      "Cloudflare Workers 배포 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
  },
  heroku: {
    canStartAppLogin: false,
    cliCommand: "heroku login",
    connectionSummary: "이 기기에 로그인된 Heroku CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  fly: {
    canStartAppLogin: false,
    cliCommand: "fly auth login",
    connectionSummary: "이 기기에 로그인된 flyctl 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  gitlab: {
    canStartAppLogin: false,
    cliCommand: "glab auth login",
    connectionSummary: "이 기기에 로그인된 GitLab CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  digitalocean: {
    canStartAppLogin: false,
    cliCommand: "doctl auth init",
    connectionSummary: "이 기기에 설정된 doctl 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  gcloud: {
    canStartAppLogin: false,
    cliCommand: "gcloud auth login",
    connectionSummary: "이 기기에 로그인된 Google Cloud CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  azure: {
    canStartAppLogin: false,
    cliCommand: "az login",
    connectionSummary: "이 기기에 로그인된 Azure CLI 세션을 사용합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
  },
  eas: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary:
      "EAS CLI는 계정 전체 Expo 프로젝트를 자동으로 조회하지 못합니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage:
      "EAS Build·Update 직접 조회에는 프로젝트 연결 정보가 추가로 필요합니다. CI로 실행한 빌드는 GitHub Actions 또는 GitLab CI에서 확인할 수 있습니다.",
  },
  firebase: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary:
      "Firebase CLI 세션만으로는 신뢰할 수 있는 배포 이력을 조회할 수 없습니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage:
      "Firebase 배포 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
  },
  supabase: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary:
      "Supabase CLI는 배포 이력을 신뢰성 있게 제공하지 않습니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage:
      "Supabase Edge Functions의 배포 상태는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
  },
  fastlane: {
    canStartAppLogin: false,
    cliCommand: null,
    connectionSummary: "fastlane은 클라우드 배포 서비스가 아닙니다.",
    supportsMultipleAccounts: false,
    supportsActorAttribution: false,
    unsupportedMessage:
      "fastlane 실행 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
  },
};

const fallbackDetails: PlatformDetails = {
  canStartAppLogin: false,
  cliCommand: null,
  connectionSummary: "이 기기의 기존 CLI 세션을 사용합니다.",
  supportsMultipleAccounts: false,
  supportsActorAttribution: false,
};

export function getPlatformDetails(provider: Provider): PlatformDetails {
  return platformDetails[provider] ?? fallbackDetails;
}
