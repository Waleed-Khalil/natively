import { safeHandle } from "./helpers";

export function registerModelDiscoveryHandlers(): void {
  safeHandle("fetch-provider-models", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => {
    try {
      // Fall back to stored key if no key was explicitly provided
      let key = apiKey?.trim();
      if (!key) {
        const { CredentialsManager } = require('../services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        if (provider === 'gemini') key = cm.getGeminiApiKey();
        else if (provider === 'groq') key = cm.getGroqApiKey();
        else if (provider === 'openai') key = cm.getOpenaiApiKey();
        else if (provider === 'claude') key = cm.getClaudeApiKey();
      }

      if (!key) {
        return { success: false, error: 'No API key available. Please save a key first.' };
      }

      const { fetchProviderModels } = require('../utils/modelFetcher');
      const models = await fetchProviderModels(provider, key);
      return { success: true, models };
    } catch (error: any) {
      console.error(`[IPC] Failed to fetch ${provider} models:`, error);
      const msg = error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
      return { success: false, error: msg };
    }
  });

  safeHandle("set-provider-preferred-model", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setPreferredModel(provider, modelId);
    } catch (error: any) {
      console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
    }
  });
}
