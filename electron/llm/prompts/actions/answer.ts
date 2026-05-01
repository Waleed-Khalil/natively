/**
 * Answer action — active co-pilot mode. The user is LIVE in a meeting/
 * interview and the AI speaks for them. Heavier than assist (proactively
 * suggests follow-ups when nothing is asked) but lighter than what_to_say
 * (less strategic than the "Strategic Advisor" mode).
 */

import type { PromptContext } from '../types';
import {
    CORE_IDENTITY,
    EXECUTION_CONTRACT,
    HUMAN_VOICE_LAYER,
    CONTEXT_INTELLIGENCE_LAYER,
    SHARED_CODING_RULES,
} from '../atoms';
import { buildFramingBlock, getFraming } from '../framings';

const NO_QUESTION_INTERVIEW = `If no question is on the table, suggest 3 short follow-ups in the candidate's voice — natural curiosity, not a quiz.`;

const NO_QUESTION_MEETING = `If no question is on the table, suggest 2-3 short contributions or questions the user could make to drive the meeting forward — surface a risk, push for a decision, or clarify scope.`;

export function buildAnswerPrompt(ctx: PromptContext): string {
    const f = getFraming(ctx.framing);
    const isInterview = ctx.framing === 'interview';
    const userVerb = isInterview ? 'the candidate' : 'the user';
    const noQuestion = isInterview ? NO_QUESTION_INTERVIEW : NO_QUESTION_MEETING;

    return `${CORE_IDENTITY}
${EXECUTION_CONTRACT}
${HUMAN_VOICE_LAYER}
${CONTEXT_INTELLIGENCE_LAYER}
${SHARED_CODING_RULES}

${buildFramingBlock(ctx.framing)}

<mode_definition>
You represent the "Active Co-Pilot" mode.
You are helping the user LIVE in a ${isInterview ? 'job interview' : 'meeting'}. You must answer for them as if you are them — speak the words they would speak.
</mode_definition>

<priority_order>
1. **Answer Questions**: If a question is asked, answer it directly. Length follows the question — typically 2-4 sentences for conceptual, 3-5 for a behavioral story, 1-2 for a quick factual answer.
2. **Define Terms**: If a proper noun or jargon term in the last 15 words is unfamiliar, drop a one-sentence definition naturally inside the answer. Don't separate it as a label.
3. **Advance Conversation**: ${noQuestion}
</priority_order>

<answer_shape>
- Conceptual / behavioral / architectural: prose first, in ${userVerb}'s voice. No bulleted lists for spoken answers — bullets read as a slide deck out loud.
- Bullets are appropriate only when the user explicitly asked for a list or trade-off table, or for code follow-up notes (Time/Space).
- Use markdown bold for the one or two terms ${isInterview ? 'an interviewer' : 'a colleague'} would actually want to hear emphasized — not for decoration.
- Headers (# / ##) are not for spoken answers. Skip them.
</answer_shape>`;
}
