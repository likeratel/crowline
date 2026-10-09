import { expect, test } from "@playwright/test";

test("searches the platform catalog and explains unsupported platforms", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });

  await connections.getByRole("button", { name: "서비스 찾아보기" }).click();
  const platformSearch = connections.getByLabel("플랫폼 검색");
  await platformSearch.fill("Railway");
  await expect(
    connections.getByRole("tab", { name: "Railway", exact: true }),
  ).toBeVisible();
  await expect(
    connections.getByRole("tab", { name: "Vercel", exact: true }),
  ).toHaveCount(0);
  await connections.getByRole("tab", { name: "Railway", exact: true }).click();
  await expect(
    page.getByText("이 기기의 CLI 세션", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "CLI 세션 연결" }),
  ).toBeVisible();
  await connections.locator("details.connection-help summary").first().click();
  await expect(page.getByText(/railway login/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인 시작" })).toHaveCount(
    0,
  );

  for (const unsupported of [
    {
      search: "fastlane",
      name: "fastlane",
      message: "fastlane을 실행한 CI 기록을 확인하세요.",
    },
  ]) {
    await connections.getByRole("button", { name: "서비스 찾아보기" }).click();
    await platformSearch.fill(unsupported.search);
    await connections
      .getByRole("tab", {
        name: `${unsupported.name} CI 실행으로 확인`,
        exact: true,
      })
      .click();
    await expect(page.locator(".unsupported-connection strong")).toBeVisible();
    await expect(page.getByText(unsupported.message)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CLI 세션 연결" }),
    ).toHaveCount(0);
  }
});
