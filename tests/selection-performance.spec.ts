import { expect, test, type Page } from "@playwright/test";

async function slowRefreshScenario(page: Page, count: number) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const seed = "let preview = demoSnapshot();";
    expect(original).toContain(seed);
    await route.fulfill({
      response,
      body:
        original.replace(
          seed,
          `${seed}\npreview = {...preview, settings: {...preview.settings, targets: Array.from({length:${count}}, (_, index) => ({...preview.settings.targets[0], id: 'github:sample/project-' + index, name: 'sample/project-' + index}))}};`,
        ) +
        "\nwindow.__qaRefreshCount = 0; const originalRefresh = bridge.refresh; bridge.refresh = async () => { window.__qaRefreshCount += 1; await new Promise(resolve => setTimeout(resolve, 8000)); return originalRefresh(); };",
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  return page.getByRole("tabpanel", { name: "서비스 연결", exact: true });
}

for (const count of [20, 200]) {
  test(`bulk selection of ${count} projects is independent of an 8s provider refresh`, async ({
    page,
  }, testInfo) => {
    // The refresh is stubbed to take 8 s; the UI must become usable well before
    // that even on slow CI runners, so 4 s is the bound rather than 1.5 s.
    const connections = await slowRefreshScenario(page, count);
    const started = Date.now();
    await connections
      .getByRole("button", { name: "전체 해제", exact: true })
      .click();
    await expect(
      connections.getByRole("button", { name: "전체 선택", exact: true }),
    ).toBeEnabled({ timeout: 10_000 });
    const elapsed = Date.now() - started;
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __qaRefreshCount: number }).__qaRefreshCount,
      ),
    ).toBe(0);
    await testInfo.attach("bulk-feedback-latency", {
      body: JSON.stringify({
        projects: count,
        refreshDelayMs: 8000,
        usableAfterMs: elapsed,
      }),
      contentType: "application/json",
    });
    expect(
      elapsed,
      "settings become usable without waiting for provider IO",
    ).toBeLessThan(4000);
    const selectStarted = Date.now();
    await connections
      .getByRole("button", { name: "전체 선택", exact: true })
      .click();
    await expect(
      connections.getByRole("button", { name: "전체 해제", exact: true }),
    ).toBeEnabled({ timeout: 4000 });
    const selectElapsed = Date.now() - selectStarted;
    await testInfo.attach("bulk-select-latency", {
      body: JSON.stringify({
        projects: count,
        refreshDelayMs: 8000,
        usableAfterMs: selectElapsed,
      }),
      contentType: "application/json",
    });
    await expect(
      connections.getByLabel("서비스", { exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __qaRefreshCount: number }).__qaRefreshCount,
      ),
    ).toBe(1);
    // Editing during that same remote request must not enqueue a second refresh.
    await connections
      .getByRole("button", { name: "전체 해제", exact: true })
      .click();
    await expect(
      connections.getByRole("button", { name: "전체 선택", exact: true }),
    ).toBeEnabled();
    await connections
      .getByRole("button", { name: "전체 선택", exact: true })
      .click();
    await expect(
      connections.getByRole("button", { name: "전체 해제", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __qaRefreshCount: number }).__qaRefreshCount,
      ),
    ).toBe(1);
  });
}
