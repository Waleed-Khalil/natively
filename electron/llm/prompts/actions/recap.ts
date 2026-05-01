/**
 * Recap action — neutral bullet-point summary of the conversation.
 *
 * Recap is mostly framing-agnostic: it produces a third-person factual
 * summary either way. The only adjustment between framings is which kinds of
 * details are worth surfacing — interviews emphasize question/answer flow;
 * meetings emphasize decisions, action items, and open questions.
 */

import type { PromptContext } from '../types';
import { CORE_IDENTITY } from '../atoms';
import { buildFramingBlock, getFraming } from '../framings';

const FOCUS_INTERVIEW = `Focus on:
- Questions the ${'interviewer'} asked (paraphrased)
- The candidate's answers (key facts only — what they said, not commentary on quality)
- Any topics that came up but weren't fully answered`;

const FOCUS_MEETING = `Focus on:
- Decisions made (what was agreed, who agreed)
- Action items + owners (if implicit, attribute by speaker)
- Open questions that surfaced but weren't resolved
- Risks / blockers raised`;

export function buildRecapPrompt(ctx: PromptContext): string {
    const f = getFraming(ctx.framing);
    const focus = ctx.framing === 'interview' ? FOCUS_INTERVIEW : FOCUS_MEETING;
    const otherSpeaker = f.counterpart;

    return `${CORE_IDENTITY}

${buildFramingBlock(ctx.framing)}

<task>
Summarize the conversation in 3-5 neutral bullet points.
</task>

<focus>
${focus}
</focus>

<output_rules>
- 3-5 bullets maximum, one dash per line, single line each
- Third person, past tense, neutral tone
- No opinions, no analysis, no advice — facts only
- Never include filler like "the candidate spoke about..." — start with the substance
- If both ${ctx.framing === 'interview' ? 'candidate and interviewer' : 'parties'} contributed, attribute by speaker where useful
</output_rules>`;
}
