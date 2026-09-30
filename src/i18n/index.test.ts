import { describe, expect, it } from "vitest";
import { resolveLocale } from "./index";

describe("resolveLocale", () => {
  it.each(["zh", "zh-CN", "zh-SG", "zh-TW", "zh-HK", "zh-Hans", "zh-Hant"])(
    "maps the Chinese system locale %s to the supported Simplified Chinese catalog",
    (language) => {
      expect(resolveLocale("system", [language])).toBe("zh-CN");
    },
  );

  it("uses the first supported system locale", () => {
    expect(resolveLocale("system", ["fr-FR", "zh-TW", "ko-KR"])).toBe("zh-CN");
  });

  it("falls back to English when no system locale is supported", () => {
    expect(resolveLocale("system", ["fr-FR", "de-DE"])).toBe("en");
  });

  it("keeps an explicit language preference", () => {
    expect(resolveLocale("ja", ["zh-HK"])).toBe("ja");
  });
});
