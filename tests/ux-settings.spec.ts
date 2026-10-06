import { expect, test, type Page } from "@playwright/test";
import type { Snapshot } from "../src/domain";

const openSettings = async (page: Page) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  return page.getByRole("tabpanel", { name: "서비스 연결", exact: true });
};
const expose = async (page: Page, failAliases = false) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    let source = (await response.text()).replace(
      "export const bridge = {",
      "export const bridge = window.__testBridge = {",
    );
    if (failAliases)
      source = source
        .replace(
          "let preview = demoSnapshot();",
          "let preview = demoSnapshot(); let aliasFailures = 1;",
        )
        .replace(
          "const validated = settingsChangeSchema.parse(change);",
          'if (change.kind === "accountAlias" && aliasFailures-- > 0) throw new Error("Synthetic save failed"); const validated = settingsChangeSchema.parse(change);',
        );
    await route.fulfill({ response, body: source });
  });
};
const saved = (page: Page) =>
  page.evaluate(async () =>
    (
      window as unknown as {
        __testBridge: { snapshot: () => Promise<Snapshot> };
      }
    ).__testBridge.snapshot(),
  );

test("alias cancel discards changes and retry saves the latest draft with confirmation", async ({
  page,
}) => {
  await expose(page, true);
  const connections = await openSettings(page);
  await connections.getByRole("button", { name: "별칭 편집" }).click();
  const input = connections.getByLabel("계정 별칭");
  await input.fill("취소할 이름");
  await input.press("Escape");
  await expect(input).toHaveValue("alex");
  expect(
    (await saved(page)).settings.preferences.accountAliases["github:local"],
  ).toBeUndefined();
  await input.fill("실패한 이름");
  await connections.getByRole("button", { name: "별칭 저장" }).click();
  await expect(connections.getByRole("alert")).toBeVisible();
  await input.fill("  새 이름  ");
  await connections.getByRole("button", { name: "다시 시도" }).click();
  await expect(connections.locator(".save-result")).toHaveText("저장됨");
  await expect(input).toHaveValue("새 이름");
  expect(
    (await saved(page)).settings.preferences.accountAliases["github:local"],
  ).toBe("새 이름");
  await input.fill("");
  await connections.getByRole("button", { name: "별칭 저장" }).click();
  await expect(input).toHaveValue("alex");
  await expect(connections.locator(".save-result")).toHaveText("저장됨");
});

test("newly monitored projects default to mine and all results without enabling the master switch", async ({
  page,
}) => {
  await expose(page);
  const connections = await openSettings(page);
  await connections
    .getByRole("button", { name: "전체 해제", exact: true })
    .click();
  await expect(
    connections.getByRole("button", { name: "전체 선택", exact: true }),
  ).toBeVisible();
  await connections
    .getByRole("button", { name: "전체 선택", exact: true })
    .click();
  await expect(
    connections.getByRole("button", { name: "전체 해제", exact: true }),
  ).toBeVisible();
  const snapshot = await saved(page);
  expect(snapshot.settings.preferences.notifications.enabled).toBe(false);
  const rule = snapshot.settings.preferences.notifications.rules.find(
    (rule) => rule.targetKey === "github:github:local:github:orbit/web",
  );
  expect(rule).toMatchObject({
    enabled: true,
    scope: "mine",
    statuses: ["success", "failed", "canceled"],
  });
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "실행 결과 알림 받기" });
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.getByLabel(/orbit\/web.*알림 대상/)).toHaveValue("mine");
});

test("service/project display scopes inherit explicitly and preserve independent notifications", async ({
  page,
}) => {
  await expose(page);
  const connections = await openSettings(page);
  const service = connections.getByLabel("서비스 기본 표시", { exact: true });
  const project = connections.getByLabel("orbit/web · 프로젝트 표시 범위", {
    exact: true,
  });
  await service.selectOption("all");
  await expect(project.locator("option:checked")).toContainText("전체 실행");
  await project.selectOption("mine");
  await service.selectOption("mine");
  await project.selectOption("all");
  await page.getByRole("button", { name: /^전체 서비스/ }).click();
  await expect(page.getByText("서비스·프로젝트별 설정 적용 중")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "전체 실행", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(project).toHaveValue("all");
  const snapshot = await saved(page);
  expect(snapshot.settings.displayScopes).toEqual({
    providers: { github: "mine" },
    targets: { "github:github:local:github:orbit/web": "all" },
  });
  expect(snapshot.settings.preferences.notifications.enabled).toBe(false);
  await project.selectOption("inherit");
  await expect(project.locator("option:checked")).toContainText("내 실행만");
});

for (const width of [1080, 720, 360]) {
  test(`essential connection actions remain clear and unclipped at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    const connections = await openSettings(page);
    await expect(
      connections.getByLabel("서비스", { exact: true }),
    ).toBeVisible();
    await expect(
      connections.getByLabel("연결할 계정", { exact: true }),
    ).toBeVisible();
    expect(
      (await connections
        .getByRole("button", { name: "연결 및 대상 확인" })
        .boundingBox())!.y,
    ).toBeLessThan(780);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/design-connections-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("tab", { name: "알림", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/design-notifications-${width}.png`,
      fullPage: true,
    });
  });
}

test("clearing an alias can retry without losing saved confirmation", async ({
  page,
}) => {
  await expose(page, true);
  const connections = await openSettings(page);
  await connections.getByRole("button", { name: "별칭 편집" }).click();
  await connections.getByLabel("계정 별칭").fill("");
  await connections.getByRole("button", { name: "별칭 저장" }).click();
  await expect(connections.getByRole("alert")).toBeVisible();
  await connections.getByRole("button", { name: "다시 시도" }).click();
  await expect(connections.locator(".save-result")).toHaveText("저장됨");
  await expect(connections.getByLabel("계정 별칭")).toHaveValue("alex");
  expect(
    (await saved(page)).settings.preferences.accountAliases["github:local"],
  ).toBeUndefined();
});

test("menu bar bulk selection toggles one action per group", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole("tab", { name: "메뉴 막대", exact: true }).click();
  const projects = page.getByRole("group", {
    name: "표시할 프로젝트",
    exact: true,
  });
  await projects
    .getByRole("button", { name: "전체 해제", exact: true })
    .click();
  await expect(projects.getByRole("checkbox").first()).not.toBeChecked();
  await expect(
    projects.getByRole("button", { name: "전체 해제", exact: true }),
  ).toHaveCount(0);
  await projects
    .getByRole("button", { name: "전체 선택", exact: true })
    .click();
  for (const checkbox of await projects.getByRole("checkbox").all())
    await expect(checkbox).toBeChecked();
});

test("connection's next action fits the 720 by 520 compact desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const connections = await openSettings(page);
  const action = connections.getByRole("button", { name: "연결 및 대상 확인" });
  const bounds = (await action.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(520);
  await expect(action).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/design-connections-720x520.png" });
});

test("returning to a service's display settings selects that service every time", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^Vercel/ })
    .click();
  await page.getByRole("button", { name: "프로젝트별 표시 설정" }).click();
  await expect(page.getByLabel("서비스", { exact: true })).toHaveValue(
    "vercel",
  );
  await page.getByLabel("서비스", { exact: true }).selectOption("github");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^Vercel/ })
    .click();
  await page.getByRole("button", { name: "프로젝트별 표시 설정" }).click();
  await expect(page.getByLabel("서비스", { exact: true })).toHaveValue(
    "vercel",
  );
});
