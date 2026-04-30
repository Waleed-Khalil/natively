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

  // LLM Model Management Handlers
  safeHandle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      // console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  safeHandle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("force-restart-ollama", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const success = await llmHelper.forceRestartOllama();
      return { success };
    } catch (error: any) {
      console.error("Error force restarting Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('restart-ollama', async () => {
    try {
      // First try to kill it if it's running
      await appState.processingHelper.getLLMHelper().forceRestartOllama();
      
      // The forceRestartOllama now calls OllamaManager.getInstance().init() internally
      // so we don't need to do it again here.
      
      return true;
    } catch (error: any) {
      console.error("[IPC restart-ollama] Failed to restart:", error);
      return false;
    }
  });

  safeHandle("ensure-ollama-running", async () => {
    try {
      const { OllamaManager } = require('./services/OllamaManager');
      await OllamaManager.getInstance().init();
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  safeHandle("switch-to-gemini", async (_, apiKey?: string, modelId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);

      // Persist API key if provided
      if (apiKey) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      }

      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  // Dedicated API key setters (for Settings UI Save buttons)
  safeHandle("set-gemini-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGeminiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setApiKey(apiKey);

      // CQ-06 fix: cancel any in-flight LLM stream before swapping LLM clients.
      // Use resetEngine() (NOT reset()) so session transcript is preserved mid-meeting.
      // initializeLLMs() now also calls engine.reset() internally for double-safety.
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Gemini API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setOpenaiApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-claude-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Claude API key:", error);
      return { success: false, error: error.message };
    }
  });

  // ── Usage cache (60-second TTL, keyed by API key) ──────────────────────────
  const _usageCache = new Map<string, { data: any; ts: number }>();
  const USAGE_CACHE_TTL_MS = 60_000;

  safeHandle("set-natively-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
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
          const { LicenseManager } = require('../premium/electron/services/LicenseManager');
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
          const { LicenseManager } = require('../premium/electron/services/LicenseManager');
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
      const { CredentialsManager } = require('./services/CredentialsManager');
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

  // ── Free Trial IPC ───────────────────────────────────────────────────────────

  // Start or resume a free trial. Fetches HWID, calls server, persists token locally.
  safeHandle("trial:start", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get hardware ID for HWID-binding
      let hwid = 'unavailable';
      try {
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
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
      const { CredentialsManager } = require('./services/CredentialsManager');
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
      const { CredentialsManager } = require('./services/CredentialsManager');
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
      const { CredentialsManager } = require('./services/CredentialsManager');
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
      const { CredentialsManager } = require('./services/CredentialsManager');
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
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
        await LicenseManager.getInstance().deactivate();
      } catch { /* LicenseManager not available in this build */ }

      // 5. Disable knowledge mode + wipe orchestrator in-memory caches for resume/JD
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('./knowledge/types');
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
          const { DocType } = require('./knowledge/types');
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

  // ==========================================
  // Follow-up Email Handlers
  // ==========================================

  safeHandle("generate-followup-email", async (_, input: any) => {
    try {
      const { FOLLOWUP_EMAIL_PROMPT, GROQ_FOLLOWUP_EMAIL_PROMPT } = require('./llm/prompts');
      const { buildFollowUpEmailPromptInput } = require('./utils/emailUtils');

      const llmHelper = appState.processingHelper.getLLMHelper();

      // Build the context string from input
      const contextString = buildFollowUpEmailPromptInput(input);

      // Build prompts
      const geminiPrompt = `${FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;
      const groqPrompt = `${GROQ_FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;

      // Use chatWithGemini with alternateGroqMessage for fallback
      const emailBody = await llmHelper.chatWithGemini(geminiPrompt, undefined, undefined, true, groqPrompt);

      return emailBody;
    } catch (error: any) {
      console.error("Error generating follow-up email:", error);
      throw error;
    }
  });

  safeHandle("extract-emails-from-transcript", async (_, transcript: Array<{ text: string }>) => {
    try {
      const { extractEmailsFromTranscript } = require('./utils/emailUtils');
      return extractEmailsFromTranscript(transcript);
    } catch (error: any) {
      console.error("Error extracting emails:", error);
      return [];
    }
  });

  safeHandle("get-calendar-attendees", async (_, eventId: string) => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      const cm = CalendarManager.getInstance();

      // Try to get attendees from the event
      const events = await cm.getUpcomingEvents();
      const event = events?.find((e: any) => e.id === eventId);

      if (event && event.attendees) {
        return event.attendees.map((a: any) => ({
          email: a.email,
          name: a.displayName || a.email?.split('@')[0] || ''
        })).filter((a: any) => a.email);
      }

      return [];
    } catch (error: any) {
      console.error("Error getting calendar attendees:", error);
      return [];
    }
  });

  safeHandle("open-mailto", async (_, { to, subject, body }: { to: string; subject: string; body: string }) => {
    try {
      const { buildMailtoLink } = require('./utils/emailUtils');
      const mailtoUrl = buildMailtoLink(to, subject, body);
      await shell.openExternal(mailtoUrl);
      return { success: true };
    } catch (error: any) {
      console.error("Error opening mailto:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle("rag:query-meeting", async (event, { meetingId, query }: { meetingId: string; query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      // Fallback to regular chat if RAG not available
      console.log("[RAG] Not ready, falling back to regular chat");
      return { fallback: true };
    }

    // For completed meetings, check if post-meeting RAG is processed.
    // For live meetings with JIT indexing, let RAGManager.queryMeeting() decide.
    if (!ragManager.isMeetingProcessed(meetingId) && !ragManager.isLiveIndexingActive(meetingId)) {
      console.log(`[RAG] Meeting ${meetingId} not processed and no JIT indexing, falling back to regular chat`);
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `meeting-${meetingId}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting(meetingId, query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { meetingId, chunk });
      }

      event.sender.send("rag:stream-complete", { meetingId });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If specific RAG failures, return fallback to use transcript window
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
          return { fallback: true };
        }

        console.error("[RAG] Query error:", error);
        event.sender.send("rag:stream-error", { meetingId, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query live meeting with JIT RAG
  safeHandle("rag:query-live", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    // Check if JIT indexing is active and has chunks
    if (!ragManager.isLiveIndexingActive('live-meeting-current')) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `live-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting('live-meeting-current', query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { live: true, chunk });
      }

      event.sender.send("rag:stream-complete", { live: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If JIT RAG failed (no embeddings yet, no relevant context), fallback to regular chat
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] JIT query failed with '${msg}', falling back to regular live chat`);
          return { fallback: true };
        }
        console.error("[RAG] Live query error:", error);
        event.sender.send("rag:stream-error", { live: true, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query global (cross-meeting search)
  safeHandle("rag:query-global", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `global-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryGlobal(query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { global: true, chunk });
      }

      event.sender.send("rag:stream-complete", { global: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        event.sender.send("rag:stream-error", { global: true, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Cancel active RAG query
  safeHandle("rag:cancel-query", async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
    const queryKey = global ? 'global' : `meeting-${meetingId}`;

    // Cancel any matching key
    for (const [key, controller] of activeRAGQueries) {
      if (key.startsWith(queryKey) || (global && key.startsWith('global'))) {
        controller.abort();
        activeRAGQueries.delete(key);
      }
    }

    return { success: true };
  });

  // Check if meeting has RAG embeddings
  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error: any) {
      console.error('[IPC rag:is-meeting-processed] Error:', error);
      return false;
    }
  });

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC rag:reindex-incompatible-meetings] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get RAG queue status
  safeHandle("rag:get-queue-status", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle("rag:retry-embeddings", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });

  // ==========================================
  // Profile Engine IPC Handlers
  // ==========================================

  safeHandle("profile:upload-resume", async (_, filePath: string) => {
    try {
      // Premium gate: require active license or free trial for profile features
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      console.log(`[IPC] profile:upload-resume called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }
      const { DocType } = require('./knowledge/types');
      const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-resume error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:get-status", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { hasProfile: false, profileMode: false };
      }
      // Map new KnowledgeStatus back to legacy UI shape temporarily
      const status = orchestrator.getStatus();
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears
      };
    } catch (error: any) {
      return { hasProfile: false, profileMode: false };
    }
  });

  safeHandle("profile:set-mode", async (_, enabled: boolean) => {
    try {
      // Premium gate: only allow enabling profile mode with active license or free trial
      if (enabled && !isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setKnowledgeMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('knowledgeMode', enabled);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('./knowledge/types');
      orchestrator.deleteDocumentsByType(DocType.RESUME);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:get-profile", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return null;
      return orchestrator.getProfileData();
    } catch (error: any) {
      return null;
    }
  });

  safeHandle("profile:select-file", async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Resume Files', extensions: ['pdf', 'docx', 'txt'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }

      return { success: true, filePath: result.filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // JD & Research IPC Handlers
  // ==========================================

  safeHandle("profile:upload-jd", async (_, filePath: string) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      console.log(`[IPC] profile:upload-jd called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }
      const { DocType } = require('./knowledge/types');
      const result = await orchestrator.ingestDocument(filePath, DocType.JD);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete-jd", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('./knowledge/types');
      orchestrator.deleteDocumentsByType(DocType.JD);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:research-company", async (_, companyName: string) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const engine = orchestrator.getCompanyResearchEngine();

      // Wire search provider: Tavily (user key) → Natively API (fallback) → none (LLM-only)
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const tavilyApiKey = cm.getTavilyApiKey();
      if (tavilyApiKey) {
        const { TavilySearchProvider } = require('./knowledge/TavilySearchProvider');
        engine.setSearchProvider(new TavilySearchProvider(tavilyApiKey));
      } else {
        engine.setSearchProvider(null);
      }

      // Build full JD context so the dossier is tailored to the exact role
      const profileData = orchestrator.getProfileData();
      const activeJD = profileData?.activeJD;
      const jdCtx = activeJD ? {
        title: activeJD.title,
        location: activeJD.location,
        level: activeJD.level,
        technologies: activeJD.technologies,
        requirements: activeJD.requirements,
        keywords: activeJD.keywords,
        compensation_hint: activeJD.compensation_hint,
        min_years_experience: activeJD.min_years_experience,
      } : {};
      const dossier = await engine.researchCompany(companyName, jdCtx, true);
      const searchQuotaExhausted = (engine.searchProvider as any)?.quotaExhausted === true;
      return { success: true, dossier, searchQuotaExhausted };
    } catch (error: any) {
      console.error('[IPC] profile:research-company error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:generate-negotiation", async (_, force: boolean = false) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const status = orchestrator.getStatus();
      if (!status.hasResume) {
        return { success: false, error: 'No resume loaded' };
      }

      // Use cache unless force-regenerating
      let script = force ? null : orchestrator.getNegotiationScript();
      if (!script) {
        script = await orchestrator.generateNegotiationScriptOnDemand();
      }
      if (!script) {
        return { success: false, error: 'Could not generate negotiation script. Ensure a resume and job description are uploaded.' };
      }
      return { success: true, script };
    } catch (error: any) {
      console.error('[IPC] profile:generate-negotiation error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:get-negotiation-state", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Engine not ready' };
      const tracker = orchestrator.getNegotiationTracker();
      return {
        success: true,
        state: tracker.getState(),
        isActive: tracker.isActive(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:reset-negotiation", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false };
      orchestrator.resetNegotiationSession();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Profile Custom Notes
  // ==========================================

  safeHandle("profile:get-notes", async () => {
    try {
      const content = DatabaseManager.getInstance().getCustomNotes();
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle("profile:save-notes", async (_, content: string) => {
    try {
      // Enforce a max length of 4000 chars to prevent prompt bloat
      const trimmed = typeof content === 'string' ? content.slice(0, 4000) : '';
      DatabaseManager.getInstance().saveCustomNotes(trimmed);

      // Propagate to orchestrator (premium path) and LLMHelper (all-provider path)
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (orchestrator?.setCustomNotes) orchestrator.setCustomNotes(trimmed);

      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setCustomNotes) llmHelper.setCustomNotes(trimmed);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Tavily Search API Credentials
  // ==========================================

  safeHandle("set-tavily-api-key", async (_, apiKey: string) => {
    try {
      if (apiKey && !apiKey.startsWith('tvly-')) {
        return { success: false, error: 'Invalid Tavily API key. Keys must start with "tvly-".' };
      }
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setTavilyApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Overlay Opacity (Stealth Mode)
  // ==========================================

  safeHandle("set-overlay-opacity", async (_, opacity: number) => {
    // Clamp to valid range
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    // Broadcast to all renderer windows so the overlay picks it up in real-time
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay-opacity-changed', clamped);
      }
    });
    return;
  });

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
