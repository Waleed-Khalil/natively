/**
 * Compositional prompt API.
 *
 * Each action exports a `build*Prompt(ctx)` function that takes a
 * `PromptContext` (framing + provider + optional voice/temporal/notes) and
 * returns the final system prompt string.
 *
 * All nine action types go through the compositional path. The codebase
 * targets a single provider (Claude); per-provider variants have been
 * removed.
 */

export type { PromptContext, Framing, Provider } from './types';
export { DEFAULT_CONTEXT } from './types';
export { buildFramingBlock, getFraming, framingFromTemplate, applyFramingTokens } from './framings';
export { section, getFormat } from './providerFormat';

export { buildClarifyPrompt } from './actions/clarify';
export { buildRecapPrompt } from './actions/recap';
export { buildFollowUpPrompt } from './actions/followUp';
export { buildFollowUpQuestionsPrompt } from './actions/followUpQuestions';
export { buildBrainstormPrompt } from './actions/brainstorm';
export { buildWhatToAnswerPrompt } from './actions/whatToAnswer';
export { buildAssistPrompt } from './actions/assist';
export { buildAnswerPrompt } from './actions/answer';
export { buildCodeHintPrompt } from './actions/codeHint';
