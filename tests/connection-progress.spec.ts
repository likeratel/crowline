import { expect, test, type Page } from "@playwright/test";

async function withSnapshot(page: Page, change: string) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "let preview = demoSnapshot();";
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(marker, `${marker}\n${change}`),
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  return page.getByRole("tabpanel", { name: "서비스 연결", exact: true });
}

test("a saved project stays incomplete until its first remote query succeeds", async ({
  page,
}) => {
  const connections = await withSnapshot(
    page,
    "preview = { ...preview, queryHealth: [] };",
  );
  const progress = connections.getByLabel("연결 진행 상태");

  await expect(progress).toContainText("1개 프로젝트가 저장되었습니다.");
  await expect(progress).toContainText(
    "프로젝트는 저장되었지만 원격 조회는 아직 완료되지 않았습니다.",
  );
  await expect(progress).not.toContainText("원격 조회를 완료했습니다.");
  await expect(
    progress.getByRole("button", { name: "다시 조회" }),
  ).toBeVisible();
});

for (const [status, expected] of [
  ["partial", "일부 프로젝트의 원격 조회가 완료되지 않았습니다."],
  ["error", "원격 조회에 실패했습니다."],
] as const) {
  test(`reports a ${status} remote query separately from success`, async ({
    page,
  }) => {
    const connections = await withSnapshot(
      page,
      `preview = {
        ...preview,
        queryHealth: preview.queryHealth.map((health) =>
          health.targetId === "github:orbit/web"
            ? { ...health, status: "${status}", lastSuccessfulAt: null }
            : health,
        ),
      };`,
    );
    const progress = connections.getByLabel("연결 진행 상태");
    await expect(progress).toContainText(expected);
    await expect(progress).not.toContainText("원격 조회를 완료했습니다.");
  });
}

for (const [status, expected] of [
  ["missing-cli", "필요한 CLI를 찾지 못했습니다."],
  ["signed-out", "원격 계정 확인이 필요합니다."],
] as const) {
  test(`shows the next account action when the connection is ${status}`, async ({
    page,
  }) => {
    const connections = await withSnapshot(
      page,
      `preview = {
        ...preview,
        connections: preview.connections.map((connection) =>
          connection.connectionId === "github:local"
            ? { ...connection, status: "${status}" }
            : connection,
        ),
      };`,
    );
    const progress = connections.getByLabel("연결 진행 상태");

    await expect(progress).toContainText(expected);
    await progress.getByRole("button", { name: "계정 관리" }).first().click();
    const authentication = connections.locator("#connection-authentication");
    await expect(authentication).toHaveAttribute("open", "");
    await expect
      .poll(() =>
        authentication.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      )
      .toBe(true);
  });
}

test("keeps a verified existing account and successful query compact", async ({
  page,
}) => {
  const connections = await withSnapshot(page, "");
  const progress = connections.getByLabel("연결 진행 상태");

  await expect(progress).toContainText("CLI를 확인했습니다.");
  await expect(progress).toContainText("현재 계정을 원격으로 확인했습니다.");
  await expect(progress).toContainText("원격 조회를 완료했습니다.");
  await expect(progress.getByRole("button")).toHaveCount(0);
});

test("account verification guidance performs verification and recovers the progress", async ({
  page,
}) => {
  const connections = await withSnapshot(
    page,
    `preview = {
    ...preview,
    connections: preview.connections.map((connection) =>
      connection.connectionId === "github:local"
        ? { ...connection, status: "error" }
        : connection,
    ),
  };`,
  );
  const progress = connections.getByLabel("연결 진행 상태");
  await progress
    .getByRole("button", { name: "계정 확인", exact: true })
    .click();
  await expect(progress).toContainText("현재 계정을 원격으로 확인했습니다.");
  await expect(
    progress.getByRole("button", { name: "계정 확인", exact: true }),
  ).toHaveCount(0);
});

test("project guidance focuses a project selection control", async ({
  page,
}) => {
  const connections = await withSnapshot(
    page,
    `preview = {
    ...preview,
    settings: { ...preview.settings, targets: preview.settings.targets.filter((target) => target.connectionId !== "github:local") },
  };`,
  );
  await connections
    .getByLabel("연결 진행 상태")
    .getByRole("button", { name: "프로젝트 선택", exact: true })
    .first()
    .click();
  const discover = connections.getByRole("button", {
    name: "연결 및 대상 확인",
    exact: true,
  });
  await expect(discover).toBeFocused();
  await discover.click();
  await connections
    .getByLabel("연결 진행 상태")
    .getByRole("button", { name: "프로젝트 선택", exact: true })
    .first()
    .click();
  await expect(
    connections.locator(".target-option input").first(),
  ).toBeFocused();
});

test("keeps the first project control visible at 720 by 520 and avoids narrow overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  let connections = await withSnapshot(page, "");
  const firstProject = connections.locator(".target-option input").first();
  await expect(firstProject).toBeInViewport();

  await page.setViewportSize({ width: 360, height: 640 });
  connections = page.getByRole("tabpanel", {
    name: "서비스 연결",
    exact: true,
  });
  await expect(connections.getByLabel("연결 진행 상태")).toBeVisible();
  expect(
    await connections
      .locator(".connection-progress")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
