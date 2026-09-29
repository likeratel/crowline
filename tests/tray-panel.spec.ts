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
  await page.goto("/");
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

test("default view is a compact black summary with functional filters", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("main", { name: "배포 요약" })).toBeVisible();
  await expect(page.locator(".summary-grid")).toHaveCount(0);
  await expect(
    page.getByText("미리보기 · 가상 데이터", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "진행 중", exact: true })
      .locator(".panel-run"),
  ).toHaveCount(2);
  await page.screenshot({ path: "artifacts/crowline-panel.png" });
  await page.getByRole("button", { name: "전체", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "진행 중", exact: true })
      .locator(".panel-run"),
  ).toHaveCount(3);
  await page.getByLabel("서비스 필터").selectOption("github");
  await expect(
    page
      .getByRole("region", { name: "진행 중", exact: true })
      .locator(".panel-run"),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "상세 보기" }).click();
  await expect(page).toHaveURL(/view=dashboard/);
  await expect(
    page.getByRole("heading", { name: "배포 현황", exact: true }),
  ).toBeVisible();
});

test("connection controls remain usable inside the narrow panel", async ({
  page,
}) => {
  await page.goto("/");
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
  await page.goto("/");
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
  await expect(page.locator(".panel-run")).toHaveCount(0);
});

test("keeps login feedback per account and preserves other selections on removal", async ({
  page,
}) => {
  await page.goto("/");
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
