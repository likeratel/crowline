import { expect, test, type Page } from "@playwright/test";

async function withSettingsFailure(page: Page, empty = false) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: `${source}
        preview = {
          ...preview,
          settingsError: "Synthetic settings permission denied",
          ${
            empty
              ? "settings: { ...preview.settings, accounts: [], targets: [] }, connections: [], activities: []"
              : ""
          }
        };`,
    });
  });
}

test("settings recovery stays visible while monitoring remains readable and changes are locked", async ({
  page,
}) => {
  await withSettingsFailure(page);
  await page.goto("/?view=dashboard");

  const recovery = page.getByRole("alert").filter({
    hasText: "설정을 불러오지 못했습니다",
  });
  await expect(recovery).toContainText("저장 잠김");
  await expect(recovery).toContainText("원본 설정은 보존했습니다");
  await expect(
    page.getByText("Deploy production", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "내 실행만" })).toBeDisabled();
  await expect(page.getByLabel("조회 기간")).toBeDisabled();
  await expect(page.locator(".activity-dismiss:visible")).toHaveCount(0);

  await recovery.getByText("오류 상세", { exact: true }).click();
  await expect(recovery).toContainText("Synthetic settings permission denied");

  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "설정을 불러오지 못했습니다" }),
  ).toBeVisible();
  for (const tab of ["서비스 연결", "알림", "메뉴 막대", "일반"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: tab, exact: true });
    await expect(panel).toBeVisible();
    await expect(
      panel.locator("button:enabled, input:enabled, select:enabled"),
    ).toHaveCount(0);
  }
});

test("a failed settings load is not presented as first-use onboarding", async ({
  page,
}) => {
  await withSettingsFailure(page, true);
  await page.goto("/?view=dashboard");
  await expect(
    page.getByRole("alert").filter({ hasText: "설정을 불러오지 못했습니다" }),
  ).toBeVisible();
  await expect(page.getByText("첫 번째 연결을 추가해 보세요")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "서비스 연결하기" }),
  ).toHaveCount(0);

  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: "설정을 불러오지 못했습니다" }),
  ).toContainText("저장 잠김");
  await expect(page.getByText("감시할 프로젝트를 선택하세요.")).toHaveCount(0);
});

test("retry restores the snapshot subscription before showing recovery", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: `${source}
        let allowSyntheticSubscription = false;
        let syntheticSubscribeCalls = 0;
        const syntheticHandlers = new Set();
        bridge.subscribe = async (handler) => {
          syntheticSubscribeCalls += 1;
          if (!allowSyntheticSubscription) {
            throw new Error("Synthetic subscription unavailable");
          }
          syntheticHandlers.add(handler);
          return () => syntheticHandlers.delete(handler);
        };
        window.__subscriptionTest = {
          allow: () => { allowSyntheticSubscription = true; },
          emit: () => syntheticHandlers.forEach((handler) => handler({
            ...preview,
            activities: preview.activities.map((activity, index) =>
              index === 0 ? { ...activity, title: "Recovered subscription event" } : activity
            )
          })),
          state: () => ({ calls: syntheticSubscribeCalls, listeners: syntheticHandlers.size })
        };`,
    });
  });
  await page.goto("/?view=dashboard");

  await expect(
    page.getByText("Synthetic subscription unavailable"),
  ).toBeVisible();
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(
    page.getByText("Synthetic subscription unavailable"),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as {
        __subscriptionTest: { allow: () => void };
      }
    ).__subscriptionTest.allow(),
  );
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(
    page.getByRole("heading", { name: "실행 현황", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __subscriptionTest: {
              state: () => { calls: number; listeners: number };
            };
          }
        ).__subscriptionTest.state(),
      ),
    )
    .toMatchObject({ listeners: 1 });

  await page.evaluate(() =>
    (
      window as unknown as {
        __subscriptionTest: { emit: () => void };
      }
    ).__subscriptionTest.emit(),
  );
  await expect(
    page.getByText("Recovered subscription event", { exact: true }),
  ).toBeVisible();
});
