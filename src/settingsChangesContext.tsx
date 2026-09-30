import { createContext, useContext } from "react";
import type { SettingsChange } from "./settingsChanges";
import type { SettingsFailure } from "./settingsQueue";

export type SettingsChangesController = {
  change: (change: SettingsChange) => Promise<boolean>;
  pendingKeys: string[];
  failures: Record<string, SettingsFailure>;
  retry: (key: string) => Promise<boolean>;
};
const Context = createContext<SettingsChangesController | null>(null);
export const SettingsChangesProvider = Context.Provider;
export function useSettingsChanges() {
  const value = useContext(Context);
  if (!value) throw new Error("Settings controls require a settings provider.");
  return value;
}
