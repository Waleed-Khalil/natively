import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_WHAT_TO_ANSWER_PROMPT, PERSPECTIVE_LOCK } from "./prompts";
import { TemporalContext } from "./TemporalContextBuilder";
import { IntentResult } from "./IntentClassifier";
import type { ConversationRegister } from "../SessionTracker";
import { CandidateVoiceProfile } from "../services/CandidateVoiceProfile";

export class WhatToAnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    // Deprecated non-streaming method (redirect to streaming or implement if needed)
    async generate(cleanedTranscript: string): Promise<string> {
        // Simple wrapper around stream
        const stream = this.generateStream(cleanedTranscript);
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    async *generateStream(
        cleanedTranscript: string,
        temporalContext?: TemporalContext,
        intentResult?: IntentResult,
        imagePaths?: string[],
        manualTrigger: boolean = false,
        register?: ConversationRegister,
        interviewerPerspective?: string
    ): AsyncGenerator<string> {
        try {
            // Build a rich message context
            // Note: We can't easily inject the complex temporal/intent logic into universal prompt *variables* 
            // but we can prepend it to the message.

            let contextParts: string[] = [];

            if (intentResult) {
                const isTechnical = intentResult.intent === 'coding';
                contextParts.push(`<intent_and_shape>
DETECTED INTENT: ${intentResult.intent}
ANSWER SHAPE: ${intentResult.answerShape}
${isTechnical ? `\nCRITICAL: This is a PURE TECHNICAL question. ABSOLUTE RULES:\n- DO NOT mention resume, work history, past employers, or personal background\n- DO NOT say "based on your experience at X" or reference any company\n- Output ONLY code + brief spoken explanation. Nothing else.` : ''}
</intent_and_shape>`);
            }

            if (temporalContext && temporalContext.hasRecentResponses) {
                const history = temporalContext.previousResponses.map((r, i) => `${i + 1}. "${r}"`).join('\n');
                contextParts.push(`PREVIOUS RESPONSES (Avoid Repetition):\n${history}`);
            }

            if (temporalContext && temporalContext.toneSignals.length > 0) {
                const primary = [...temporalContext.toneSignals].sort((a, b) => b.confidence - a.confidence)[0];
                contextParts.push(`<tone_guidance>Maintain ${primary.type} tone to stay consistent with your previous responses.</tone_guidance>`);
            }

            if (temporalContext && temporalContext.roleContext !== 'general') {
                const roleDesc = temporalContext.roleContext === 'responding_to_interviewer'
                    ? "You are responding to the interviewer's question."
                    : 'You are helping the user formulate their response.';
                contextParts.push(`<role_context>${roleDesc}</role_context>`);
            }

            // Structured anti-repetition register. Builds an explicit "you've already
            // said these things" block so the model varies anchors / metrics / openers
            // instead of just hoping it notices repetition in the previous-responses dump.
            if (register) {
                const lines: string[] = [];
                if (register.anchorsUsed.size > 0) {
                    lines.push(`- Anchors mentioned: ${Array.from(register.anchorsUsed).join(', ')}`);
                }
                if (register.projectsMentioned.size > 0) {
                    lines.push(`- Projects covered: ${Array.from(register.projectsMentioned).join(', ')}`);
                }
                if (register.metricsDropped.size > 0) {
                    lines.push(`- Metrics already dropped: ${Array.from(register.metricsDropped).join(', ')}`);
                }
                if (register.openersUsed.length > 0) {
                    const recent = register.openersUsed.slice(-4).map(o => `"${o}"`).join(', ');
                    lines.push(`- Recent openers used: ${recent}`);
                }
                if (lines.length > 0) {
                    contextParts.push(
                        `<already_said_this_interview>\n${lines.join('\n')}\n</already_said_this_interview>\n` +
                        `DO NOT reuse anchors, projects, or metrics from above. Vary openers — pick one not in the recent list.`
                    );
                }
            }

            // Phase 3 — interviewer perspective. Pre-generation pass that
            // briefs the answer LLM on what this specific interviewer is
            // looking for. Engine returns null when disabled, missing, or
            // timed out, so this is a no-op outside the happy path.
            if (interviewerPerspective && interviewerPerspective.trim().length > 0) {
                contextParts.push(
                    `<interviewer_perspective>\n${interviewerPerspective.trim()}\n</interviewer_perspective>`
                );
            }

            // Candidate voice anchor: few-shot of the user's actual speech, built
            // from saved transcripts via scripts/voice-profile/build.js. Empty
            // string when no profile exists, so this is a no-op for users who
            // haven't run the builder yet. Placed last so the few-shot examples
            // sit closest to the conversation in the assembled prompt.
            const voiceAnchor = CandidateVoiceProfile.getInstance().buildAnchorBlock();
            if (voiceAnchor) {
                contextParts.push(voiceAnchor);
            }

            const extraContext = contextParts.join('\n\n');
            const baseMessage = extraContext
                ? `${extraContext}\n\nCONVERSATION:\n${cleanedTranscript}`
                : cleanedTranscript;
            const fullMessage = manualTrigger
                ? `${PERSPECTIVE_LOCK}\n\n${baseMessage}`
                : baseMessage;

            // Use Universal Prompt
            // Note: WhatToAnswer has a very specific prompt. 
            // We should use UNIVERSAL_WHAT_TO_ANSWER_PROMPT as override

            yield* this.llmHelper.streamChat(fullMessage, imagePaths, undefined, UNIVERSAL_WHAT_TO_ANSWER_PROMPT);

        } catch (error) {
            console.error("[WhatToAnswerLLM] Stream failed:", error);
            yield "Could you repeat that? I want to make sure I address your question properly.";
        }
    }
}
