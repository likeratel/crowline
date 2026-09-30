import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 420, height: 540 } });

test("an open settings draft preserves another window's changes and account removal", async ({
  page,
}) => {
  await page.route("**/src/bridge.ts", async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(
      "if (isPreview) return () => {};",
      `if (isPreview) {
        const update = (event) => { preview = event.detail; handler(preview); };
        window.addEventListener("test-snapshot", update);
        return () => window.removeEventListener("test-snapshot", update);
      }`,
    );
    await route.fulfill({ response, body: source });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await page.getByRole("checkbox").uncheck();
  await page.evaluate(async () => {
    const modulePath = "/src/demo.ts";
    const { demoSnapshot } = await import(modulePath);
    const snapshot = demoSnapshot();
    window.dispatchEvent(
      new CustomEvent("test-snapshot", {
        detail: {
          ...snapshot,
          settings: {
            ...snapshot.settings,
            accounts: snapshot.settings.accounts.filter(
              (item: { provider: string }) => item.provider !== "vercel",
            ),
            targets: snapshot.settings.targets.filter(
              (item: { provider: string }) => item.provider !== "vercel",
            ),
          },
        },
      }),
    );
  });
  await expect(page.getByText("총 1개 대상", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("button", { name: "설정 저장" }).click();
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await expect(page.getByText("총 1개 대상", { exact: true })).toBeVisible();
});

test("default view is a compact summary with dashboard entry and no settings controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("main", { name: "배포 요약" })).toBeVisible();
  await expect(page.locator(".summary-grid")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "진행 중", exact: true })
      .locator(".panel-run"),
  ).toHaveCount(2);
  await expect(page.getByLabel("서비스 필터")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "연결 및 설정" })).toHaveCount(
    0,
  );
  await page.screenshot({ path: "artifacts/crowline-panel.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "대시보드 열기" }).click();
  await expect(page).toHaveURL(/view=dashboard/);
  await expect(
    page.getByRole("heading", { name: "배포 현황", exact: true }),
  ).toBeVisible();
});

test("connection controls remain usable in a narrow dashboard", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await expect(page.getByRole("dialog", { name: "서비스 연결" })).toBeVisible();
  await page.getByRole("tab", { name: "AWS", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "프로필", exact: true }),
  ).toHaveValue("development");
  await expect(page.getByRole("button", { name: "설정 저장" })).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/crowline-panel-settings.png" });
});

test("adds a separate account without inheriting another account's selected targets", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await page.getByRole("button", { name: "계정 추가", exact: true }).click();
  await page
    .getByRole("textbox", { name: "계정 이름", exact: true })
    .fill("회사");
  await page
    .getByRole("button", { name: "계정 연결 추가", exact: true })
    .click();
  await expect(page.getByLabel("연결할 계정")).toContainText("회사");
  await page.getByRole("button", { name: "연결 및 대상 확인" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.getByLabel("계정 필터")).toContainText("회사");
  await page
    .getByLabel("계정 필터")
    .selectOption({ label: "GitHub Actions · 회사" });
  await expect(page.locator(".activity-row")).toHaveCount(0);
});

test("keeps login feedback per account and preserves other selections on removal", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "연결 및 설정" }).click();
  await page.getByRole("button", { name: "브라우저로 로그인" }).click();
  const feedback = page.getByText(
    "로그인은 데스크톱 앱에서 사용할 수 있습니다.",
  );
  await expect(feedback).toBeVisible();
  await page.getByRole("button", { name: "계정 추가", exact: true }).click();
  await page
    .getByRole("textbox", { name: "계정 이름", exact: true })
    .fill("회사");
  await page
    .getByRole("button", { name: "계정 연결 추가", exact: true })
    .click();
  await expect(feedback).not.toBeVisible();
  await page.getByRole("button", { name: "연결 및 대상 확인" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "브라우저로 로그인" }).click();
  await page.getByLabel("연결할 계정").selectOption("github:local");
  await expect(feedback).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByLabel("연결할 계정").selectOption({ label: "회사" });
  await page.getByRole("button", { name: "이 계정 연결 제거" }).click();
  await expect(page.getByLabel("연결할 계정")).toHaveValue("github:local");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(page.getByText("총 3개 대상", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.getByLabel("계정 필터")).not.toContainText("회사");
});

test("saved panel preferences affect the panel while preserving dashboard rows", async ({
  page,
}) => {
  // Switch the mounted view without reloading the synthetic in-memory backend.
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace(
        'ReactDOM.createRoot(document.getElementById("root"))',
        '(window.__testRoot = ReactDOM.createRoot(document.getElementById("root")))',
      )
      .replace(
        'new URLSearchParams(window.location.search).get("view") === "dashboard"',
        '(window.__showPanel = () => window.__testRoot.render(React.createElement(TrayPanel)), new URLSearchParams(window.location.search).get("view") === "dashboard")',
      );
    await route.fulfill({ response, body: source });
  });
  await page.goto("/?view=dashboard");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { __showPanel?: () => void })
            .__showPanel,
      ),
    )
    .toBe("function");
  const dashboardCount = await page.locator(".activity-row").count();
  await page
    .getByRole("button", { name: "상태바 표시 설정", exact: true })
    .click();
  await page
    .getByRole("group", { name: "표시할 서비스" })
    .getByLabel("Vercel", { exact: true })
    .uncheck();
  await page.getByLabel("최근 종료 표시", { exact: true }).uncheck();
  await page.getByLabel("섹션별 표시 건수").selectOption("1");
  await page.getByRole("button", { name: "표시 설정 저장" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "상태바 표시 설정을 저장했습니다.",
  );
  await page.getByRole("button", { name: /전체 서비스/ }).click();
  await expect(page.locator(".activity-row")).toHaveCount(dashboardCount);
  await page
    .getByRole("button", { name: "상태바 표시 설정", exact: true })
    .click();
  await expect(page.getByLabel("섹션별 표시 건수")).toHaveValue("1");
  await expect(
    page.getByLabel("최근 종료 표시", { exact: true }),
  ).not.toBeChecked();
  await page.screenshot({
    path: "artifacts/crowline-panel-preferences.png",
    fullPage: true,
  });
  await page.evaluate(() =>
    (window as unknown as { __showPanel: () => void }).__showPanel(),
  );
  await expect(page.getByRole("main", { name: "배포 요약" })).toBeVisible();
  await expect(page.locator(".panel-run")).toHaveCount(1);
  await expect(
    page.getByText("Deploy production", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "최근 24시간" })).toHaveCount(
    0,
  );
});

test("summary rows show loaded platform logos alongside their status", async ({
  page,
}) => {
  await page.goto("/?view=panel");
  const rows = page.locator(".panel-run");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const provider = row.getByRole("img");
    await expect(provider).toHaveAttribute("aria-label", /GitHub|Vercel|AWS/);
    await expect(provider.locator("img")).toHaveAttribute(
      "src",
      /^\/providers\/(github|vercel|aws)\.svg$/,
    );
    expect(
      await provider
        .locator("img")
        .evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
    ).toBe(true);
    await expect(row.locator(".run-symbol")).toBeVisible();
  }
  await expect(page.locator(".panel-run-meta")).not.toContainText(["VC "]);
});
