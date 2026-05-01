/**
 * The single context object that every action prompt builder receives.
 *
 * Compositional prompt design: instead of per-action prompt constants, each
 * action is a function that takes this context and returns the final prompt
 * string. Variants are produced by different ctx values.
 */

export type Framing = 'interview' | 'meeting';

export type Provider = 'claude';

export interface PromptContext {
    /**
     * Conversation register. `interview` = the user is being evaluated by the
     * other speaker(s). `meeting` = the user is contributing as a peer in a
     * collaborative work conversation.
     */
    framing: Framing;

    /**
     * Which LLM provider will run this prompt. Always `'claude'`. Kept as a
     * field so prompt builders that fan out by provider continue to compile;
     * the value never varies.
     */
    provider: Provider;

    /**
     * Optional candidate-voice anchor block produced by
     * `CandidateVoiceProfile.buildAnchorBlock()`.
     */
    voiceAnchor?: string;

    /**
     * Optional `<temporal_awareness>` block built by `TemporalContextBuilder`.
     */
    temporalContext?: string;

    /**
     * Optional user-provided custom notes from Settings → Profile → Custom Notes.
     */
    customNotes?: string;
}

/**
 * Default context — interview framing, Claude provider.
 */
export const DEFAULT_CONTEXT: PromptContext = {
    framing: 'interview',
    provider: 'claude',
};
