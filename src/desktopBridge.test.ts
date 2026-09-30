import { beforeEach, expect, test, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./bridge", () => ({ isPreview: false }));
beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
});

test("update installation binds approval to the displayed version and records successful installation", async () => {
  const { desktop } = await import("./desktopBridge");
  invoke.mockResolvedValue(undefined);
  expect(desktop.installedVersion()).toBeNull();
  await desktop.install("1.2.3");
  expect(invoke).toHaveBeenCalledWith("install_update", {
    expectedVersion: "1.2.3",
  });
  expect(desktop.installedVersion()).toBe("1.2.3");
});

test("a rejected installation does not mark the update as installed", async () => {
  const { desktop } = await import("./desktopBridge");
  invoke.mockRejectedValue(new Error("Update changed"));
  await expect(desktop.install("1.2.3")).rejects.toThrow("Update changed");
  expect(desktop.installedVersion()).toBeNull();
});
