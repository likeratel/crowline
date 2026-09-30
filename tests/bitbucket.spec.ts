import { expect, test, type Page } from "@playwright/test";

async function openBitbucket(page: Page) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: source.replace(
        "export const bridge = {",
        "export const bridge = window.__testBridge = {",
      ),
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("tab", { name: "Bitbucket", exact: true }).click();
}

// All identities and credentials here are fictional and only used by the local preview.
test("Bitbucket connects and renews without saving credentials in settings", async ({
  page,
}) => {
  await openBitbucket(page);
  await expect(page.getByRole("button", { name: "CLI 세션 연결" })).toHaveCount(
    0,
  );
  await page.getByLabel("Atlassian 이메일").fill("tester@example.invalid");
  await page
    .getByLabel("API 토큰", { exact: true })
    .fill("fictional-test-token");
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByLabel("연결할 계정")).toContainText(
    "Example developer",
  );
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveCount(0);
  const read = () =>
    page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          __testBridge: {
            snapshot: () => Promise<{
              settings: { accounts: { id: string; provider: string }[] };
            }>;
          };
        }
      ).__testBridge;
      return (await bridge.snapshot()).settings;
    });
  const initial = await read();
  const id = initial.accounts.find(
    (account) => account.provider === "bitbucket",
  )?.id;
  expect(id).toBeTruthy();
  expect(JSON.stringify(initial)).not.toContain("fictional-test-token");
  expect(JSON.stringify(initial)).not.toContain("tester@example.invalid");
  await page.getByRole("button", { name: "토큰 변경", exact: true }).click();
  await page.getByLabel("Atlassian 이메일").fill("tester@example.invalid");
  await page
    .getByLabel("API 토큰", { exact: true })
    .fill("fictional-renewal-token");
  await page
    .locator("form.bitbucket-connect")
    .getByRole("button", { name: "토큰 변경", exact: true })
    .click();
  await expect(page.locator("form.bitbucket-connect")).toHaveCount(0);
  const renewed = await read();
  expect(
    renewed.accounts
      .filter((account) => account.provider === "bitbucket")
      .map((account) => account.id),
  ).toEqual([id]);
  expect(JSON.stringify(renewed)).not.toContain("fictional-renewal-token");
});

test("Bitbucket failed connection clears the token and can retry", async ({
  page,
}) => {
  await openBitbucket(page);
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        __testBridge: {
          connectBitbucket: (...args: unknown[]) => Promise<unknown>;
        };
      }
    ).__testBridge;
    const connect = bridge.connectBitbucket;
    let first = true;
    bridge.connectBitbucket = async (...args) => {
      if (first) {
        first = false;
        throw new Error("Token expired");
      }
      return connect(...args);
    };
  });
  await page.getByLabel("Atlassian 이메일").fill("tester@example.invalid");
  await page
    .getByLabel("API 토큰", { exact: true })
    .fill("fictional-expired-token");
  await page.getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Token expired");
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Atlassian 이메일")).toHaveValue(
    "tester@example.invalid",
  );
  await page
    .getByLabel("API 토큰", { exact: true })
    .fill("fictional-valid-token");
  await page.getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(page.getByLabel("연결할 계정")).toContainText(
    "Example developer",
  );
});

test("Bitbucket retries snapshot loading without submitting credentials again", async ({
  page,
}) => {
  await openBitbucket(page);
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        __testBridge: {
          connectBitbucket: (...args: unknown[]) => Promise<unknown>;
          snapshot: () => Promise<unknown>;
        };
        __connections?: number;
      }
    ).__testBridge;
    const originalConnect = bridge.connectBitbucket;
    const originalSnapshot = bridge.snapshot;
    let failRead = false;
    bridge.connectBitbucket = async (...args) => {
      const value = await originalConnect(...args);
      const state = window as unknown as { __connections?: number };
      state.__connections = (state.__connections ?? 0) + 1;
      failRead = true;
      return value;
    };
    bridge.snapshot = async () => {
      if (failRead) {
        failRead = false;
        throw new Error("Snapshot unavailable");
      }
      return originalSnapshot();
    };
  });
  await page.getByLabel("Atlassian 이메일").fill("tester@example.invalid");
  await page
    .getByLabel("API 토큰", { exact: true })
    .fill("fictional-valid-token");
  await page.getByRole("button", { name: "계정 연결", exact: true }).click();
  await expect(
    page
      .getByText(
        "계정은 연결됐지만 화면을 갱신하지 못했습니다. 다시 조회해 주세요.",
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveCount(0);
  await page
    .getByRole("tabpanel", { name: "서비스 연결" })
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await expect(page.getByLabel("연결할 계정")).toContainText(
    "Example developer",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __connections: number }).__connections,
    ),
  ).toBe(1);
});
