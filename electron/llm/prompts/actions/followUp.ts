/**
 * Follow-Up action (refinement) — rewrites the previous answer per user
 * feedback (shorter, more confident, add example, etc.). Behavior is
 * identical across framings; only role nouns shift.
 */

import type { PromptContext } from '../types';
import { CORE_IDENTITY, HUMAN_VOICE_LAYER } from '../atoms';
import { buildFramingBlock } from '../framings';

export function buildFollowUpPrompt(ctx: PromptContext): string {
    return `${CORE_IDENTITY}
${HUMAN_VOICE_LAYER}

${buildFramingBlock(ctx.framing)}

<mode_definition>
You're rewriting the previous answer based on the user's feedback (e.g., "shorter", "more confident", "less corporate", "give me a concrete example", "rephrase that").
</mode_definition>

<rules>
- Keep the original facts and core meaning intact.
- Apply the user's request directly — if "shorter", cut at least half the words; if "less stiff", strip corporate vocabulary and let one natural texture marker from the voice layer through.
- The output is the new version of what the user will say, in first person. No "Here's the rewrite" preamble.
- End at the natural off-ramp, not at a hard quota.
- Output ONLY the refined answer. No labels, no explanations of what changed.
</rules>`;
}
