import { expect, test } from "@playwright/test";

test("history selector keeps the standard height in compact dashboards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto("/?view=dashboard");
  await expect(page.getByLabel("이력 조회 대상")).toHaveCSS("height", "36px");
});

test("failed changes roll back and can retry per item", async ({ page }) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "const validated = settingsChangeSchema.parse(change);";
    const previewMarker = "let preview = demoSnapshot();";
    const bridgeMarker = "export const bridge = {";
    expect(source).toContain(marker);
    expect(source).toContain(previewMarker);
    expect(source).toContain(bridgeMarker);
    await route.fulfill({
      response,
      body: source
        .replace(previewMarker, `${previewMarker}\nlet syntheticFailures = 0;`)
        .replace(bridgeMarker, "export const bridge = window.__testBridge = {")
        .replace(
          marker,
          `if (syntheticFailures++ === 0) throw new Error("Synthetic change failure"); ${marker}`,
        ),
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });
  await connections.getByRole("checkbox").click();
  await expect(connections.getByRole("alert")).toContainText(
    "변경하지 못했습니다",
  );
  await expect(connections.getByRole("checkbox")).toBeChecked();
  await connections.getByRole("button", { name: "다시 시도" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const snapshot = await (
          window as unknown as {
            __testBridge: {
              snapshot: () => Promise<import("../src/domain").Snapshot>;
            };
          }
        ).__testBridge.snapshot();
        return snapshot.settings.targets.some(
          (target) => target.id === "github:orbit/web",
        );
      }),
    )
    .toBe(false);
  await expect(connections.getByRole("alert")).toHaveCount(0);
  await expect(connections.getByRole("checkbox")).not.toBeChecked();
});

