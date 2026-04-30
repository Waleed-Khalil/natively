import { AppState } from "../main";
import { safeHandle } from "./helpers";

export function registerAutopilotHandlers(appState: AppState): void {
  safeHandle("autopilot:get", async () => {
    const { SettingsManager } = require('../services/SettingsManager');
    const enabled = SettingsManager.getInstance().get('autopilotEnabled') === true;
    return { enabled };
  });

  safeHandle("autopilot:set", async (_, enabled: boolean) => {
    const { SettingsManager } = require('../services/SettingsManager');
    SettingsManager.getInstance().set('autopilotEnabled', !!enabled);
    const autopilot = appState.getAutopilot();
    if (autopilot) {
      if (enabled) autopilot.enable();
      else autopilot.disable();
    }
    return { success: true, enabled: !!enabled };
  });

  // Kill-switch endpoint — invoked by the global Cmd/Ctrl+Shift+K accelerator.
  // It only flips the runtime flag; persisted setting is left intact so the
  // user's preference survives the panic-disable.
  safeHandle("autopilot:kill", async () => {
    appState.getAutopilot()?.disable();
    return { success: true };
  });
}
