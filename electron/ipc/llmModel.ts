import { BrowserWindow } from "electron";
import { AppState } from "../main";
import { safeHandle, sanitizeErrorMessage } from "./helpers";

export function registerLlmModelHandlers(appState: AppState): void {
  safeHandle("test-llm-connection", async (_, _provider: 'claude', apiKey?: string) => {
    console.log(`[IPC] Received test-llm-connection request for Claude`);
    try {
      if (!apiKey || !apiKey.trim()) {
        const { CredentialsManager } = require('../services/CredentialsManager');
        apiKey = CredentialsManager.getInstance().getClaudeApiKey();
      }

      if (!apiKey || !apiKey.trim()) {
        return { success: false, error: 'No API key provided' };
      }

      const axios = require('axios');
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
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

      if (response && (response.status === 200 || response.status === 201)) {
        return { success: true };
      }
      return { success: false, error: 'Request failed with status ' + response?.status };
    } catch (error: any) {
      console.error("LLM connection test failed:", error);
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || (error.response?.data?.error?.type ? `${error.response.data.error.type}: ${error.response.data.error.message}` : error.message) || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      return { success: false, error: msg };
    }
  });

  safeHandle("set-model", async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setModel(modelId);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so the UI can update its selector
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

      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setModel(modelId);

      appState.modelSelectorWindowHelper.hideWindow();

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
      return { model: 'claude-sonnet-4-6' };
    }
  });
}