test("connection guidance preserves isolated sessions and names the AWS profile", async ({
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
      preview = { ...preview,
        settings: { ...preview.settings, accounts: [...preview.settings.accounts,
          {id: "github:isolated-test", provider: "github", label: "별도 계정", mode: "isolated", profile: null}] },
        connections: preview.connections.map(connection => connection.provider === "aws"
          ? {...connection, status: "signed_out"} : connection)
      };`,
      ),
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });
  await connections
    .getByLabel("연결할 계정")
    .selectOption("github:isolated-test");
  const guide = connections.locator("details.connection-help").first();
  await guide.locator("summary").click();
  await expect(guide).toContainText("gh auth login");
  await connections.getByLabel("서비스", { exact: true }).selectOption("aws");
  await expect(guide).toContainText("development");
  await expect(guide).toContainText("aws sso login --profile <profile>");
  expect(
    await guide
      .locator("li")
      .evaluateAll((items) =>
        items.every((item) => item.scrollWidth <= item.clientWidth),
      ),
  ).toBe(true);
});

test("connection target changes save immediately", async ({ page }) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });
  const target = connections.locator(".target-option input").first();
  await target.uncheck();
  await expect(target).not.toBeChecked();
  await expect(
    connections.getByRole("button", { name: "설정 저장", exact: true }),
  ).toHaveCount(0);
});

test("bulk target actions only update visible results in the current account", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const previewMarker = "let preview = demoSnapshot();";
    const bridgeMarker = "export const bridge = {";
    const changeMarker =
      "const validated = settingsChangeSchema.parse(change);";
    expect(source).toContain(previewMarker);
    expect(source).toContain(bridgeMarker);
    expect(source).toContain(changeMarker);
    await route.fulfill({
      response,
      body: source
        .replace(
          previewMarker,
          `${previewMarker}
      const alpha = {...preview.settings.targets[0], id: "github:alpha", name: "alpha/app"};
      const beta = {...preview.settings.targets[0], id: "github:beta", name: "beta/app"};
      const other = {...preview.settings.targets[0], id: "github:other", connectionId: "github:other", name: "other/app"};
      preview = {...preview, settings: {...preview.settings,
        accounts: [...preview.settings.accounts, {id: "github:other", provider: "github", label: "Other", mode: "local"}],
        targets: [alpha, beta, other, ...preview.settings.targets.slice(1)]
      }};
      let bulkChangeCount = 0;`,
        )
        .replace(bridgeMarker, "export const bridge = window.__testBridge = {")
        .replace(
          changeMarker,
          `${changeMarker}\n    if (validated.kind === "targets") bulkChangeCount += 1;`,
        )
        .replace(
          "snapshot: async () =>",
          "bulkChangeCount: () => bulkChangeCount,\n  snapshot: async () =>",
        ),
    });
  });

  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });
  await connections.getByLabel("대상 검색").fill("no matching target");
  await expect(
    connections.getByRole("button", { name: "전체 선택" }),
  ).toBeDisabled();
  await expect(
    connections.getByRole("button", { name: "전체 해제" }),
  ).toHaveCount(0);
  await connections.getByLabel("대상 검색").fill("alpha");
  await connections.getByRole("button", { name: "전체 해제" }).click();

  type TestBridge = {
    bulkChangeCount: () => number;
    snapshot: () => Promise<import("../src/domain").Snapshot>;
  };
  const stateAfterDeselect = await page.evaluate(async () => {
    const bridge = (window as unknown as { __testBridge: TestBridge })
      .__testBridge;
    return {
      count: bridge.bulkChangeCount(),
      snapshot: await bridge.snapshot(),
    };
  });
  expect(stateAfterDeselect.count).toBe(1);
  expect(
    stateAfterDeselect.snapshot.settings.targets.map((target) => target.id),
  ).toEqual(expect.arrayContaining(["github:beta", "github:other"]));
  expect(
    stateAfterDeselect.snapshot.settings.targets.map((target) => target.id),
  ).not.toContain("github:alpha");

  await connections.getByRole("button", { name: "전체 선택" }).click();
  const stateAfterSelect = await page.evaluate(async () => {
    const bridge = (window as unknown as { __testBridge: TestBridge })
      .__testBridge;
    return {
      count: bridge.bulkChangeCount(),
      snapshot: await bridge.snapshot(),
    };
  });
  expect(stateAfterSelect.count).toBe(2);
  expect(
    stateAfterSelect.snapshot.settings.targets.map((target) => target.id),
  ).toEqual(
    expect.arrayContaining(["github:alpha", "github:beta", "github:other"]),
  );
});

test("a narrowed bulk target failure stays visible and retryable", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const previewMarker = "let preview = demoSnapshot();";
    const changeMarker =
      "const validated = settingsChangeSchema.parse(change);";
    expect(source).toContain(previewMarker);
    expect(source).toContain(changeMarker);
    await route.fulfill({
      response,
      body: source
        .replace(
          previewMarker,
          `${previewMarker}
      const alpha = {...preview.settings.targets[0], id: "github:alpha", name: "alpha/app"};
      const beta = {...preview.settings.targets[0], id: "github:beta", name: "beta/app"};
      preview = {...preview, settings: {...preview.settings,
        targets: [alpha, beta, ...preview.settings.targets.slice(1)]
      }};
      let failNextBulkChange = true;`,
        )
        .replace(
          changeMarker,
          `${changeMarker}
    if (validated.kind === "targets" && failNextBulkChange) {
      failNextBulkChange = false;
      throw new Error("Synthetic bulk failure");
    }`,
        ),
    });
  });

  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });
  await connections.getByRole("button", { name: "전체 해제" }).click();
  await expect(connections.getByRole("alert")).toContainText(
    "변경하지 못했습니다",
  );

  await connections
    .locator(".target-option")
    .filter({ hasText: "alpha/app" })
    .getByRole("checkbox")
    .uncheck();
  await expect(connections.getByRole("alert")).toContainText(
    "변경하지 못했습니다",
  );
  await connections.getByRole("button", { name: "다시 시도" }).click();

  await expect(connections.getByRole("alert")).toHaveCount(0);
  await expect(
    connections
      .locator(".target-option")
      .filter({ hasText: "alpha/app" })
      .getByRole("checkbox"),
  ).not.toBeChecked();
  await expect(
    connections
      .locator(".target-option")
      .filter({ hasText: "beta/app" })
      .getByRole("checkbox"),
  ).not.toBeChecked();
});
