import { safeHandle } from "./helpers";

export function registerModelDiscoveryHandlers(): void {
  safeHandle("fetch-provider-models", async (_, _provider: 'claude', apiKey: string) => {
    try {
      let key = apiKey?.trim();
      if (!key) {
        const { CredentialsManager } = require('../services/CredentialsManager');
        key = CredentialsManager.getInstance().getClaudeApiKey();
      }

      if (!key) {
        return { success: false, error: 'No API key available. Please save a key first.' };
      }

      const { fetchProviderModels } = require('../utils/modelFetcher');
      const models = await fetchProviderModels('claude', key);
      return { success: true, models };
    } catch (error: any) {
      console.error(`[IPC] Failed to fetch Claude models:`, error);
      const msg = error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
      return { success: false, error: msg };
    }
  });

  safeHandle("set-provider-preferred-model", async (_, _provider: 'claude', modelId: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setPreferredModel(modelId);
    } catch (error: any) {
      console.error(`[IPC] Failed to set preferred Claude model:`, error);
    }
  });
}
