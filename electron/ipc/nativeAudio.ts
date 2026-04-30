import { AppState } from "../main";
import { AudioDevices } from "../audio/AudioDevices";
import { safeHandle } from "./helpers";

export function registerNativeAudioHandlers(appState: AppState): void {
  safeHandle("native-audio-status", async () => {
    return { connected: true };
  });

  safeHandle("get-input-devices", async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle("get-output-devices", async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle("set-audio-source-pids", async (_evt, pids: number[]) => {
    appState.setManualAudioSourcePids(Array.isArray(pids) ? pids : []);
    return { success: true };
  });

  safeHandle("set-audio-source-filter", async (_evt, filter: { pids?: number[]; bundleIds?: string[] }) => {
    appState.setManualAudioSourceFilter({
      pids: Array.isArray(filter?.pids) ? filter.pids : [],
      bundleIds: Array.isArray(filter?.bundleIds) ? filter.bundleIds : [],
    });
    return { success: true };
  });

  safeHandle("list-audio-processes", async () => {
    try {
      const native = require("../audio/nativeModuleLoader").loadNativeModule();
      if (!native || typeof native.listAudioProcesses !== "function") {
        return [];
      }
      const list = native.listAudioProcesses();
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn("[ipc] list-audio-processes failed:", (err as Error).message);
      return [];
    }
  });

  safeHandle("start-audio-test", async (_event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle("start-source-audio-test", async (_event, filter?: { pids?: number[]; bundleIds?: string[]; outputDeviceId?: string }) => {
    await appState.startSourceAudioTest(filter);
    return { success: true };
  });

  safeHandle("stop-source-audio-test", async () => {
    appState.stopSourceAudioTest();
    return { success: true };
  });

  safeHandle("set-recognition-language", async (_, key: string) => {
    appState.setRecognitionLanguage(key);
    return { success: true };
  });
}
