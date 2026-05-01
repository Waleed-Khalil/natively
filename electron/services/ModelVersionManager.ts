/**
 * ModelVersionManager — Claude-only stub.
 *
 * The historical implementation auto-discovered new model versions across
 * OpenAI / Gemini / Groq / Claude and rotated them through tiers. After the
 * Claude-only refactor, the multi-provider machinery is gone and this class
 * is a thin no-op stub that preserves the public surface used by LLMHelper:
 *   - setApiKeys
 *   - initialize
 *   - getSummary
 *   - stopScheduler
 */

const CLAUDE_MODEL = 'claude-sonnet-4-6';

export class ModelVersionManager {
    private claudeApiKey: string | null = null;

    public setApiKeys(keys: { claude?: string | null }): void {
        if (keys.claude !== undefined) this.claudeApiKey = keys.claude;
    }

    public async initialize(): Promise<void> {
        // No-op. Discovery loop deleted with the multi-provider purge; the
        // single supported provider's model id is hard-coded in LLMHelper.
        return;
    }

    public getSummary(): string {
        return `[ModelVersionManager] Claude-only mode. Default model: ${CLAUDE_MODEL}. Key configured: ${this.claudeApiKey ? 'yes' : 'no'}`;
    }

    public stopScheduler(): void {
        // No scheduler to stop.
    }
}
