import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { isPreview } from "./bridge";
const permission = z.enum(["granted", "denied", "prompt"]);
const desktopStatus = z.object({
  autostart: z.boolean(),
  notificationPermission: permission,
  updaterConfigured: z.boolean(),
});
const update = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  body: z.string().nullable(),
});
export type DesktopStatus = z.infer<typeof desktopStatus>;
export type UpdateInfo = z.infer<typeof update>;
let installedVersion: string | null = null;
export const desktop = {
  installedVersion: () => installedVersion,
  status: async () =>
    isPreview
      ? {
          autostart: false,
          notificationPermission: "prompt" as const,
          updaterConfigured: false,
        }
      : desktopStatus.parse(await invoke("desktop_status")),
  autostart: async (enabled: boolean) => {
    if (isPreview) return false;
    return z.boolean().parse(await invoke("set_autostart", { enabled }));
  },
  permission: async () =>
    isPreview
      ? ("prompt" as const)
      : permission.parse(await invoke("request_notification_permission")),
  check: async (fresh = true) =>
    update.parse(await invoke("check_update", { fresh })),
  install: async (expectedVersion: string) => {
    await invoke("install_update", { expectedVersion });
    installedVersion = expectedVersion;
  },
};
