import type { Locale } from "./i18n";
const messages = {
  account: [
    "GitHub CLI 계정",
    "GitHub CLI account",
    "GitHub CLI アカウント",
    "GitHub CLI 账号",
  ],
  choose: [
    "로그인한 계정 선택",
    "Choose a signed-in account",
    "ログイン済みアカウントを選択",
    "选择已登录的账号",
  ],
  connect: [
    "선택한 계정 연결",
    "Connect selected account",
    "選択したアカウントを接続",
    "连接所选账号",
  ],
  refresh: [
    "CLI 계정 새로고침",
    "Refresh CLI accounts",
    "CLI アカウントを更新",
    "刷新 CLI 账号",
  ],
  help: [
    "gh에 로그인한 계정을 선택하세요. 계정을 추가하려면 터미널에서 gh auth login을 실행한 후 목록을 새로고침하세요.",
    "Choose an account signed in to gh. To add one, run gh auth login in your terminal, then refresh this list.",
    "gh にログイン済みのアカウントを選択してください。追加するには端末で gh auth login を実行し、一覧を更新してください。",
    "请选择已登录 gh 的账号。要添加账号，请在终端运行 gh auth login，然后刷新列表。",
  ],
  preview: [
    "브라우저 미리보기에서는 가상 CLI 계정을 사용합니다.",
    "Browser preview uses fictional CLI accounts.",
    "ブラウザプレビューでは架空の CLI アカウントを使用します。",
    "浏览器预览使用虚构的 CLI 账号。",
  ],
  noAccounts: [
    "로그인한 CLI 계정이 없습니다. gh auth login으로 먼저 로그인하세요.",
    "No signed-in CLI accounts. Run gh auth login first.",
    "ログイン済みの CLI アカウントがありません。gh auth login を実行してください。",
    "没有已登录的 CLI 账号，请先运行 gh auth login。",
  ],
} as const;
export function cliCopy(locale: Locale, key: keyof typeof messages) {
  return messages[key][{ ko: 0, en: 1, ja: 2, "zh-CN": 3 }[locale]];
}
