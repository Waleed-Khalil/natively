import { BrowserWindow, ipcMain } from "electron";

type IpcListener = (event: any, ...args: any[]) => Promise<any> | any;

export function safeHandle(channel: string, listener: IpcListener): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

// Local build: paywall disabled — Pro features always unlocked.
export function isProOrTrialActive(): boolean {
  return true;
}

export function broadcastContextStatus(): void {
  try {
    const { ModesManager } = require('../services/ModesManager');
    const status = ModesManager.getInstance().getActiveContextStatus();
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('mode-context-status-changed', status);
    });
  } catch (e: any) {
    console.warn('[IPC] broadcastContextStatus failed:', e?.message);
  }
}

// Strip API-key suffixes (e.g. ": sk-***...***") from error messages before
// returning them to the renderer.
export function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
}

// Clears the active mode when the pro license is lost so non-general mode prompts
// and reference files stop being injected into LLM calls.
export function clearActiveModeOnLicenseLoss(): void {
  try {
    const { DatabaseManager } = require('../db/DatabaseManager');
    DatabaseManager.getInstance().setActiveMode(null);
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('modes-active-cleared');
    });
    console.log('[IPC] Active mode cleared due to license loss');
  } catch (e) { /* non-fatal */ }
}
