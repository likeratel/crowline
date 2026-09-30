import type { Locale } from "./i18n";
const text = {
  title: ["설정", "Settings", "設定", "设置"],
  connections: ["서비스 연결", "Connections", "サービス接続", "服务连接"],
  notifications: ["알림", "Notifications", "通知", "通知"],
  panel: ["메뉴 막대", "Menu bar", "メニューバー", "菜单栏"],
  general: ["일반", "General", "一般", "常规"],
  saving: ["저장 중", "Saving", "保存中", "正在保存"],
  saveFailed: [
    "변경하지 못했습니다.",
    "Couldn’t apply this change.",
    "変更を適用できませんでした。",
    "未能应用更改。",
  ],
  confirmFailed: [
    "저장 상태를 확인하지 못했습니다.",
    "Couldn’t confirm the saved change.",
    "保存状態を確認できませんでした。",
    "无法确认保存状态。",
  ],
  details: ["상세", "Details", "詳細", "详情"],
  alias: ["계정 별칭", "Account alias", "アカウントの別名", "账户别名"],
  editAlias: ["별칭 편집", "Edit alias", "別名を編集", "编辑别名"],
  connectionHelp: ["연결 방법", "Connection help", "接続方法", "连接帮助"],
} satisfies Record<string, readonly [string, string, string, string]>;
export type SettingsTab = "connections" | "notifications" | "panel" | "general";
export function settingsCopy(locale: Locale, key: keyof typeof text): string {
  return text[key][({ ko: 0, en: 1, ja: 2, "zh-CN": 3 } as const)[locale]];
}
