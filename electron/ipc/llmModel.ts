import { BrowserWindow } from "electron";
import { AppState } from "../main";
import { safeHandle, sanitizeErrorMessage } from "./helpers";

export function registerLlmModelHandlers(appState: AppState): void {
  safeHandle("test-llm-connection", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => {
    console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
    try {
      if (!apiKey || !apiKey.trim()) {
        const { CredentialsManager } = require('../services/CredentialsManager');
        const creds = CredentialsManager.getInstance();
        if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
        else if (provider === 'groq') apiKey = creds.getGroqApiKey();
        else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
        else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
      }

      if (!apiKey || !apiKey.trim()) {
        return { success: false, error: 'No API key provided' };
      }

      const axios = require('axios');
      let response;

      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent`;
        response = await axios.post(url, {
          contents: [{ parts: [{ text: "Hello" }] }]
        }, {
          headers: { 'x-goog-api-key': apiKey },
          timeout: 15000
        });
      } else if (provider === 'groq') {
        response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
      } else if (provider === 'openai') {
        response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
      } else if (provider === 'claude') {
        response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 15000
        });
      }

      if (response && (response.status === 200 || response.status === 201)) {
        return { success: true };
      } else {
        return { success: false, error: 'Request failed with status ' + response?.status };
      }

    } catch (error: any) {
      console.error("LLM connection test failed:", error);
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || (error.response?.data?.error?.type ? `${error.response.data.error.type}: ${error.response.data.error.message}` : error.message) || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      return { success: false, error: msg };
    }
  });

  safeHandle("get-groq-fast-text-mode", () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error: any) {
      return { enabled: false };
    }
  });

  // Set Groq Fast Text Mode
  safeHandle("set-groq-fast-text-mode", (_, enabled: boolean) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);

      const { SettingsManager } = require('../services/SettingsManager');
      SettingsManager.getInstance().set('groqFastTextMode', enabled);

      // Broadcast to all windows
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('groq-fast-text-changed', enabled);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-model", async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get all providers (Curl + Custom)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];

      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector (session-only update)
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting model:", error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings) + update runtime + broadcast to all windows
  safeHandle("set-default-model", async (_, modelId: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      cm.setDefaultModel(modelId);

      // Also update the runtime model
      const llmHelper = appState.processingHelper.getLLMHelper();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting default model:", error);
      return { success: false, error: error.message };
    }
  });

  // Read the persisted default model
  safeHandle("get-default-model", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error: any) {
      console.error("Error getting default model:", error);
      return { model: 'gemini-3.1-flash-lite-preview' };
    }
  });
}
