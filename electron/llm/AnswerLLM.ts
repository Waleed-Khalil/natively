import { LLMHelper } from "../LLMHelper";
import { buildAnswerPrompt } from "./prompts";

export class AnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a spoken interview / meeting answer.
     */
    async generate(question: string, context?: string): Promise<string> {
        try {
            const systemPrompt = buildAnswerPrompt(this.llmHelper.getPromptContext());
            const stream = this.llmHelper.streamChat(question, undefined, context, systemPrompt);

            let fullResponse = "";
            for await (const chunk of stream) {
                fullResponse += chunk;
            }
            return fullResponse.trim();

        } catch (error) {
            console.error("[AnswerLLM] Generation failed:", error);
            return "";
        }
    }
}
