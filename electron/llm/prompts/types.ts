/**
 * The single context object that every action prompt builder receives.
 *
 * Compositional prompt design: instead of 30+ string constants
 * (action × provider × framing), each action is a function that takes this
 * context and returns the final prompt string. Variants are produced by
 * different ctx values, not by separate prompt files.
 */

export type Framing = 'interview' | 'meeting';

export type Provider = 'gemini' | 'claude' | 'openai' | 'groq' | 'custom';

export interface PromptContext {
    /**
     * Conversation register. `interview` = the user is being evaluated by the
     * other speaker(s). `meeting` = the user is contributing as a peer in a
     * collaborative work conversation. Drives tone and role framing only —
     * the cognitive task of each action is the same across both.
     */
    framing: Framing;

    /**
     * Which LLM provider will run this prompt. Used for format adaptation
     * (Claude likes XML tags, Groq prefers terse instructions, etc.) — NOT
     * for behavioral differences. If two providers would receive substantively
     * different instructions, that's a sign the divergence belongs in the
     * action body or framing layer, not as a per-provider fork.
     */
    provider: Provider;

    /**
     * Optional candidate-voice anchor block produced by
     * `CandidateVoiceProfile.buildAnchorBlock()`. Already a complete prompt
     * fragment; the builder either includes it or omits it.
     */
    voiceAnchor?: string;

    /**
     * Optional `<temporal_awareness>` block (anti-repetition + tone guidance)
     * built by `TemporalContextBuilder` for what_to_say.
     */
    temporalContext?: string;

    /**
     * Optional user-provided custom notes from Settings → Profile → Custom Notes.
     * Should be a single string of free text, will be wrapped in
     * `<user_context>` in the final prompt.
     */
    customNotes?: string;
}

/**
 * Default context — interview framing, default provider routing.
 * Used when callers haven't been migrated to pass a context explicitly.
 */
export const DEFAULT_CONTEXT: PromptContext = {
    framing: 'interview',
    provider: 'gemini',
};
