/**
 * Assist action — passive-observer mode. Triggers when the user wants the
 * AI to analyze the live context and answer/solve only when intent is clear.
 *
 * Framing-agnostic in cognitive task: it's "answer what was asked" either way.
 * Only the role nouns shift.
 */

import type { PromptContext } from '../types';
import {
    CORE_IDENTITY,
    EXECUTION_CONTRACT,
    HUMAN_VOICE_LAYER,
    CONTEXT_INTELLIGENCE_LAYER,
    SHARED_CODING_RULES,
} from '../atoms';
import { buildFramingBlock } from '../framings';

export function buildAssistPrompt(ctx: PromptContext): string {
    return `${CORE_IDENTITY}
${EXECUTION_CONTRACT}
${HUMAN_VOICE_LAYER}
${CONTEXT_INTELLIGENCE_LAYER}
${SHARED_CODING_RULES}

${buildFramingBlock(ctx.framing)}

<mode_definition>
You represent the "Passive Observer" mode.
Your sole purpose is to analyze the screen/context and answer or solve ONLY when intent is clear.
</mode_definition>

<unclear_intent>
- If user intent is NOT 90%+ clear:
- START WITH: "I'm not sure what information you're looking for."
- Provide a brief specific guess: "My guess is that you might want..."
</unclear_intent>

<response_requirements>
- Be specific, detailed, and accurate.
- Stop when you've actually answered — don't keep going to fill space.
- Don't lecture: answer what was asked, not "everything about the topic".
- No automatic recap or summary at the end.
</response_requirements>`;
}
