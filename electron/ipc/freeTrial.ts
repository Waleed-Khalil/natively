import { BrowserWindow } from "electron";
import { AppState } from "../main";
import { DatabaseManager } from "../db/DatabaseManager";
import { safeHandle, clearActiveModeOnLicenseLoss } from "./helpers";

export function registerFreeTrialHandlers(appState: AppState): void {
  // Start or resume a free trial. Fetches HWID, calls server, persists token locally.
  safeHandle("trial:start", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get hardware ID for HWID-binding
      let hwid = 'unavailable';
      try {
        const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
        hwid = LicenseManager.getInstance().getHardwareId() || 'unavailable';
      } catch { /* LicenseManager not available — fall back */ }

      const res = await fetch('https://api.natively.software/v1/trial/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hwid }),
        signal:  AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }

      const data = await res.json() as any;

      if (data.ok && data.trial_token && !data.expired) {
        cm.setTrialToken(data.trial_token, data.expires_at, data.started_at);

        // Auto-configure natively as the model + STT provider during trial
        const prevSttProvider = cm.getSttProvider();
        cm.setNativelyApiKey('__trial__');   // sentinel — activates natively model routing
        const newSttProvider = cm.getSttProvider();
        if (newSttProvider !== prevSttProvider) {
          await appState.reconfigureSttProvider();
        }
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (llmHelper) llmHelper.setNativelyKey('__trial__');
      }

      return { ok: true, ...data };
    } catch (error: any) {
      console.error('[IPC] trial:start failed:', error);
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Poll the server for live trial status (remaining time + usage counters).
  safeHandle("trial:status", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const token = CredentialsManager.getInstance().getTrialToken();
      if (!token) return { ok: false, error: 'no_trial_token' };

      const res = await fetch('https://api.natively.software/v1/trial/status', {
        headers: { 'x-trial-token': token },
        signal:  AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }

      return await res.json();
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Return local trial state from credentials (no network call — safe for startup check).
  safeHandle("trial:get-local", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm    = CredentialsManager.getInstance();
      const token = cm.getTrialToken();
      if (!token) return { hasToken: false, trialClaimed: cm.getTrialClaimed() };
      return {
        hasToken:     true,
        trialClaimed: true,
        trialToken:   token,
        expiresAt:    cm.getTrialExpiresAt(),
        startedAt:    cm.getTrialStartedAt(),
        expired:      cm.getTrialExpiresAt()
                        ? new Date(cm.getTrialExpiresAt()!).getTime() < Date.now()
                        : false,
      };
    } catch {
      return { hasToken: false, trialClaimed: false };
    }
  });

  // Record the user's post-trial choice in analytics and clean up local state.
  safeHandle("trial:convert", async (_, choice: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const token = CredentialsManager.getInstance().getTrialToken();
      if (!token) return { ok: true };  // no token to report

      await fetch('https://api.natively.software/v1/trial/convert', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-trial-token': token },
        body:    JSON.stringify({ choice }),
        signal:  AbortSignal.timeout(5_000),
      }).catch(() => {});  // fire-and-forget — don't block local cleanup on network failure

      return { ok: true };
    } catch {
      return { ok: true };
    }
  });

  // End trial via BYOK path: wipe Pro-ingested data, clear trial token + natively key.
  safeHandle("trial:end-byok", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // 1. Fire-and-forget analytics (non-blocking)
      const token = cm.getTrialToken();
      if (token) {
        fetch('https://api.natively.software/v1/trial/convert', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'x-trial-token': token },
          body:    JSON.stringify({ choice: 'byok' }),
          signal:  AbortSignal.timeout(4_000),
        }).catch(() => {});
      }

      // 2. Clear trial token
      cm.clearTrialToken();

      // 3. Clear the trial sentinel key + revert model / STT to open defaults
      cm.setNativelyApiKey('');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper) llmHelper.setNativelyKey(null);
      await appState.reconfigureSttProvider();

      // 4. Deactivate Pro license (removes license.enc)
      try {
        const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
        await LicenseManager.getInstance().deactivate();
      } catch { /* LicenseManager not available in this build */ }

      // 5. Disable knowledge mode + wipe orchestrator in-memory caches for resume/JD
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch (e: any) { console.warn('[IPC] trial:end-byok orchestrator wipe failed:', e?.message); }

      // 6. Wipe Pro-specific cached data from local SQLite
      //    Targets: company dossiers, knowledge docs (+ cascades), resume nodes, user profile
      //    NOT wiped: meetings, transcripts, chunks (user's own recordings)
      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
          console.log('[IPC] trial:end-byok: Pro data wiped from SQLite');
        }
      } catch (dbErr: any) {
        console.warn('[IPC] trial:end-byok: SQLite wipe partial error:', dbErr.message);
      }

      // 7. Notify all windows to refresh license + model state
      clearActiveModeOnLicenseLoss();
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('license-status-changed', { isPremium: false });
          win.webContents.send('trial-ended', { choice: 'byok' });
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] trial:end-byok error:', error);
      return { success: false, error: error.message };
    }
  });

  // Wipe only Pro profile data (resume + JD + company dossiers) without clearing
  // trial token or natively key. Called automatically when trial expires so that
  // profile intelligence data can't linger in SQLite after the trial window closes.
  safeHandle("trial:wipe-profile-data", async () => {
    try {
      // 1. Disable knowledge mode + wipe orchestrator in-memory caches
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch { /* ignore — orchestrator may not be initialised */ }

      // 2. Wipe Pro-specific SQLite tables
      //    NOT wiped: meetings, transcripts, audio chunks (user's own recordings)
      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
        }
      } catch (dbErr: any) {
        console.warn('[IPC] trial:wipe-profile-data: SQLite wipe partial error:', dbErr.message);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] trial:wipe-profile-data error:', error);
      return { success: false, error: error.message };
    }
  });
}
