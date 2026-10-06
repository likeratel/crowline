import { expect, test } from "@playwright/test";

for (const view of ["/?view=dashboard", "/"]) {
  test(`hiding one execution survives refresh and can be undone in ${view}`, async ({
    page,
  }) => {
    await page.goto(view);
    const hide = page
      .getByRole("button", { name: /^목록에서 숨기기:/ })
      .first();
    const label = await hide.getAttribute("aria-label");
    if (!label) throw new Error("Missing accessible hide label");
    const initial = await page
      .getByRole("button", { name: /^목록에서 숨기기:/ })
      .count();
    await hide.click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("항목을 숨겼습니다", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^목록에서 숨기기:/ }),
    ).toHaveCount(initial);
  });
}

test("failed persistence restores the row and offers a visible error", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(
      "change: async (change) => {",
      'change: async (change) => { if (change.kind === "activityVisibility") throw new Error("Synthetic disk error");',
    );
    await route.fulfill({ response, body: source });
  });
  await page.goto("/?view=dashboard");
  const hide = page.getByRole("button", { name: /^목록에서 숨기기:/ }).first();
  const label = await hide.getAttribute("aria-label");
  if (!label) throw new Error("Missing accessible hide label");
  await hide.click();
  await expect(page.getByRole("alert")).toContainText(
    "숨김 설정을 저장하지 못했습니다",
  );
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toBeVisible();
});
