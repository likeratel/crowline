import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page, patch: string, view = "/?view=dashboard") {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\n${patch}`,
    });
  });
  await page.goto(view);
}

test("status filters narrow executions without saving display or notification settings", async ({
  page,
}) => {
  await scenario(
    page,
    `
    window.evolutionChanges = [];
    const originalChange = bridge.change;
    bridge.change = async change => { window.evolutionChanges.push(change); return originalChange(change); };
  `,
  );
  const filters = page.getByRole("group", { name: "실행 상태", exact: true });
  await filters.getByRole("button", { name: "실패 1", exact: true }).click();
  await expect(page.locator(".activity-row")).toHaveCount(1);
  await expect(page.locator(".activity-row")).toContainText(
    "Preview deployment",
  );
  await filters
    .getByRole("button", { name: "상태 미확인 0", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "이 상태에 해당하는 실행이 없습니다" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "전체 상태 보기", exact: true })
    .click();
  await expect(page.locator(".activity-row")).toHaveCount(5);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { evolutionChanges: unknown[] }).evolutionChanges,
    ),
  ).toEqual([]);
});

test("a healthy project cannot make another project's failed old data look current", async ({
  page,
}) => {
  await scenario(
    page,
    `
    preview = {...preview, queryHealth: preview.queryHealth.map(row => row.provider === 'vercel' ? {
      ...row, status: 'error', lastSuccessfulAt: new Date(Date.now()-3600000).toISOString()
    } : row)};
  `,
  );
  const summary = page.locator(".main-header .query-summary");
  await expect(summary).toContainText("조회 실패");
  await expect(summary).toContainText("2/3개 프로젝트 최신");
  await page.getByRole("button", { name: /^Vercel/ }).click();
  await expect(summary).toContainText("0/1개 프로젝트 최신");
  await expect(page.locator(".activity-row")).toHaveCount(2);
  await expect(page.locator(".service-health")).toHaveAttribute("open", "");
  await expect(page.locator(".query-target")).toContainText("조회 실패");
  await expect(page.locator(".query-target")).toContainText("1시간 전");
});

test("long running observations stay visible and never become a fabricated failure", async ({
  page,
}) => {
  await scenario(
    page,
    `
    preview = {...preview, activities: preview.activities.map(item => item.id === 'g1' ? {
      ...item, startedAt: new Date(Date.now()-30*3600000).toISOString()
    } : item)};
  `,
  );
  const row = page
    .locator(".activity-row")
    .filter({ hasText: "Deploy production" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("실행 중");
  await expect(row).toContainText("장시간 진행");
});

test("legacy or first-query data is unknown even if the global refresh timestamp is new", async ({
  page,
}) => {
  await scenario(page, "preview = {...preview, queryHealth: []};");
  const summary = page.locator(".main-header .query-summary");
  await expect(summary).toContainText("조회 전");
  await expect(summary).toContainText("0/3개 프로젝트 최신");
  await expect(summary).toContainText("아직 전체 조회가 완료되지 않았습니다");
});

test("focus recovery coalesces events and online recovery still signals during an active query", async ({
  page,
}) => {
  await scenario(
    page,
    `
    preview = {...preview, queryHealth: preview.queryHealth.map(row => ({...row,
      lastAttemptAt: new Date(Date.now()-600000).toISOString(), lastSuccessfulAt: new Date(Date.now()-600000).toISOString()}))};
    window.evolutionWakeCount = 0;
    bridge.requestRefresh = async () => { window.evolutionWakeCount++; };
    bridge.subscribe = async handler => {
      window.evolutionPublishActive = () => {
        preview = {...preview, refreshing: true};
        handler(preview);
      };
      return () => {};
    };
  `,
  );
  await expect(page.locator(".main-header .query-summary")).toContainText(
    "오래된 결과",
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  const count = () =>
    page.evaluate(
      () =>
        (window as unknown as { evolutionWakeCount: number })
          .evolutionWakeCount,
    );
  await expect.poll(count).toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as { evolutionPublishActive: () => void }
    ).evolutionPublishActive(),
  );
  await expect(
    page.getByRole("button", { name: "새로고침", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(count).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(count).toBe(3);
});

test("the tray reports health only for the projects it displays", async ({
  page,
}) => {
  await scenario(
    page,
    `
    preview = {...preview, settings:{...preview.settings, panel:{...preview.settings.panel, providers:['github']}},
      queryHealth:preview.queryHealth.map(row=>row.provider==='vercel'?{...row,status:'error'}:row)};
  `,
    "/",
  );
  const summary = page.locator(".panel-query-summary");
  await expect(summary).toContainText("최신 결과");
  await expect(summary).toContainText("1/1개 프로젝트 최신");
  await expect(summary).not.toContainText("조회 실패");
});

for (const width of [1080, 720, 360]) {
  test(`monitoring overview is readable without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto("/?view=dashboard");
    await expect(
      page.getByRole("group", { name: "실행 상태", exact: true }),
    ).toBeVisible();
    const size = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width);
    await page.screenshot({
      path: `artifacts/evolution-dashboard-${width}.png`,
      fullPage: true,
    });
  });
}
