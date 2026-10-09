import { expect, test } from "@playwright/test";

test("history loads only on demand and settings remain usable during polling", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(
        "let preview = demoSnapshot();",
        `let preview = demoSnapshot();
        preview = { ...preview, refreshing: true, pendingTargets: ["synthetic-pending"],
          history: [{ provider: "github", connectionId: "github:local", targetId: "github:orbit/web", nextCursor: "2", generation: 1, checkedAt: new Date().toISOString() }] };
      `,
      )
      .replace(
        "if (isPreview) return preview;",
        `if (isPreview) {
        window.__historyCalls = (window.__historyCalls ?? 0) + 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        preview = { ...preview, history: preview.history.map(item => ({ ...item, nextCursor: null })) };
        return preview;
      }`,
      );
    await route.fulfill({ response, body });
  });
  await page.goto("/?view=dashboard");
  await expect(
    page.getByRole("button", { name: "이전 실행 더 보기" }),
  ).toBeDisabled();
  await page
    .getByLabel("이력 조회 대상")
    .selectOption("github:github:local:github:orbit/web");
  await expect(
    page.getByRole("button", { name: "이전 실행 더 보기" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __historyCalls?: number }).__historyCalls ?? 0,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "이전 실행 더 보기" }).click();
  await expect(
    page.getByRole("button", { name: "이전 실행 더 보기" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { __historyCalls?: number }).__historyCalls,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "서비스 연결" }),
  ).toBeVisible();
});
