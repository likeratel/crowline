import { expect, test } from "@playwright/test";

test("searches the platform catalog and explains unsupported platforms", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const connections = page.getByRole("tabpanel", { name: "서비스 연결" });

  await connections.getByRole("button", { name: "서비스 찾아보기" }).click();
  const platformSearch = connections.getByLabel("플랫폼 검색");
  await platformSearch.fill("Railway");
  await expect(
    connections.getByRole("tab", { name: "Railway", exact: true }),
  ).toBeVisible();
  await expect(
    connections.getByRole("tab", { name: "Vercel", exact: true }),
  ).toHaveCount(0);
  await connections.getByRole("tab", { name: "Railway", exact: true }).click();
  await expect(
    page.getByText("이 기기의 CLI 세션", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "CLI 세션 연결" }),
  ).toBeVisible();
  await connections.locator("details.connection-help summary").first().click();
  await expect(page.getByText(/railway login/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인 시작" })).toHaveCount(
    0,
  );

  for (const unsupported of [
    {
      search: "Expo",
      name: "Expo / EAS",
      message:
        "EAS Build·Update 직접 조회에는 프로젝트 연결 정보가 추가로 필요합니다. CI로 실행한 빌드는 GitHub Actions 또는 GitLab CI에서 확인할 수 있습니다.",
    },
    {
      search: "Cloudflare Pages",
      name: "Cloudflare Pages",
      message:
        "Cloudflare Pages 배포 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
    },
    {
      search: "Cloudflare Workers",
      name: "Cloudflare Workers",
      message:
        "Cloudflare Workers 배포 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
    },
    {
      search: "Firebase",
      name: "Firebase",
      message:
        "Firebase 배포 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
    },
    {
      search: "fastlane",
      name: "fastlane",
      message:
        "fastlane 실행 결과는 GitHub Actions 또는 GitLab CI에서 확인해 주세요.",
    },
  ]) {
    await connections.getByRole("button", { name: "서비스 찾아보기" }).click();
    await platformSearch.fill(unsupported.search);
    await connections
      .getByRole("tab", {
        name: `${unsupported.name} 직접 연결 미지원`,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("현재 연결할 수 없습니다", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(unsupported.message)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CLI 세션 연결" }),
    ).toHaveCount(0);
  }
});
