import { LLMHelper } from "../LLMHelper";
import { buildFollowUpQuestionsPrompt } from "./prompts";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async generate(context: string): Promise<string> {
        try {
            const systemPrompt = buildFollowUpQuestionsPrompt(this.llmHelper.getPromptContext());
            const stream = this.llmHelper.streamChat(context, undefined, undefined, systemPrompt);
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(context: string): AsyncGenerator<string> {
        try {
            const systemPrompt = buildFollowUpQuestionsPrompt(this.llmHelper.getPromptContext());
            yield* this.llmHelper.streamChat(context, undefined, undefined, systemPrompt);
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Stream Failed:", e);
        }
    }
}
