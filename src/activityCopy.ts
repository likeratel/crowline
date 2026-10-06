import type { Locale } from "./i18n";

const messages = {
  more: ["더 보기", "Show more", "もっと表示", "显示更多"],
  hide: ["목록에서 숨기기", "Hide from list", "一覧から非表示", "从列表中隐藏"],
  hidden: [
    "항목을 숨겼습니다",
    "Item hidden",
    "項目を非表示にしました",
    "已隐藏此项",
  ],
  undo: ["실행 취소", "Undo", "元に戻す", "撤销"],
  failed: [
    "숨김 설정을 저장하지 못했습니다. 다시 시도해주세요.",
    "Could not save visibility. Please try again.",
    "表示設定を保存できませんでした。再試行してください。",
    "无法保存显示设置，请重试。",
  ],
} as const;

export function activityCopy(locale: Locale, key: keyof typeof messages) {
  const index = { ko: 0, en: 1, ja: 2, "zh-CN": 3 }[locale];
  return messages[key][index];
}
