import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page, patch: string) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "let preview = demoSnapshot();";
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source + `\n${patch}` });
  });
  await page.goto("/?view=dashboard");
}

for (const width of [1080, 720]) {
  test(`primary content is visible without scrolling at ${width} by 520`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 520 });
    await page.goto("/?view=dashboard");
    const activity = page.locator(".activity-row").first();
    await expect(activity).toBeVisible();
    const box = (await activity.boundingBox())!;
    expect(box.y + Math.min(box.height, 76)).toBeLessThan(520);
    await page.getByRole("button", { name: "설정", exact: true }).click();
    const firstProject = page.locator(".project-selection-row input").first();
    await expect(firstProject).toBeVisible();
    const projectBox = (await firstProject.boundingBox())!;
    expect(projectBox.y + projectBox.height).toBeLessThan(520);
  });
}

test("first use starts with an immediately reachable connection action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await scenario(
    page,
    "preview = {...preview, settings: {...preview.settings, targets: []}, activities: []};",
  );
  const connect = page.getByRole("button", {
    name: "서비스 연결하기",
    exact: true,
  });
  await expect(connect).toBeVisible();
  const box = (await connect.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(520);
  await expect(page.locator(".toolbar")).toHaveCount(0);
  await expect(page.getByText(/연결 확인 → 대상 선택 → 저장/)).toHaveCount(0);
  await page.screenshot({ path: "artifacts/qa-first-use-720.png" });
});

test("failed recheck appears above long project lists with honest connection status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await scenario(
    page,
    `
    preview = {...preview, settings: {...preview.settings, targets: Array.from({length:40}, (_, index) => ({...preview.settings.targets[0], id:'github:sample/project-'+index, name:'sample/project-'+index}))}};
    bridge.discover = async () => {throw new Error('Synthetic expired session');};
  `,
  );
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "연결 및 대상 확인", exact: true })
    .click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Synthetic expired session");
  const box = (await alert.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(520);
  await expect(page.locator(".connection-status-label")).toContainText(
    "재확인 실패",
  );
  await expect(page.locator(".project-selection-row")).toHaveCount(40);
  await page.screenshot({ path: "artifacts/qa-discovery-failure.png" });
});

test("service recovery opens the failing account even from All services", async ({
  page,
}) => {
  await scenario(
    page,
    `
    const original = preview.settings.accounts.find(account=>account.provider==='vercel');
    const extra = {...original, id:'vercel:secondary', label:'Second team', mode:'isolated'};
    preview = {...preview, settings:{...preview.settings, accounts:[...preview.settings.accounts,extra],targets:[...preview.settings.targets,{...preview.settings.targets.find(target=>target.provider==='vercel'),connectionId:extra.id}]},connections:[...preview.connections,{connectionId:extra.id,provider:'vercel',status:'signed-out',message:'Synthetic login required'}]};
  `,
  );
  await expect(page.locator(".service-health")).toHaveAttribute("open", "");
  const failing = page
    .locator(".service-health-row")
    .filter({ hasText: "Second team" });
  await failing.getByRole("button").click();
  const panel = page.getByRole("tabpanel", {
    name: "서비스 연결",
    exact: true,
  });
  await expect(panel.getByLabel("서비스", { exact: true })).toHaveValue(
    "vercel",
  );
  await expect(panel.getByLabel("연결할 계정", { exact: true })).toHaveValue(
    "vercel:secondary",
  );
  await expect(panel.locator(".connection-status-label")).toContainText(
    "로그인 필요",
  );
});

test("unconfigured updates cannot be enabled and notification search has a label", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("tab", { name: "일반", exact: true }).click();
  await expect(
    page.getByLabel("새 버전 자동 확인", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "릴리스 페이지", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  await expect(page.locator(".notification-search input")).toHaveAccessibleName(
    /.+/,
  );
});

test("another service's refresh cannot erase this account's failed verification", async ({
  page,
}) => {
  await scenario(
    page,
    `
    const discover = bridge.discover;
    bridge.discover = async (...args) => ({...await discover(...args), connection:{...preview.connections[0], status:'signed-out', message:'Synthetic expired session'}});
    bridge.subscribe = async (handler) => {
      window.__qaOtherRefresh = () => handler({...preview, lastUpdatedAt:new Date(Date.now()+1000).toISOString()});
      return () => {};
    };
  `,
  );
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "연결 및 대상 확인", exact: true })
    .click();
  await expect(page.locator(".connection-status-label")).toContainText(
    "로그인 필요",
  );
  await page.evaluate(() =>
    (window as unknown as { __qaOtherRefresh: () => void }).__qaOtherRefresh(),
  );
  await expect(page.locator(".connection-status-label")).toContainText(
    "로그인 필요",
  );
});

test("large histories render in pages while search covers every loaded run", async ({
  page,
}) => {
  await scenario(
    page,
    `
    const target = preview.settings.targets[0];
    const template = preview.activities.find(activity => activity.provider === 'github');
    preview = {...preview, settings:{...preview.settings, scope:'all'}, activities:Array.from({length:5000}, (_, index) => ({...template,id:'sample-run-'+index,targetId:target.id,connectionId:target.connectionId,title:index === 4999?'Find distant run':'Sample run '+index,status:'success',ownership:'mine',updatedAt:new Date(Date.now()-index*1000).toISOString(),finishedAt:new Date(Date.now()-index*1000).toISOString()}))};
  `,
  );
  const completed = page.getByRole("region", {
    name: "최근 종료",
    exact: true,
  });
  await expect(completed.locator(".activity-row")).toHaveCount(50);
  await expect(completed.locator(".activity-pagination")).toContainText(
    "50 / 5000",
  );
  await completed.getByRole("button", { name: "더 보기", exact: true }).click();
  await expect(completed.locator(".activity-row")).toHaveCount(100);
  await page
    .getByRole("textbox", { name: "실행 검색", exact: true })
    .fill("Find distant run");
  await expect(completed.locator(".activity-row")).toHaveCount(1);
  await expect(completed).toContainText("Find distant run");
  await page.getByRole("textbox", { name: "실행 검색", exact: true }).fill("");
  await expect(completed.locator(".activity-row")).toHaveCount(50);
});
