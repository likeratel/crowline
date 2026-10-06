import { expect, test, type Page } from "@playwright/test";

async function withBridgePatch(page: Page, patch: string) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\n${patch}`,
    });
  });
}

function firstDetailsButton(page: Page) {
  return page.getByRole("button", { name: /^상세:/ }).first();
}

function githubDetailsButton(page: Page) {
  return page.getByRole("button", { name: "상세: Deploy production" });
}

test("opens details from the keyboard and restores focus after Escape", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  const details = firstDetailsButton(page);
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(details).toBeFocused();
});

test("keeps provider, workflow, account, and target query context in details", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await githubDetailsButton(page).click();
  const details = page.locator("dialog[open]");
  await expect(details).toContainText("GitHub Actions");
  await expect(details).toContainText("Deploy");
  await expect(details).toContainText("alex");
  await expect(details).toContainText("마지막 성공 조회");
});

test("opens the original activity URL through the bridge", async ({ page }) => {
  await withBridgePatch(
    page,
    `
      const activityDetailsOpenedUrls = [];
      window.activityDetailsOpenedUrls = activityDetailsOpenedUrls;
      bridge.open = async (url) => { activityDetailsOpenedUrls.push(url); };
    `,
  );
  await page.goto("/?view=dashboard");
  await githubDetailsButton(page).click();
  await page.getByRole("button", { name: "원본에서 열기" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { activityDetailsOpenedUrls?: string[] })
            .activityDetailsOpenedUrls,
      ),
    )
    .toEqual(["https://github.com"]);
});

test("keeps details open when a subscription reports a terminal status", async ({
  page,
}) => {
  await withBridgePatch(
    page,
    `
      bridge.subscribe = async (handler) => {
        window.emitActivityDetailsUpdate = () => handler({
          ...preview,
          activities: preview.activities.map((item) =>
            item.id === "g1"
              ? {
                  ...item,
                  status: "success",
                  rawStatus: "SUCCESS",
                  finishedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        });
        return () => {};
      };
    `,
  );
  await page.goto("/?view=dashboard");
  await page.locator(".activity-show-details").nth(1).click();
  const details = page.locator("dialog[open]");
  await page.evaluate(() =>
    (
      window as unknown as { emitActivityDetailsUpdate: () => void }
    ).emitActivityDetailsUpdate(),
  );
  await expect(details).toContainText("성공 · SUCCESS");
});

test("keeps a sole active-filter run open after it completes", async ({
  page,
}) => {
  await withBridgePatch(
    page,
    `
      preview = { ...preview, activities: preview.activities.filter((item) => item.id === "g1") };
      bridge.subscribe = async (handler) => {
        window.emitActiveTerminal = () => handler({
          ...preview,
          activities: preview.activities.map((item) => ({
            ...item,
            status: "success",
            rawStatus: "SUCCESS",
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })),
        });
        return () => {};
      };
    `,
  );
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "진행 중 1" }).click();
  await githubDetailsButton(page).click();
  await page.evaluate(() =>
    (
      window as unknown as { emitActiveTerminal: () => void }
    ).emitActiveTerminal(),
  );
  await expect(page.locator("dialog[open]")).toContainText("성공 · SUCCESS");
  await expect(
    page.getByRole("heading", { name: "이 상태에 해당하는 실행이 없습니다" }),
  ).toBeVisible();
  await page
    .locator("dialog[open]")
    .locator(".activity-details-footer")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await expect(page.locator(".dashboard-runs")).toBeFocused();
});

test("keeps an unknown run open when the all-view section disappears", async ({
  page,
}) => {
  await withBridgePatch(
    page,
    `
      preview = {
        ...preview,
        activities: preview.activities
          .filter((item) => item.id === "g1")
          .map((item) => ({ ...item, status: "unknown", rawStatus: "UNKNOWN" })),
      };
      bridge.subscribe = async (handler) => {
        window.emitUnknownSuccess = () => handler({
          ...preview,
          activities: preview.activities.map((item) => ({
            ...item,
            status: "success",
            rawStatus: "SUCCESS",
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })),
        });
        return () => {};
      };
    `,
  );
  await page.goto("/?view=dashboard");
  await githubDetailsButton(page).click();
  await page.evaluate(() =>
    (
      window as unknown as { emitUnknownSuccess: () => void }
    ).emitUnknownSuccess(),
  );
  await expect(page.locator("dialog[open]")).toContainText("성공 · SUCCESS");
  await expect(
    page.getByRole("region", { name: "상태 확인 필요", exact: true }),
  ).toHaveCount(0);
  const details = githubDetailsButton(page);
  await page
    .locator("dialog[open]")
    .locator(".activity-details-footer")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await expect(details).toBeFocused();
});

test("hides activity hide controls while settings are locked", async ({
  page,
}) => {
  await withBridgePatch(
    page,
    `preview = { ...preview, settingsError: "Synthetic settings recovery error" };`,
  );
  await page.goto("/?view=dashboard");
  await githubDetailsButton(page).click();
  await expect(
    page.getByRole("button", { name: "목록에서 숨기기", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^목록에서 숨기기:/ }),
  ).toHaveCount(0);
});

test("wraps long activity details inside a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await withBridgePatch(
    page,
    `
      preview = {
        ...preview,
        activities: preview.activities.map((item) =>
          item.id === "g1"
            ? {
                ...item,
                title: "very-long-activity-title-".repeat(8),
                project: "very-long-project-name-".repeat(8),
                branch: "very-long-branch-name-".repeat(8),
                workflowName: "very-long-workflow-name-".repeat(8),
              }
            : item,
        ),
      };
    `,
  );
  await page.goto("/?view=dashboard");
  await page.locator(".activity-show-details").nth(1).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  const close = page
    .locator("dialog[open]")
    .locator(".activity-details-footer")
    .getByRole("button", { name: "닫기", exact: true });
  await close.scrollIntoViewIfNeeded();
  await expect(close).toBeVisible();
  await page.screenshot({ path: "artifacts/activity-details-360.png" });
});
