import { beforeEach, expect, test, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
beforeEach(() => {
  invoke.mockReset();
});

test("invalid Bitbucket credentials never reach the native boundary", async () => {
  const { bridge } = await import("./bridge");
  await expect(
    bridge.connectBitbucket("not-an-email", "fictional-token"),
  ).rejects.toThrow();
  await expect(
    bridge.connectBitbucket("tester@example.invalid", " "),
  ).rejects.toThrow();
  await expect(
    bridge.connectBitbucket("tester@example.invalid", "x".repeat(4097)),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

test("Bitbucket renewal sends the bound account ID and validates the response", async () => {
  const { bridge } = await import("./bridge");
  const account = {
    id: "bitbucket:example",
    provider: "bitbucket",
    label: "Example developer",
    mode: "isolated",
    profile: null,
  };
  invoke.mockResolvedValue(account);
  await expect(
    bridge.connectBitbucket(
      " tester@example.invalid ",
      " fictional-token ",
      account.id,
    ),
  ).resolves.toEqual(account);
  expect(invoke).toHaveBeenCalledWith("connect_bitbucket", {
    email: "tester@example.invalid",
    token: "fictional-token",
    connectionId: account.id,
  });
  invoke.mockResolvedValue({ ...account, provider: "invalid" });
  await expect(
    bridge.connectBitbucket(
      "tester@example.invalid",
      "fictional-token",
      account.id,
    ),
  ).rejects.toThrow();
});
