import type { Locale } from "./i18n";

const messages = {
  details: ["상세", "Details", "詳細", "详情"],
  heading: ["실행 상세", "Run details", "実行の詳細", "运行详情"],
  close: ["닫기", "Close", "閉じる", "关闭"],
  openOriginal: [
    "원본에서 열기",
    "Open original",
    "元のページを開く",
    "打开原始页面",
  ],
  hide: ["목록에서 숨기기", "Hide from list", "一覧から非表示", "从列表中隐藏"],
  provider: ["서비스", "Service", "サービス", "服务"],
  project: ["프로젝트", "Project", "プロジェクト", "项目"],
  branch: ["브랜치", "Branch", "ブランチ", "分支"],
  workflow: ["워크플로", "Workflow", "ワークフロー", "工作流"],
  account: ["계정", "Account", "アカウント", "账户"],
  actor: ["실행자", "Actor", "実行者", "执行者"],
  status: ["상태", "Status", "状態", "状态"],
  startedAt: ["시작", "Started", "開始", "开始"],
  finishedAt: ["종료", "Finished", "Finished", "结束"],
  updatedAt: ["실행 업데이트", "Updated at", "更新日時", "更新时间"],
  unavailable: ["정보 없음", "Not available", "情報なし", "暂无信息"],
} as const;

export function activityDetailsCopy(
  locale: Locale,
  key: keyof typeof messages,
): string {
  const index = { ko: 0, en: 1, ja: 2, "zh-CN": 3 }[locale];
  return messages[key][index];
}
