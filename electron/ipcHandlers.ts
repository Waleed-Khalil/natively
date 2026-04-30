// ipcHandlers.ts

import { app, ipcMain, shell, dialog, desktopCapturer, systemPreferences, BrowserWindow, screen } from "electron"
import { AppState } from "./main"
import { GEMINI_FLASH_MODEL } from "./IntelligenceManager"
import { DatabaseManager } from "./db/DatabaseManager"; // Import Database Manager
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import { RECOGNITION_LANGUAGES, AI_RESPONSE_LANGUAGES } from "./config/languages"
import {
  safeHandle,
  isProOrTrialActive,
  broadcastContextStatus,
  clearActiveModeOnLicenseLoss,
} from "./ipc/helpers";
import { registerThemeHandlers } from "./ipc/theme";
import { registerCalendarHandlers } from "./ipc/calendar";
import { registerModelSelectorWindowHandlers } from "./ipc/modelSelectorWindow";
import { registerDonationHandlers } from "./ipc/donations";
import { registerNativeAudioHandlers } from "./ipc/nativeAudio";
import { registerCustomProviderHandlers } from "./ipc/customProvider";
import { registerModelDiscoveryHandlers } from "./ipc/modelDiscovery";
import { registerSttHandlers } from "./ipc/stt";
import { registerLlmModelHandlers } from "./ipc/llmModel";
import { registerMeetingLifecycleHandlers } from "./ipc/meetingLifecycle";
import { registerIntelligenceModeHandlers } from "./ipc/intelligenceMode";
import { registerModesHandlers } from "./ipc/modes";
import { registerAutopilotHandlers } from "./ipc/autopilot";
import { registerLlmConfigHandlers } from "./ipc/llmConfig";
import { registerNativelyApiHandlers } from "./ipc/nativelyApi";
import { registerFreeTrialHandlers } from "./ipc/freeTrial";
import { registerFollowupEmailHandlers } from "./ipc/followupEmail";
import { registerRagHandlers } from "./ipc/rag";
import { registerProfileHandlers } from "./ipc/profile";
import { registerTavilyHandlers } from "./ipc/tavily";
import { registerOverlayHandlers } from "./ipc/overlay";

