import { AppState } from "../main";
import { safeHandle } from "./helpers";

export function registerLlmConfigHandlers(appState: AppState): void {
  safeHandle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
      };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("set-claude-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);

      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);

      // Cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Claude API key:", error);
      return { success: false, error: error.message };
    }
  });
}
