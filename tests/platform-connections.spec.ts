import { expect, test } from "@playwright/test";

test("searches the platform catalog and explains unsupported platforms", async ({
  page,
}) => {
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "연결 및 설정" }).click();

  const platformSearch = page.getByLabel("플랫폼 검색");
  await platformSearch.fill("Railway");
  await expect(
    page.getByRole("tab", { name: "Railway", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Vercel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Railway", exact: true }).click();
  await expect(
    page.getByText("이 기기의 CLI 세션", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "CLI 세션 연결" }),
  ).toBeVisible();
  await expect(page.getByText("railway login", { exact: true })).toBeVisible();
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
    await platformSearch.fill(unsupported.search);
    await page
      .getByRole("tab", { name: unsupported.name, exact: true })
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
