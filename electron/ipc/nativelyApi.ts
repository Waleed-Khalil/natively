import { BrowserWindow } from "electron";
import { AppState } from "../main";
import { safeHandle, clearActiveModeOnLicenseLoss } from "./helpers";

// Usage cache (60-second TTL, keyed by API key)
const _usageCache = new Map<string, { data: any; ts: number }>();
const USAGE_CACHE_TTL_MS = 60_000;

export function registerNativelyApiHandlers(appState: AppState): void {
  safeHandle("set-natively-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const prevSttProvider = cm.getSttProvider();
      cm.setNativelyApiKey(apiKey);

      // Update LLMHelper immediately (same pattern as other provider keys)
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setNativelyKey(apiKey || null);

      // Sync the model into LLMHelper and notify the UI whenever the effective default changed
      const defaultModel = cm.getDefaultModel();
      const providers = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
      llmHelper.setModel(defaultModel, providers);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
      });

      // If setNativelyApiKey auto-promoted the STT provider to 'natively', reconfigure
      // the audio pipeline immediately — without this, the in-memory pipeline still uses
      // the old STT provider (e.g. Google) until the app restarts.
      const newSttProvider = cm.getSttProvider();
      if (newSttProvider !== prevSttProvider) {
        console.log(`[IPC] set-natively-api-key: STT provider changed ${prevSttProvider} → ${newSttProvider}, reconfiguring pipeline`);
        await appState.reconfigureSttProvider();
      }

      // Auto-activate Natively Pro for pro/max/ultra API plans.
      // Skips silently if the user already has a Gumroad/Dodo lifetime license.
      if (apiKey) {
        try {
          const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
          const result = await LicenseManager.getInstance().activateWithApiKey(apiKey);
          if (result.success) {
            console.log('[IPC] set-natively-api-key: Pro auto-activated via API plan.');
            // Notify all windows so the license UI refreshes immediately
            BrowserWindow.getAllWindows().forEach(win => {
              if (!win.isDestroyed()) win.webContents.send('license-status-changed', { isPremium: true });
            });
          } else if (result.skipped) {
            console.log('[IPC] set-natively-api-key: existing Gumroad/Dodo license preserved — Pro not overwritten.');
          } else {
            console.log('[IPC] set-natively-api-key: Pro not activated —', result.error);
          }
        } catch (e: any) {
          // LicenseManager not available in this build — non-fatal
          console.warn('[IPC] set-natively-api-key: LicenseManager unavailable for Pro auto-activation:', e?.message);
        }
      } else {
        // API key was cleared — deactivate any natively_api Pro license so premium is revoked.
        try {
          const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
          const lm = LicenseManager.getInstance();
          // Only deactivate if the stored license is from a natively_api subscription.
          // Never touch Gumroad/Dodo lifetime licenses here.
          const details = lm.getLicenseDetails();
          if (details.isPremium && details.provider === 'natively_api') {
            await lm.deactivate();
            console.log('[IPC] set-natively-api-key: key cleared — natively_api Pro license deactivated.');
            clearActiveModeOnLicenseLoss();
            BrowserWindow.getAllWindows().forEach(win => {
              if (!win.isDestroyed()) win.webContents.send('license-status-changed', { isPremium: false });
            });
          }
        } catch (e: any) {
          console.warn('[IPC] set-natively-api-key: LicenseManager unavailable for Pro deactivation on key clear:', e?.message);
        }
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Natively API key:", error);
      return { success: false, error: error.message };
    } finally {
      // Always bust the cache when the key changes so the next usage fetch is fresh
      _usageCache?.clear();
    }
  });

  safeHandle("get-natively-usage", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const key = CredentialsManager.getInstance().getNativelyApiKey();
      if (!key) return { ok: false, error: 'no_key' };

      // Return cached value if it's still fresh
      const cached = _usageCache.get(key);
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) {
        return cached.data;
      }

      const res = await fetch('https://api.natively.software/v1/usage', {
        headers: { 'x-natively-key': key },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }
      const data = await res.json() as any;
      const result = { ok: true, ...data };

      // Cache the successful response
      _usageCache.set(key, { data: result, ts: Date.now() });
      return result;
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Allow other handlers to force-invalidate the usage cache (e.g. after key change)
  safeHandle("invalidate-natively-usage-cache", () => {
    _usageCache.clear();
    return { ok: true };
  });
}
