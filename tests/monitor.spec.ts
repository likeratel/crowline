import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?view=dashboard");
});
test("clearly labels preview and filters mine, all, service and search", async ({
  page,
}) => {
  await expect(page.getByText(/화면 미리보기 · 가상 데이터/)).toBeVisible();
  await expect(
    page.getByText("Deploy production", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("orbit-api · 스택 업데이트", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "전체 실행", exact: true }).click();
  await expect(
    page.getByText("orbit-api · 스택 업데이트", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fix notification preferences", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "서비스 필터" })
    .getByRole("button", { name: /GitHub Actions/ })
    .click();
  await expect(
    page.getByText("Fix notification preferences", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("textbox", { name: "실행 검색" }).fill("production");
  await expect(page.locator(".activity-row")).toHaveCount(1);
});
test("settings can discover targets, deselect them and reach onboarding", async ({
  page,
}) => {
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await expect(page.getByRole("dialog", { name: "서비스 연결" })).toBeVisible();
  await page.getByRole("button", { name: "연결 및 대상 확인" }).click();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("tab", { name: "Vercel" }).click();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("tab", { name: "AWS" }).click();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.getByText("첫 번째 연결을 추가해 보세요")).toBeVisible();
});
test("browser preview cannot pretend a real login succeeded", async ({
  page,
}) => {
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await page.getByRole("button", { name: "브라우저로 로그인" }).click();
  await expect(
    page.getByText("로그인은 데스크톱 앱에서 사용할 수 있습니다."),
  ).toBeVisible();
});
test("black theme stays dark across OS preferences and fits narrow windows", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(13, 14, 16)",
  );
  await page.screenshot({
    path: "artifacts/crowline-black.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(13, 14, 16)",
  );
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(
    page.getByRole("heading", { name: "배포 현황", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/crowline-dark.png",
    fullPage: true,
  });
});
