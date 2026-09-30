import type { Locale } from "./i18n";

const messages = {
  title: ["알림", "Notifications", "通知", "通知"],
  help: [
    "프로젝트별로 알림을 받을 실행과 결과를 설정합니다.",
    "Choose which runs and results notify you for each project.",
    "プロジェクトごとに通知する実行と結果を設定します。",
    "为每个项目设置要通知的运行和结果。",
  ],
  enabled: [
    "배포 알림 받기",
    "Enable deployment notifications",
    "デプロイ通知を受け取る",
    "接收部署通知",
  ],
  desktopOnly: [
    "데스크톱 앱에서 사용할 수 있습니다.",
    "Available in the desktop app.",
    "デスクトップアプリで利用できます。",
    "请在桌面应用中使用。",
  ],
  checking: [
    "권한 확인 중…",
    "Checking permission…",
    "権限を確認中…",
    "正在检查权限…",
  ],
  granted: [
    "알림이 허용되어 있습니다.",
    "Notifications are allowed.",
    "通知は許可されています。",
    "已允许通知。",
  ],
  denied: [
    "알림이 차단되어 있습니다. 시스템 설정에서 허용해 주세요.",
    "Notifications are blocked. Allow them in system settings.",
    "通知が無効です。システム設定で許可してください。",
    "通知已被禁用，请在系统设置中允许通知。",
  ],
  prompt: [
    "알림을 받으려면 시스템 권한이 필요합니다.",
    "System permission is required for notifications.",
    "通知を受け取るにはシステムの許可が必要です。",
    "接收通知需要系统授权。",
  ],
  allow: ["알림 권한 허용", "Allow notifications", "通知を許可", "允许通知"],
  search: [
    "프로젝트 검색",
    "Search projects",
    "プロジェクトを検索",
    "搜索项目",
  ],
  allProviders: [
    "모든 서비스",
    "All providers",
    "すべてのプロバイダー",
    "所有提供商",
  ],
  selectFiltered: [
    "검색 결과 전체 선택",
    "Select all filtered",
    "絞り込み結果をすべて選択",
    "选择所有筛选结果",
  ],
  selected: [
    "{count}개 선택",
    "{count} selected",
    "{count}件選択",
    "已选择 {count} 项",
  ],
  clear: ["선택 해제", "Clear selection", "選択を解除", "清除选择"],
  bulkScope: [
    "선택 항목 실행 범위",
    "Selected run scope",
    "選択項目の実行範囲",
    "所选项目的运行范围",
  ],
  bulkResult: [
    "선택 항목 결과",
    "Selected results",
    "選択項目の結果",
    "所选项目的结果",
  ],
  chooseScope: [
    "실행자 변경…",
    "Change run scope…",
    "実行者を変更…",
    "更改运行范围…",
  ],
  chooseResult: ["결과 변경…", "Change results…", "結果を変更…", "更改结果…"],
  rowSelect: ["선택", "Select", "選択", "选择"],
  rowScope: ["알림 대상", "Notification audience", "通知対象", "通知范围"],
  rowResult: ["알림 결과", "Notification results", "通知結果", "通知结果"],
  off: ["끔", "Off", "オフ", "关闭"],
  mine: ["내 실행", "My runs", "自分の実行", "我的运行"],
  allRuns: ["모든 실행", "All runs", "すべての実行", "所有运行"],
  failedOnly: ["실패만", "Failed only", "失敗のみ", "仅失败"],
  successOnly: ["성공만", "Succeeded only", "成功のみ", "仅成功"],
  allResults: ["모든 결과", "All results", "すべての結果", "所有结果"],
  custom: ["직접 설정", "Custom", "カスタム", "自定义"],
  success: ["성공", "Succeeded", "成功", "成功"],
  failed: ["실패", "Failed", "失敗", "失败"],
  canceled: ["취소", "Canceled", "キャンセル", "已取消"],
  noTargets: [
    "연결된 프로젝트가 없습니다.",
    "No connected projects.",
    "接続済みのプロジェクトがありません。",
    "没有已连接的项目。",
  ],
  noMatches: [
    "검색 결과가 없습니다.",
    "No projects match your filters.",
    "条件に一致するプロジェクトはありません。",
    "没有符合筛选条件的项目。",
  ],
  saveFailures: [
    "저장하지 못한 알림 설정",
    "Notification settings that failed to save",
    "保存できなかった通知設定",
    "未能保存的通知设置",
  ],
  projectCount: [
    "{count}개 프로젝트",
    "{count} projects",
    "{count}件のプロジェクト",
    "{count} 个项目",
  ],
  emptyStatuses: [
    "활성화된 프로젝트에서 결과를 하나 이상 선택해 주세요.",
    "Select at least one result for every enabled project.",
    "有効なプロジェクトでは結果を1つ以上選択してください。",
    "请为每个已启用的项目至少选择一个结果。",
  ],
  save: ["설정 저장", "Save settings", "設定を保存", "保存设置"],
  saved: [
    "알림 설정을 저장했습니다.",
    "Notification settings saved.",
    "通知設定を保存しました。",
    "通知设置已保存。",
  ],
} as const;

export type NotificationCopyKey = keyof typeof messages;

const localeIndex: Record<Locale, number> = { ko: 0, en: 1, ja: 2, "zh-CN": 3 };

export function notificationCopy(
  locale: Locale,
  key: NotificationCopyKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return messages[key][localeIndex[locale]].replace(
    /\{(\w+)\}/g,
    (match, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name)
        ? String(values[name])
        : match,
  );
}
