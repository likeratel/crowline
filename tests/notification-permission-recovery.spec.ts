import { expect, test, type Page } from "@playwright/test";

type PermissionTestState = {
  statusCalls: number;
  permissionCalls: number;
};

async function useSyntheticPermissionStatus(page: Page) {
  await page.route("**/?view=dashboard", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(
        /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/,
        `<script type="module">
          window.isTauri = true;
          const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
          const { demoSnapshot } = await import('/src/demo.ts');
          const snapshot = demoSnapshot();
          const syntheticSnapshot = {
            ...snapshot,
            settings: {
              ...snapshot.settings,
              preferences: {
                ...snapshot.settings.preferences,
                checkUpdatesAutomatically: false
              }
            }
          };
          let permissionStatusMode = 'fail';
          let statusCalls = 0;
          let permissionCalls = 0;
          const delay = () => new Promise((resolve) => setTimeout(resolve, 120));
          window.__notificationPermissionTest = {
            recover: () => { permissionStatusMode = 'prompt'; },
            state: () => ({ statusCalls, permissionCalls })
          };
          mockIPC(async (command) => {
            if (command === 'get_snapshot') return syntheticSnapshot;
            if (command === 'desktop_status') {
              statusCalls += 1;
              await delay();
              if (permissionStatusMode === 'fail') {
                throw new Error('Synthetic permission status unavailable');
              }
              return {
                autostart: false,
                notificationPermission: permissionStatusMode,
                updaterConfigured: false
              };
            }
            if (command === 'request_notification_permission') {
              permissionCalls += 1;
              return 'granted';
            }
            throw new Error('Unexpected test IPC: ' + command);
          }, { shouldMockEvents: true });
          await import('/src/main.tsx');
        </script>`,
      ),
    });
  });
}

async function openNotificationSettings(page: Page) {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  return page.getByRole("tabpanel", { name: "알림", exact: true });
}

async function permissionState(page: Page): Promise<PermissionTestState> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __notificationPermissionTest: {
          state: () => PermissionTestState;
        };
      }
    ).__notificationPermissionTest.state(),
  );
}

test("a failed permission status check recovers through a read-only retry", async ({
  page,
}) => {
  await useSyntheticPermissionStatus(page);
  const notifications = await openNotificationSettings(page);
  const permission = notifications.locator(".notification-permission");

  await expect(permission).toHaveAttribute("role", "alert");
  await expect(permission).toContainText("알림 권한을 확인하지 못했습니다.");
  await expect(
    permission.getByRole("button", { name: "알림 권한 허용" }),
  ).toHaveCount(0);
  await expect(permission.locator("details p")).not.toBeVisible();

  await page.evaluate(() =>
    (
      window as unknown as {
        __notificationPermissionTest: { recover: () => void };
      }
    ).__notificationPermissionTest.recover(),
  );
  await permission.getByRole("button", { name: "다시 확인" }).click();
  await expect(permission).toContainText("권한 확인 중…");
  await expect(permission).toContainText(
    "알림을 받으려면 시스템 권한이 필요합니다.",
  );
  await expect(
    permission.getByRole("button", { name: "알림 권한 허용" }),
  ).toHaveCSS("height", "36px");
  await expect(permissionState(page)).resolves.toEqual({
    statusCalls: 2,
    permissionCalls: 0,
  });

  await permission.getByRole("button", { name: "알림 권한 허용" }).click();
  await expect(permission).toHaveCount(0);
  await expect(permissionState(page)).resolves.toEqual({
    statusCalls: 2,
    permissionCalls: 1,
  });
});

test("a persistent status failure stays actionable and coalesces duplicate retries", async ({
  page,
}) => {
  await useSyntheticPermissionStatus(page);
  const notifications = await openNotificationSettings(page);
  const permission = notifications.locator(".notification-permission");
  const retry = permission.getByRole("button", { name: "다시 확인" });

  await expect(retry).toBeVisible();
  await expect(retry).toHaveCSS("height", "36px");
  await retry.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(permission).toContainText("권한 확인 중…");
  await expect(permission).toContainText("알림 권한을 확인하지 못했습니다.");
  await expect(retry).toBeEnabled();
  await expect(permissionState(page)).resolves.toEqual({
    statusCalls: 2,
    permissionCalls: 0,
  });

  await permission.getByText("오류 상세", { exact: true }).click();
  await expect(permission.locator("details p")).toHaveText(
    "Synthetic permission status unavailable",
  );
});
