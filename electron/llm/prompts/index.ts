/**
 * Compositional prompt API.
 *
 * Each action exports a `build*Prompt(ctx)` function that takes a
 * `PromptContext` (framing + provider + optional voice/temporal/notes) and
 * returns the final system prompt string.
 *
 * Migration status — actions migrated to compositional builders:
 *   ✓ clarify
 *   ✓ recap
 *   ✓ followUp (refinement)
 *   ✓ followUpQuestions
 *   – brainstorm        (still uses BRAINSTORM_MODE_PROMPT directly)
 *   – whatToAnswer      (still uses WHAT_TO_ANSWER_PROMPT family)
 *   – assist            (still uses ASSIST_MODE_PROMPT)
 *   – answer            (still uses ANSWER_MODE_PROMPT family)
 *   – codeHint          (still uses CODE_HINT_PROMPT)
 *
 * As actions migrate, the corresponding legacy `*_MODE_PROMPT` and
 * `{CLAUDE,GROQ,OPENAI}_*` constants in prompts.ts will be deleted.
 */

export type { PromptContext, Framing, Provider } from './types';
export { DEFAULT_CONTEXT } from './types';
export { buildFramingBlock, getFraming, framingFromTemplate, applyFramingTokens } from './framings';
export { section, getFormat } from './providerFormat';

export { buildClarifyPrompt } from './actions/clarify';
export { buildRecapPrompt } from './actions/recap';
export { buildFollowUpPrompt } from './actions/followUp';
export { buildFollowUpQuestionsPrompt } from './actions/followUpQuestions';
