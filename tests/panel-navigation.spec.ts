import { expect, test } from "@playwright/test";

test("panel refresh, execution links, close, and Escape never open the dashboard", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "hide: async () => {";
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        `${marker} window.__panelHides = (window.__panelHides ?? 0) + 1;`,
      ),
    });
  });
  await page.setViewportSize({ width: 420, height: 540 });
  await page.goto("/");
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.locator(".panel-run").first().click();
  await page.getByRole("button", { name: "패널 닫기", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __panelHides?: number }).__panelHides,
      ),
    )
    .toBe(2);
  await expect(page).not.toHaveURL(/view=dashboard/);
  await expect(page.getByRole("main", { name: "배포 요약" })).toBeVisible();
  await page
    .getByRole("button", { name: "대시보드에서 확인", exact: true })
    .click();
  await expect(page).toHaveURL(/view=dashboard/);
});

test("additional panel rows clearly name the dashboard destination", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "let preview = demoSnapshot();";
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        `${marker}
      preview = { ...preview, settings: { ...preview.settings, panel: { ...preview.settings.panel, rowLimit: 1 } } };
    `,
      ),
    });
  });
  await page.setViewportSize({ width: 420, height: 540 });
  await page.goto("/");
  const more = page
    .getByRole("button", { name: /대시보드에서 \d+개 더 보기/ })
    .first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(page).toHaveURL(/view=dashboard/);
});
