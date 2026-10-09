import { beforeEach, expect, test, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
beforeEach(() => invoke.mockReset());

test("Cloudflare rejects invalid credentials before IPC and scopes renewal to its service", async () => {
  const { bridge } = await import("./bridge");
  const accountId = "a".repeat(32);
  for (const token of [
    "",
    "short",
    "a".repeat(4097),
    "fictional-token\nvalue",
  ]) {
    await expect(
      bridge.connectCloudflare("cloudflare-pages", accountId, token, null),
    ).rejects.toThrow();
  }
  await expect(
    bridge.connectCloudflare(
      "firebase",
      accountId,
      "fictional-token-value",
      null,
    ),
  ).rejects.toThrow();
  await expect(
    bridge.connectCloudflare(
      "cloudflare-pages",
      "../account",
      "fictional-token-value",
      null,
    ),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  const account = {
    id: "cloudflare-pages:example",
    provider: "cloudflare-pages",
    label: "Example",
    mode: "isolated",
    profile: accountId,
  };
  invoke.mockResolvedValue(account);
  await expect(
    bridge.connectCloudflare(
      "cloudflare-pages",
      accountId,
      "fictional-token-value",
      account.id,
    ),
  ).resolves.toEqual(account);
  expect(invoke).toHaveBeenCalledWith("connect_cloudflare", {
    provider: "cloudflare-pages",
    accountId,
    token: "fictional-token-value",
    connectionId: account.id,
  });
});

test("EAS validates explicit project context and validates returned targets", async () => {
  const { bridge } = await import("./bridge");
  const projectId = "11111111-1111-4111-8111-111111111111";
  for (const [id, owner, slug] of [
    ["not-a-uuid", "team", "app"],
    [projectId, "", "app"],
    [projectId, "team", "../app"],
  ]) {
    await expect(
      bridge.registerEasProject("eas:local", id, owner, slug),
    ).rejects.toThrow();
  }
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValue([{ id: "invalid-target" }]);
  await expect(
    bridge.registerEasProject(
      "eas:local",
      projectId,
      "example-team",
      "example-app",
    ),
  ).rejects.toThrow();
  expect(invoke).toHaveBeenCalledWith("register_eas_project", {
    connectionId: "eas:local",
    projectId,
    owner: "example-team",
    slug: "example-app",
  });
});
