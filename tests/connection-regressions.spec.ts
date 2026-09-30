import { expect, test } from "@playwright/test";

test("history selector keeps the standard height in compact dashboards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto("/?view=dashboard");
  await expect(page.getByLabel("이력 조회 대상")).toHaveCSS("height", "36px");
});

test("save failures remain visible after switching to an unsupported platform", async ({
  page,
}) => {
  await page.route("**/src/bridge.ts", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "const validated = settingsSchema.parse(settings);";
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        'throw new Error("Synthetic save failure");',
      ),
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  const dialog = page.getByRole("dialog", { name: "서비스 연결" });
  await dialog.getByRole("checkbox").uncheck();
  await dialog.getByLabel("플랫폼 검색").fill("Firebase");
  await dialog.getByRole("tab", { name: "Firebase", exact: true }).click();
  await dialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "설정을 저장하지 못했습니다",
  );
  await expect(dialog.getByRole("button", { name: "설정 저장" })).toBeEnabled();
});

test("connection guidance preserves isolated sessions and names the AWS profile", async ({
  page,
}) => {
  await page.route("**/src/bridge.ts", async (route) => {
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
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  const dialog = page.getByRole("dialog", { name: "서비스 연결" });
  await dialog.getByLabel("연결할 계정").selectOption("github:isolated-test");
  const guide = dialog.getByRole("region", { name: "연결 순서" });
  await expect(guide).toContainText(
    "앱의 ‘브라우저로 로그인’을 사용해 이 연결만 인증하세요",
  );
  await expect(guide).not.toContainText("gh auth login");
  await dialog.getByRole("tab", { name: "AWS", exact: true }).click();
  await expect(guide).toContainText("development");
  await expect(guide).toContainText("aws sso login --profile <프로필>");
  expect(
    await guide
      .locator("li")
      .evaluateAll((items) =>
        items.every((item) => item.scrollWidth <= item.clientWidth),
      ),
  ).toBe(true);
});
