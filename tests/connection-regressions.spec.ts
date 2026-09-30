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
  const guide = connections.locator("details.connection-help");
  await guide.locator("summary").click();
  await expect(guide).toContainText(
    "앱의 ‘브라우저로 로그인’을 사용해 이 연결만 인증하세요",
  );
  await expect(guide).not.toContainText("gh auth login");
  await connections.getByRole("tab", { name: "AWS", exact: true }).click();
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
