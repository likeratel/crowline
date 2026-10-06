import { expect, test } from "@playwright/test";

for (const width of [1080, 360]) {
  test(`settings selects use the same height without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto("/?view=dashboard");
    await page.getByRole("button", { name: "설정", exact: true }).click();
    for (const tab of ["서비스 연결", "알림", "메뉴 막대", "일반"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "알림")
        await page.getByLabel("실행 결과 알림 받기", { exact: true }).check();
      const controls = await page
        .locator("select:visible")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            height: element.getBoundingClientRect().height,
            font: getComputedStyle(element).fontSize,
          })),
        );
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.height).toBe(36);
        expect(control.font).toBe("12px");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("tab", { name: "서비스 연결", exact: true }).click();
    await page.screenshot({
      path: `artifacts/ui-consistency-${width}.png`,
      fullPage: true,
    });
  });
}
