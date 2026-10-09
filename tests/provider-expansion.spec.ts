import { expect, test, type Page } from "@playwright/test";
import type { bridge as appBridge } from "../src/bridge";

type TestWindow = Window & {
  __testBridge: typeof appBridge;
  __registrationCount?: number;
};

async function openConnections(page: Page) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: `${source}\nwindow.__testBridge = bridge;`,
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
}

test("Cloudflare has a token connection and clears secrets after a failed request", async ({
  page,
}) => {
  await openConnections(page);
  await page
    .getByLabel("서비스", { exact: true })
    .selectOption("cloudflare-pages");
  await expect(page.getByRole("button", { name: "CLI 세션 연결" })).toHaveCount(
    0,
  );
  await page
    .getByLabel("계정 ID", { exact: true })
    .fill("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const token = page.getByLabel("API 토큰", { exact: true });
  await token.fill("fictional-provider-token");
  await expect(token).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(token).toHaveValue("");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("계정 ID", { exact: true })).toHaveValue(
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
});

test("Firebase uses gcloud and EAS offers explicit project registration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openConnections(page);
  await page.getByLabel("서비스", { exact: true }).selectOption("firebase");
  await expect(
    page.getByRole("button", { name: "CLI 세션 연결" }),
  ).toBeVisible();
  await expect(page.locator(".unsupported-connection")).toHaveCount(0);
  await page.getByLabel("서비스", { exact: true }).selectOption("eas");
  await page.getByRole("button", { name: "CLI 세션 연결" }).click();
  await expect(
    page.getByLabel("EAS 프로젝트 UUID", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "프로젝트 등록", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("EAS 프로젝트 UUID", { exact: true })
    .fill("11111111-1111-4111-8111-111111111111");
  await page.getByLabel("소유자", { exact: true }).fill("example-team");
  await page.getByLabel("Slug", { exact: true }).fill("example-app");
  await expect(
    page.getByRole("button", { name: "프로젝트 등록", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Slug", { exact: true }).fill("../unsafe");
  await expect(
    page.getByRole("button", { name: "프로젝트 등록", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Cloudflare saved connection retries loading without sending the token again", async ({
  page,
}) => {
  await openConnections(page);
  await page
    .getByLabel("서비스", { exact: true })
    .selectOption("cloudflare-workers");
  await page.evaluate(() => {
    const state = window as TestWindow;
    const bridge = state.__testBridge;
    const snapshot = bridge.snapshot;
    let failRead = false;
    bridge.connectCloudflare = async (_provider, accountId) => {
      state.__registrationCount = (state.__registrationCount ?? 0) + 1;
      const account = {
        id: "cloudflare-workers:11111111-1111-4111-8111-111111111111",
        provider: "cloudflare-workers" as const,
        label: "Example Cloudflare",
        mode: "isolated" as const,
        profile: accountId,
      };
      const current = await snapshot();
      await bridge.save({
        ...current.settings,
        accounts: [...current.settings.accounts, account],
      });
      failRead = true;
      return account;
    };
    bridge.snapshot = async () => {
      if (failRead) {
        failRead = false;
        throw new Error("Snapshot unavailable");
      }
      return snapshot();
    };
  });
  await page.getByLabel("계정 ID", { exact: true }).fill("a".repeat(32));
  await page
    .getByLabel("API 토큰", { exact: true })
    .fill("fictional-provider-token");
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(
    page.getByText(
      "연결은 저장됐지만 화면을 갱신하지 못했습니다. 다시 시도하세요.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("API 토큰", { exact: true })).toHaveCount(0);
  await page
    .getByRole("tabpanel", { name: "서비스 연결" })
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await expect(page.getByLabel("연결할 계정")).toContainText(
    "Example Cloudflare",
  );
  expect(
    await page.evaluate(() => (window as TestWindow).__registrationCount),
  ).toBe(1);
  expect(
    await page.evaluate(async () =>
      JSON.stringify(
        (await (window as TestWindow).__testBridge.snapshot()).settings,
      ),
    ),
  ).not.toContain("fictional-provider-token");
});

test("EAS saved project retries only the failed view refresh", async ({
  page,
}) => {
  await openConnections(page);
  await page.getByLabel("서비스", { exact: true }).selectOption("eas");
  await page.getByRole("button", { name: "CLI 세션 연결" }).click();
  await page.evaluate(() => {
    const state = window as TestWindow;
    const bridge = state.__testBridge;
    const snapshot = bridge.snapshot;
    let failRead = false;
    bridge.registerEasProject = async () => {
      state.__registrationCount = (state.__registrationCount ?? 0) + 1;
      failRead = true;
      return [
        {
          id: "11111111-1111-4111-8111-111111111111:build",
          provider: "eas",
          connectionId: "eas:local",
          name: "Example · Builds",
          metadata: {
            projectId: "11111111-1111-4111-8111-111111111111",
            owner: "example-team",
            slug: "example-app",
            kind: "build",
          },
        },
      ];
    };
    bridge.snapshot = async () => {
      if (failRead) {
        failRead = false;
        throw new Error("Snapshot unavailable");
      }
      return snapshot();
    };
  });
  await page
    .getByLabel("EAS 프로젝트 UUID", { exact: true })
    .fill("11111111-1111-4111-8111-111111111111");
  await page.getByLabel("소유자", { exact: true }).fill("example-team");
  await page.getByLabel("Slug", { exact: true }).fill("example-app");
  await page
    .getByRole("button", { name: "프로젝트 등록", exact: true })
    .click();
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("EAS 프로젝트 UUID", { exact: true }) });
  await expect(form.getByRole("alert")).toContainText("저장됐지만");
  await expect(
    page.getByLabel("EAS 프로젝트 UUID", { exact: true }),
  ).toBeDisabled();
  await form.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(form.getByRole("status")).toBeVisible();
  await expect(
    page.getByLabel("EAS 프로젝트 UUID", { exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() => (window as TestWindow).__registrationCount),
  ).toBe(1);
});

test("EAS registration failures preserve project input and allow retry", async ({
  page,
}) => {
  await openConnections(page);
  await page.getByLabel("서비스", { exact: true }).selectOption("eas");
  await page.getByRole("button", { name: "CLI 세션 연결" }).click();
  await page
    .getByLabel("EAS 프로젝트 UUID", { exact: true })
    .fill("11111111-1111-4111-8111-111111111111");
  await page.getByLabel("소유자", { exact: true }).fill("example-team");
  await page.getByLabel("Slug", { exact: true }).fill("example-app");
  await page
    .getByRole("button", { name: "프로젝트 등록", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("소유자", { exact: true })).toHaveValue(
    "example-team",
  );
  await expect(
    page.getByRole("button", { name: "프로젝트 등록", exact: true }),
  ).toBeEnabled();
});

test("fastlane and Supabase guide users directly to CI connections", async ({
  page,
}) => {
  await openConnections(page);
  for (const provider of ["fastlane", "supabase"]) {
    await page.getByLabel("서비스", { exact: true }).selectOption(provider);
    await expect(page.locator(".unsupported-connection")).toContainText("CI");
    await page
      .getByRole("button", { name: "GitHub Actions 보기", exact: true })
      .click();
    await expect(page.getByLabel("서비스", { exact: true })).toHaveValue(
      "github",
    );
  }
});