export function initializeIpcHandlers(appState: AppState): void {

  // --- NEW Test Helper ---
  safeHandle("test-release-fetch", async () => {
    try {
      console.log("[IPC] Manual Test Fetch triggered (forcing refresh)...");
      const { ReleaseNotesManager } = require('./update/ReleaseNotesManager');
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes('latest', true);

      if (notes) {
        console.log("[IPC] Notes fetched for:", notes.version);
        const info = {
          version: notes.version || 'latest',
          files: [] as any[],
          path: '',
          sha512: '',
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes
        };
        // Send to renderer
        appState.getMainWindow()?.webContents.send("update-available", info);
        return { success: true };
      }
      return { success: false, error: "No notes returned" };
    } catch (err: any) {
      console.error("[IPC] test-release-fetch failed:", err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("license:activate", async (event, key: string) => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      const result = await LicenseManager.getInstance().activateLicense(key);
      if (result?.success) {
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) win.webContents.send('license-status-changed', { isPremium: true });
        });
      }
      return result;
    } catch (err: any) {
      // Only show generic message if the premium module itself is missing.
      // activateLicense() returns {success:false, error} for all expected failures
      // (bad key, network error, etc.) — it should never throw in normal operation.
      console.error('[IPC] license:activate unexpected error:', err);
      return { success: false, error: 'Premium features not available in this build.' };
    }
  });
  safeHandle("license:check-premium", async () => true);

  safeHandle("license:get-details", async () => {
    return { isPremium: true, plan: 'pro', provider: 'local' };
  });
  safeHandle("license:check-premium-async", async () => true);
  safeHandle("license:deactivate", async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      // deactivate() is async — it calls the Dodo server to free the activation slot
      // before removing the local license file. Must be awaited.
      await LicenseManager.getInstance().deactivate();
      // Auto-disable knowledge mode when license is removed
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          console.log('[IPC] Knowledge mode auto-disabled due to license deactivation');
        }
      } catch (e) { /* ignore */ }
      // Notify all windows so the license UI (ProGate, settings) refreshes immediately
      clearActiveModeOnLicenseLoss();
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('license-status-changed', { isPremium: false });
      });
    } catch { /* LicenseManager not available */ }
    return { success: true };
  });
  safeHandle("license:get-hardware-id", async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      return LicenseManager.getInstance().getHardwareId();
    } catch {
      return 'unavailable';
    }
  });

  safeHandle("get-recognition-languages", async () => {
    return RECOGNITION_LANGUAGES;
  });

  safeHandle("get-ai-response-languages", async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle("set-ai-response-language", async (_, language: string) => {
    // Validate: must be a non-empty string
    if (!language || typeof language !== 'string' || !language.trim()) {
      console.warn('[IPC] set-ai-response-language: invalid or empty language received, ignoring.');
      return { success: false, error: 'Invalid language value' };
    }
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require('./services/CredentialsManager');
    // Persist to disk
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    // Update live in-memory LLMHelper (same instance used by IntelligenceEngine)
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn('[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.');
    }
    return { success: true };
  });

  safeHandle("get-stt-language", async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle("get-ai-response-language", async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return

      const senderWebContents = event.sender
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow()
      const overlayWin = appState.getWindowHelper().getOverlayWindow()
      const launcherWin = appState.getWindowHelper().getLauncherWindow()

      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height)
      } else if (
        overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === senderWebContents.id
      ) {
        // NativelyInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height)
      } else if (
        launcherWin && !launcherWin.isDestroyed() && launcherWin.webContents.id === senderWebContents.id
      ) {
        // EC-05 fix: launcher window resize events were previously silently ignored.
        // Log them so that if the launcher ever sends this IPC it's visible in logs.
        console.log(`[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored — launcher has fixed dimensions)`);
      }
    }
  )

  safeHandle("set-window-mode", async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  })


  safeHandle("delete-screenshot", async (event, filePath: string) => {
    // Guard: only allow deletion of files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    return appState.deleteScreenshot(resolved);
  })

  safeHandle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error
    }
  })

  safeHandle("take-selective-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeSelectiveScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // EC-04 fix: cast unknown error to Error before accessing .message
      if ((error as Error).message === "Selection cancelled") {
        return { cancelled: true }
      }
      throw error
    }
  })

  safeHandle("get-screenshots", async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error
    }
  })

  safeHandle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  safeHandle("show-window", async (event, inactive?: boolean) => {
    // Default show main window (Launcher usually)
    appState.showMainWindow(inactive)
  })

  safeHandle("hide-window", async () => {
    appState.hideMainWindow()
  })

  safeHandle("show-overlay", async () => {
    appState.getWindowHelper().showOverlay();
  })

  safeHandle("hide-overlay", async () => {
    appState.getWindowHelper().hideOverlay();
  })

  safeHandle("get-meeting-active", async () => {
    return appState.getIsMeetingActive();
  })

  safeHandle("reset-queues", async () => {
    try {
      appState.clearQueues()
      // console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  registerDonationHandlers();


  // Generate suggestion from transcript - Natively-style text-only reasoning
  safeHandle("generate-suggestion", async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper.getLLMHelper().generateSuggestion(context, lastQuestion)
      return { suggestion }
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error
    }
  })

  safeHandle("finalize-mic-stt", async () => {
    appState.finalizeMicSTT();
  });

  // IPC handler for analyzing image from file path
  safeHandle("analyze-image-file", async (event, filePath: string) => {
    // Guard: only allow reading files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] analyze-image-file: path outside userData rejected:', filePath);
      throw new Error('Path not allowed');
    }
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFiles([resolved])
      return result
    } catch (error: any) {
      throw error
    }
  })

  safeHandle("gemini-chat", async (event, message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean }) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);

      console.log(`[IPC] gemini - chat response: `, result ? result.substring(0, 50) : "(empty)");

      // Don't process empty responses
      if (!result || result.trim().length === 0) {
        console.warn("[IPC] Empty response from LLM, not updating IntelligenceManager");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }

      // Sync with IntelligenceManager so Follow-Up/Recap work
      const intelligenceManager = appState.getIntelligenceManager();

      // 1. Add user question to context (as 'user')
      // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
      // The user's manual question is a NEW input, not a refinement of previous answer.
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      // 2. Add assistant response and set as last message
      console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
      intelligenceManager.addAssistantMessage(result);
      console.log(`[IPC] Updated IntelligenceManager.Last message: `, intelligenceManager.getLastAssistantMessage()?.substring(0, 50));

      // Log Usage
      intelligenceManager.logUsage('chat', message, result);

      return result;
    } catch (error: any) {
      // console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  // Streaming IPC Handler
  // SECURITY FIX (P0-1): Monotonic stream ID prevents interleaved tokens from concurrent stream requests.
  // Each new invocation increments the ID; any in-flight iteration bails as soon as it detects
  // that a newer stream has taken over.
  let _chatStreamId = 0;

  safeHandle("gemini-chat-stream", async (event, message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean }) => {
    try {
      console.log("[IPC] gemini-chat-stream started using LLMHelper.streamChat");
      const llmHelper = appState.processingHelper.getLLMHelper();

      // Claim a new stream ID — any prior stream will detect this and stop emitting.
      const myStreamId = ++_chatStreamId;

      // Update IntelligenceManager with USER message immediately
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      let fullResponse = "";

      // Context Injection for "Answer" button (100s rolling window)
      if (!context) {
        // User requested 100 seconds of context for the answer button
        // Logic: If no explicit context provided (like from manual override), auto-inject from IntelligenceManager
        try {
          const autoContext = intelligenceManager.getFormattedContext(100);
          if (autoContext && autoContext.trim().length > 0) {
            context = autoContext;
            console.log(`[IPC] Auto - injected 100s context for gemini - chat - stream(${context.length} chars)`);
          }
        } catch (ctxErr) {
          console.warn("[IPC] Failed to auto-inject context:", ctxErr);
        }
      }

      try {
        // USE streamChat which handles routing
        const stream = llmHelper.streamChat(message, imagePaths, context, options?.skipSystemPrompt ? "" : undefined, options?.ignoreKnowledgeMode);

        for await (const token of stream) {
          // Bail if a newer stream has taken over (user triggered a new request)
          if (_chatStreamId !== myStreamId) {
            console.log(`[IPC] gemini-chat-stream ${myStreamId} superseded by ${_chatStreamId}, stopping.`);
            return null;
          }
          event.sender.send("gemini-stream-token", token);
          fullResponse += token;
        }

        // Final check: only send done if we are still the active stream
        if (_chatStreamId === myStreamId) {
          event.sender.send("gemini-stream-done");

          // Update IntelligenceManager with ASSISTANT message after completion
          if (fullResponse.trim().length > 0) {
            intelligenceManager.addAssistantMessage(fullResponse);
            // Log Usage for streaming chat
            intelligenceManager.logUsage('chat', message, fullResponse);
          }
        }

      } catch (streamError: any) {
        console.error("[IPC] Streaming error:", streamError);
        if (_chatStreamId === myStreamId) {
          event.sender.send("gemini-stream-error", streamError.message || "Unknown streaming error");
        }
      }

      return null; // Return null as data is sent via events

    } catch (error: any) {
      console.error("[IPC] Error in gemini-chat-stream setup:", error);
      throw error;
    }
  });



  safeHandle("quit-app", () => {
    app.quit()
  })

  safeHandle("quit-and-install-update", async () => {
    try {
      console.log('[IPC] Quit and install update requested')
      await appState.quitAndInstallUpdate()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] quit-and-install-update failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("delete-meeting", async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle("check-for-updates", async () => {
    try {
      console.log('[IPC] Manual update check requested')
      await appState.checkForUpdates()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] check-for-updates failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("download-update", async () => {
    try {
      console.log('[IPC] Download update requested')
      appState.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] download-update failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Window movement handlers
  safeHandle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  safeHandle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  safeHandle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  safeHandle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  safeHandle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // Window Controls
  safeHandle("window-minimize", async () => {
    appState.getWindowHelper().minimizeWindow();
  });

  safeHandle("window-maximize", async () => {
    appState.getWindowHelper().maximizeWindow();
  });

  safeHandle("window-close", async () => {
    appState.getWindowHelper().closeWindow();
  });

  safeHandle("window-is-maximized", async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });

  // Settings Window
  safeHandle("toggle-settings-window", (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y)
  })

  // Open the launcher's SettingsOverlay on a specific tab (callable from any window)
  safeHandle("settings:open-tab", (_, tab: string) => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send('settings:open-tab', tab);
      launcherWin.show();
      launcherWin.focus();
    }
  })

  safeHandle("close-settings-window", () => {
    appState.settingsWindowHelper.closeWindow()
  })



  safeHandle("set-undetectable", async (_, state: boolean) => {
    appState.setUndetectable(state)
    return { success: true }
  })

  safeHandle("set-disguise", async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
    appState.setDisguise(mode)
    return { success: true }
  })

  safeHandle("get-undetectable", async () => {
    return appState.getUndetectable()
  })

  // Adapted from public PR #113 — verify premium interaction
  safeHandle("set-overlay-mouse-passthrough", async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled)
    return { success: true }
  })

  safeHandle("toggle-overlay-mouse-passthrough", async () => {
    const enabled = appState.toggleOverlayMousePassthrough()
    return { success: true, enabled }
  })

  safeHandle("get-overlay-mouse-passthrough", async () => {
    return appState.getOverlayMousePassthrough()
  })

  safeHandle("get-disguise", async () => {
    return appState.getDisguise()
  })

  safeHandle("set-open-at-login", async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe') // Explicitly point to executable for production reliability
    });
    return { success: true };
  });

  safeHandle("get-open-at-login", async () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  safeHandle("get-verbose-logging", async () => {
    return appState.getVerboseLogging();
  });

  safeHandle("set-verbose-logging", async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });

  safeHandle("get-log-file-path", async () => {
    try {
      return path.join(app.getPath('documents'), 'natively_debug.log');
    } catch {
      return null;
    }
  });

  safeHandle("open-log-file", async () => {
    try {
      const logPath = path.join(app.getPath('documents'), 'natively_debug.log');
      // Ensure the file exists before opening
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '');
      }
      await shell.openPath(logPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Fire-and-forget: renderer forwards its console output to the main-process log file.
  // Only written when verbose logging is enabled.
  ipcMain.on("forward-log-to-file", (_event, level: string, msg: string) => {
    if (!appState.getVerboseLogging()) return;
    const tag = level === 'error' ? '[RENDERER-ERROR]' : level === 'warn' ? '[RENDERER-WARN]' : '[RENDERER]';
    console.log(`${tag} ${msg}`);
  });

  safeHandle("get-arch", async () => {
    return process.arch;
  });

  safeHandle("get-os-version", async () => {
    const platform = process.platform;
    if (platform === 'darwin') {
      const darwinMajor = parseInt(os.release().split('.')[0] || '0', 10);
      // Darwin 25+ = macOS 26+ (calendar-year scheme), Darwin 20-24 = macOS 11-15
      const macosMajor = darwinMajor >= 25
        ? darwinMajor + 1
        : darwinMajor >= 20
          ? darwinMajor - 9
          : null;
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`;
    }
    if (platform === 'win32') {
      const release = os.release();
      // Windows 11 build starts at 22000
      const majorBuild = parseInt(release.split('.')[2] || '0', 10);
      return majorBuild >= 22000 ? `Windows 11` : `Windows 10`;
    }
    return os.type();
  });

  registerLlmConfigHandlers(appState);

  registerNativelyApiHandlers(appState);

  registerFreeTrialHandlers(appState);

  registerCustomProviderHandlers(appState);

  registerModelDiscoveryHandlers();

  registerSttHandlers(appState);

  registerLlmModelHandlers(appState);

  registerModelSelectorWindowHandlers(appState);

  registerNativeAudioHandlers(appState);

  registerMeetingLifecycleHandlers(appState);

  // ==========================================
  // Meeting Context (live, session-scoped) Handlers
  // ==========================================
  {
    const { MeetingContextStore } = require('./services/MeetingContextStore');
    const store = MeetingContextStore.getInstance();

    // Broadcast changes to all renderer windows so pills/indicators stay in sync.
    // Payload omits the body — renderer pulls full text via meeting-context:get when needed.
    store.on('changed', (info: { chars: number; hasContext: boolean }) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('meeting-context:changed', info);
      });
    });

    safeHandle("meeting-context:get", async () => {
      return { success: true, text: store.get() };
    });

    safeHandle("meeting-context:set", async (_evt, text: unknown) => {
      if (typeof text !== 'string') {
        return { success: false, error: 'expected string', chars: 0, truncated: false };
      }
      // Trim leading/trailing whitespace server-side so the cap reflects meaningful chars only.
      const trimmed = text.trim();
      const wasTruncated = trimmed.length > MeetingContextStore.MAX_CHARS;
      store.set(trimmed); // store enforces MAX_CHARS internally
      return {
        success: true,
        chars: store.get().length,
        truncated: wasTruncated,
      };
    });

    safeHandle("meeting-context:clear", async () => {
      store.clear();
      return { success: true };
    });
  }

  safeHandle("get-recent-meetings", async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle("get-meeting-details", async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle("update-meeting-title", async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle("update-meeting-summary", async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle("seed-demo", async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Ensure RAG embeddings exist for the demo meeting.
    // Use ensureDemoMeetingProcessed so we skip if already embedded
    // (avoids re-clearing 14 queue items on every app launch once processed).
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }

    return { success: true };
  });

  safeHandle("flush-database", async () => {
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  safeHandle("open-external", async (event, url: string) => {
    try {
      // For macOS System Settings, URL() parsing might act differently or we can just check string prefix
      if (url.startsWith('x-apple.systempreferences:')) {
        await shell.openExternal(url);
        return;
      }
      
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked potentially unsafe open-external: ${url}`);
      }
    } catch {
      console.warn(`[IPC] Invalid URL in open-external: ${url}`);
    }
  });


  registerIntelligenceModeHandlers(appState);

  registerThemeHandlers(appState);

  registerCalendarHandlers();

  registerFollowupEmailHandlers(appState);

  registerRagHandlers(appState);

  registerProfileHandlers(appState);

  registerTavilyHandlers();

  registerOverlayHandlers();

  registerModesHandlers();

  // ── Permissions ──────────────────────────────────────────────
  safeHandle("permissions:check", async () => {
    if (process.platform === 'darwin') {
      const mic    = systemPreferences.getMediaAccessStatus('microphone')
      const screen = systemPreferences.getMediaAccessStatus('screen')
      return { microphone: mic, screen, platform: 'darwin' }
    }
    // Windows/Linux: no TCC — permissions handled by OS at install/first-use time
    return { microphone: 'granted', screen: 'granted', platform: process.platform }
  })

  safeHandle("permissions:request-mic", async () => {
    if (process.platform !== 'darwin') return true
    try {
      return await systemPreferences.askForMediaAccess('microphone')
    } catch {
      return false
    }
  })

  registerAutopilotHandlers(appState);
}
