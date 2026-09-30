import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?view=dashboard");
});

test("omits workspace placeholders and explains the local three-step connection flow", async ({
  page,
}) => {
  await expect(page.getByText("내 워크스페이스", { exact: true })).toHaveCount(
    0,
  );
  await page.getByText("표시 기준 안내", { exact: true }).click();
  await expect(
    page.getByText(/진행 중은 시작 후 24시간 이내 항목/),
  ).toBeVisible();
  await expect(
    page.getByText(/상태바 표시 설정.*트레이에 보일 항목만 바꾸고/),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/crowline-dashboard-ux.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "연결 및 설정" }).click();
  const dialog = page.getByRole("dialog", { name: "서비스 연결" });

  await expect(dialog.getByText("YOUR WORKSPACE", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByText("이 기기의 기존 인증을 읽기 전용으로 사용합니다."),
  ).toBeVisible();
  await expect(dialog.locator(".connection-guide li")).toHaveCount(3);
  await expect(dialog.getByText("연결 준비", { exact: true })).toBeVisible();
  await expect(dialog.getByText("연결 확인", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("대상 선택 및 저장", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(/기존 인증을 재사용합니다.*다시 로그인할 필요가 없습니다/),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Crowline은 배포 상태만 조회하며 배포를 변경하지 않습니다.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/crowline-dialog-guide-full.png" });
});

test("uses 36px dashboard controls and a custom select indicator", async ({
  page,
}) => {
  const heights = await page
    .locator(
      ".toolbar .segmented, .toolbar .search-box, .toolbar .period-select",
    )
    .evaluateAll((controls) =>
      controls.map((control) =>
        Math.round(control.getBoundingClientRect().height),
      ),
    );
  expect(heights.length).toBeGreaterThanOrEqual(4);
  expect(new Set(heights)).toEqual(new Set([36]));

  for (const select of await page.locator(".toolbar select").all()) {
    await expect(select).toHaveCSS("appearance", "none");
    await expect(select).toHaveCSS("height", "36px");
    expect(
      await select.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      ),
    ).not.toBe("none");
  }
});

test("keeps one keyboard-scrollable dialog body with stable actions in a short viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 420 });
  await page.getByRole("button", { name: "연결 및 설정" }).click();

  const dialog = page.getByRole("dialog", { name: "서비스 연결" });
  const body = dialog.getByLabel("서비스 연결 설정 내용");
  const header = dialog.locator(".dialog-header");
  const footer = dialog.locator(".dialog-footer");
  const beforeHeader = await header.boundingBox();
  const beforeFooter = await footer.boundingBox();

  await page.screenshot({ path: "artifacts/crowline-dialog-guide.png" });

  await expect(body).toHaveCSS("overflow-y", "auto");
  await expect(dialog.locator(".provider-tabs")).toHaveCSS(
    "overflow-y",
    "visible",
  );
  expect(
    await dialog
      .locator(".provider-tabs")
      .evaluate((catalog) => catalog.scrollHeight <= catalog.clientHeight),
  ).toBe(true);

  const githubTab = dialog.getByRole("tab", {
    name: "GitHub Actions",
    exact: true,
  });
  await githubTab.focus();
  await page.keyboard.press("ArrowRight");
  const vercelTab = dialog.getByRole("tab", { name: "Vercel", exact: true });
  await expect(vercelTab).toBeFocused();
  await expect(vercelTab).toHaveAttribute("aria-selected", "true");

  await body.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const afterHeader = await header.boundingBox();
  const afterFooter = await footer.boundingBox();
  expect(afterHeader?.y).toBe(beforeHeader?.y);
  expect(afterFooter?.y).toBe(beforeFooter?.y);
  expect(
    (afterFooter?.y ?? 0) + (afterFooter?.height ?? 0),
  ).toBeLessThanOrEqual(420);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/crowline-dialog-short.png" });
});
