/**
 * Follow-Up Questions action — generates 3 conversation-specific questions
 * the user could ask. The CATEGORY of question genuinely differs between
 * framings:
 *   interview → curiosity questions about how things work at *their* company
 *   meeting   → questions that move the meeting forward (clarify scope,
 *               surface risk, push toward decision)
 */

import type { PromptContext } from '../types';
import { CORE_IDENTITY } from '../atoms';
import { buildFramingBlock, getFraming } from '../framings';

const PURPOSE_INTERVIEW = `You're generating questions a candidate could ask next — questions that come from genuine curiosity about how the topic plays out at *this* specific company, not questions that quiz the interviewer.`;

const PURPOSE_MEETING = `You're generating questions the user could ask next to move the meeting forward — clarify scope, surface a risk, push the group toward a decision, or align on ownership.`;

const GOOD_INTERVIEW = `<good_directions>
- How it shows up in their actual day-to-day or in production at their scale.
- What broke, what surprised them, what they had to roll back.
- The trade-off they're currently sitting with — what they'd change if starting over.
- Where the interviewer personally spends most of their time inside the topic.
</good_directions>

<avoid>
- Don't quiz or check correctness ("isn't it true that…", "shouldn't you…").
- Don't compare ("why X instead of Y") unless asking about a real constraint behind the choice.
- Don't ask basic definition questions.
- Don't start two questions the same way.
</avoid>`;

const GOOD_MEETING = `<good_directions>
- A scope-narrowing question that pins down what's in vs. out for this discussion.
- A risk surface question — "what's the failure mode if we go this route and it doesn't work?"
- A decision-criteria question — "what would have to be true for us to land on option A?"
- An ownership question — "who's the DRI on this once we're past today?"
- A timing question — "is this a decision-today, or are we aligning on next steps?"
</good_directions>

<avoid>
- Don't ask questions that re-litigate already-decided points.
- Don't open new tangents — stay on the topic the meeting is on.
- Don't ask basic definition questions.
- Don't start two questions the same way.
</avoid>`;

export function buildFollowUpQuestionsPrompt(ctx: PromptContext): string {
    const purpose = ctx.framing === 'interview' ? PURPOSE_INTERVIEW : PURPOSE_MEETING;
    const directions = ctx.framing === 'interview' ? GOOD_INTERVIEW : GOOD_MEETING;

    return `${CORE_IDENTITY}

${buildFramingBlock(ctx.framing)}

<mode_definition>
${purpose}
</mode_definition>

<voice>
Each question should sound like a real person who's been listening — slightly different rhythm, no template feel. Mix one short and one slightly longer. Conversational, not formal. Vary the openers across the three questions.
</voice>

${directions}

<output_format>
Three questions, one sentence each, conversational. Numbered list:
1. [Question 1]
2. [Question 2]
3. [Question 3]
</output_format>`;
}
