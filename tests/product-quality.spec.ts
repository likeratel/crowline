import { expect, test } from "@playwright/test";

test("each window loads its own screen without loading the other screen module", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(new URL(request.url()).pathname),
  );
  await page.goto("/");
  await expect(page.locator(".tray-panel")).toBeVisible();
  expect(requests).not.toContain("/src/App.tsx");
  requests.length = 0;
  await page.goto("/?view=dashboard");
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(requests).not.toContain("/src/components/TrayPanel.tsx");
});

test("screen loading failure offers a working retry", async ({ page }) => {
  let fail = true;
  await page.route(/\/src\/App\.tsx(?:\?.*)?$/, async (route) => {
    if (fail) {
      fail = false;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto("/?view=dashboard");
  await expect(page.getByRole("alert")).toContainText(
    "화면을 불러오지 못했습니다",
  );
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("returning to a healthy panel requests fresh results and coalesces focus events", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\n
      const time = new Date(Date.now() - 30000).toISOString();
      preview = {...preview, lastUpdatedAt: time, queryHealth: preview.queryHealth.map(row => ({...row, status: 'success', lastAttemptAt: time, lastSuccessfulAt: time}))};
      window.qualityWakeCount = 0;
      bridge.requestRefresh = async () => { window.qualityWakeCount++; };
    `,
    });
  });
  await page.goto("/");
  await expect(page.locator(".panel-query-summary")).toContainText("최신 결과");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { qualityWakeCount: number }).qualityWakeCount,
      ),
    )
    .toBe(1);
});

test("relative time rendering pauses while hidden and catches up on return", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  const duration = page
    .locator(".panel-run")
    .filter({ hasText: "Deploy production" })
    .locator(".panel-run-time");
  await expect(duration).toBeVisible();
  const before = await duration.textContent();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(60_000);
  await expect(duration).toHaveText(before ?? "");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(duration).not.toHaveText(before ?? "");
});
