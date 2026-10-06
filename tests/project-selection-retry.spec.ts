import { expect, test, type Page } from "@playwright/test";

type SelectionKind = "target" | "targets";

async function selectionFailureScenario(
  page: Page,
  kind: SelectionKind,
  selected: boolean,
) {
  await page.route(/\/src\/bridge\.ts(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "const validated = settingsChangeSchema.parse(change);";
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body:
        source.replace(
          marker,
          `${marker}
          if (validated.kind === "${kind}" && validated.selected === ${selected}) {
            syntheticSelectionCalls += 1;
            if (syntheticSelectionCalls === 1) {
              throw new Error("Synthetic selection save failure");
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }`,
        ) +
        `
        let syntheticSelectionCalls = 0;
        let syntheticRefreshCalls = 0;
        const originalRefresh = bridge.refresh;
        bridge.refresh = async () => {
          syntheticRefreshCalls += 1;
          return originalRefresh();
        };
        window.__selectionRetryTest = {
          state: () => ({
            selectionCalls: syntheticSelectionCalls,
            refreshCalls: syntheticRefreshCalls
          })
        };`,
    });
  });
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  return page.getByRole("tabpanel", { name: "서비스 연결", exact: true });
}

async function retryState(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __selectionRetryTest: {
          state: () => { selectionCalls: number; refreshCalls: number };
        };
      }
    ).__selectionRetryTest.state(),
  );
}

for (const kind of ["target", "targets"] as const) {
  for (const selected of [true, false]) {
    test(`${kind} ${selected ? "selection" : "deselection"} retry runs the normal success follow-up`, async ({
      page,
    }) => {
      const connections = await selectionFailureScenario(page, kind, selected);
      const checkbox = connections.locator(".target-option input").first();

      if (selected) {
        if (kind === "target") await checkbox.uncheck();
        else
          await connections
            .getByRole("button", { name: "전체 해제", exact: true })
            .click();
      }

      if (kind === "target") {
        await checkbox.click();
      } else {
        await connections
          .getByRole("button", {
            name: selected ? "전체 선택" : "전체 해제",
            exact: true,
          })
          .click();
      }

      const failure = connections
        .getByRole("alert")
        .filter({ hasText: "변경하지 못했습니다" });
      await expect(failure).toContainText("Synthetic selection save failure");
      await expect(checkbox).toBeChecked({ checked: !selected });

      const retry = failure.getByRole("button", { name: "다시 시도" });
      await retry.evaluate((button) => {
        button.click();
        button.click();
      });
      await expect(checkbox).toBeDisabled();
      await expect(failure).toHaveCount(0);
      await expect(checkbox).toBeChecked({ checked: selected });
      await expect(connections.locator(".selection-status")).toContainText(
        "저장됨",
      );
      await expect
        .poll(() => retryState(page))
        .toEqual({
          selectionCalls: 2,
          refreshCalls: selected ? 1 : 0,
        });
    });
  }
}
