import { expect, test } from "@playwright/test";

test("GitHub connects a selected CLI identity without API setup", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.locator(".authentication-details > summary").click();
  const accounts = page.getByLabel("GitHub CLI 계정", { exact: true });
  await accounts.selectOption("orbit-work");
  await page
    .getByRole("button", { name: "선택한 계정 연결", exact: true })
    .click();
  await expect(accounts).toHaveValue("orbit-work");
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveCount(0);
  await page.getByLabel("서비스", { exact: true }).selectOption("vercel");
  await expect(
    page.getByRole("button", { name: "브라우저로 로그인" }),
  ).toBeVisible();
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveCount(0);
});

test("missing CLI accounts report an error and remain retryable", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(
      'if (isPreview) return ["orbit-developer", "orbit-work"];',
      'if (isPreview) throw new Error("GitHub CLI was not found. Install gh and retry.");',
    );
    await route.fulfill({ response, body: source });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.locator(".authentication-details > summary").click();
  await expect(page.getByRole("alert")).toContainText(
    "GitHub CLI was not found",
  );
  await expect(
    page.getByRole("button", { name: "CLI 계정 새로고침", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "선택한 계정 연결", exact: true }),
  ).toBeDisabled();
});

test("Vercel reauthentication never sends its stable identity as an AWS profile", async ({
  page,
}) => {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(
      "let preview = demoSnapshot();",
      'let preview = demoSnapshot(); preview = { ...preview, settings: { ...preview.settings, accounts: preview.settings.accounts.map(account => account.provider === "vercel" ? { ...account, profile: "synthetic-vercel-id" } : account) } };',
    );
    await route.fulfill({
      response,
      body: `${source}\nwindow.__testBridge = bridge;`,
    });
  });
  await page.goto("/?view=dashboard");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.evaluate(() => {
    const backend = (
      window as unknown as {
        __testBridge: { login: (...args: unknown[]) => Promise<unknown> };
      }
    ).__testBridge;
    backend.login = async (provider, connectionId, profile) => {
      document.documentElement.dataset.loginProfile = String(profile);
      return {
        provider,
        connectionId,
        state: "error",
        message: "Synthetic CLI sign-in",
        code: null,
        url: null,
      };
    };
  });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("서비스", { exact: true }).selectOption("vercel");
  await page
    .getByRole("button", { name: "브라우저로 로그인", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-login-profile",
    "null",
  );
});
