import { expect, test } from "@playwright/test";

for (const entry of ["banner", "settings"] as const) {
  test(`installed update stays installed after navigation from ${entry}`, async ({
    page,
  }) => {
    await page.route("**/?view=dashboard", async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({
        response,
        body: html.replace(
          /<script type="module" src="\/src\/main\.tsx(?:\?[^"]*)?"><\/script>/,
          `<script type="module">
        window.isTauri = true;
        const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
        const { demoSnapshot } = await import('/src/demo.ts');
        window.installRequests = [];
        mockIPC((command, args) => {
          if (command === 'get_snapshot') return demoSnapshot();
          if (command === 'desktop_status') return {autostart:false,notificationPermission:'prompt',updaterConfigured:true};
          if (command === 'check_update') return {available:true,version:'1.2.3',body:'Synthetic release'};
          if (command === 'install_update') {window.installRequests.push(args); return;}
          throw new Error('Unexpected test IPC: ' + command);
        }, {shouldMockEvents:true});
        await import('/src/main.tsx');
      </script>`,
        ),
      });
    });
    await page.goto("/?view=dashboard");
    if (entry === "settings") {
      await page.getByRole("button", { name: "설정", exact: true }).click();
      await page.getByRole("tab", { name: "일반", exact: true }).click();
      await page
        .getByRole("tabpanel", { name: "일반" })
        .getByRole("button", { name: "업데이트 확인", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "업데이트 설치", exact: true })
      .click();
    await expect(
      page.getByText("설치가 끝나면 앱을 다시 실행해 주세요.").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /전체 서비스/ }).click();
    await expect(
      page.getByRole("button", { name: "업데이트 설치", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await page.getByRole("tab", { name: "일반", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "업데이트 확인", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("설치가 끝나면 앱을 다시 실행해 주세요.").first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { installRequests: unknown[] }).installRequests,
      ),
    ).toEqual([{ expectedVersion: "1.2.3" }]);
  });
}
