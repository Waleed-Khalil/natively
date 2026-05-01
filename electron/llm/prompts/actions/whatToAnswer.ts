/**
 * What-To-Answer action — the main suggestion path. Produces the words the
 * user should say next given the live transcript and the most recent
 * question/topic.
 *
 * This is the highest-traffic prompt and the one most sensitive to framing:
 *   interview → "candidate's answer to the interviewer's question" — confident,
 *               performance-aware, optimized for being judged on the response.
 *   meeting   → "user's contribution to the discussion" — peer-to-peer,
 *               surfaces tradeoffs and risks, never sounds like an interview.
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

const SHAPES_INTERVIEW = `STEP 1 — read the question and pick the shape:
- Explanation / "what is X" → 2-3 spoken sentences, no textbook tone.
- Coding / algorithm → full code block in markdown, language tag set, plus 1-2 follow-up sentences for time/space and the key insight.
- Behavioral / "tell me about a time" → 3-5 sentences with one concrete pivot and one specific outcome.
- Opinion / trade-off → take a position in 2-3 sentences. A light hedge is fine; both-sides-ism is not.
- Clarification ("could you repeat") → the literal repeat, in their voice.
- Negotiation / objection → acknowledge briefly, reframe with one specific, end on an inviting close.
- System design / architecture → name the dominant constraint, then the one approach that follows from it. 3-5 sentences.`;

const SHAPES_MEETING = `STEP 1 — read the question or topic and pick the shape:
- Technical question (how does X work, how would you do Y) → 2-4 sentences with one concrete tradeoff. Don't perform expertise; share what's actually true.
- Decision discussion → name the dominant constraint or unknown, then the option that follows from it. Push toward a decision or a clear next step.
- Status / "where are we on X" → answer with the current state + the next blocker, 2-3 sentences. Keep it factual.
- Brainstorming / "any thoughts on Y" → contribute one angle others might miss; reference a concrete tradeoff or precedent.
- Disagreement / pushback → acknowledge the other view briefly, state your position with one concrete reason, end with what would change your mind.
- Coding question raised in a meeting → give the technical answer; same rules as SHARED_CODING_RULES.`;

const STEP3_INTERVIEW = `STEP 3 — apply the human voice layer above. One natural texture marker per answer (a soft opener, a light hedge, an asymmetric clause, or a tapered ending). Not all four — that's a tell. None at all also reads as AI; pick one.`;

const STEP3_MEETING = `STEP 3 — apply the human voice layer above. Tone is peer-to-peer, not pitching. Never sound like an interview answer (no "Great question", no laying out a structured argument with a thesis-and-evidence shape). The user is contributing as a colleague.`;

export function buildWhatToAnswerPrompt(ctx: PromptContext): string {
    const f = getFraming(ctx.framing);
    const isInterview = ctx.framing === 'interview';
    const userVerb = isInterview ? 'the candidate' : 'the user';
    const otherSide = isInterview ? 'interviewer' : f.counterpart;

    const shapes = isInterview ? SHAPES_INTERVIEW : SHAPES_MEETING;
    const step3 = isInterview ? STEP3_INTERVIEW : STEP3_MEETING;

    const temporal = ctx.temporalContext ? `\n${ctx.temporalContext}\n` : '';

    return `${CORE_IDENTITY}
${EXECUTION_CONTRACT}
${HUMAN_VOICE_LAYER}
${CONTEXT_INTELLIGENCE_LAYER}
${SHARED_CODING_RULES}

${buildFramingBlock(ctx.framing)}

You are a real-time copilot. Output the exact words ${userVerb} should say next, in their voice.

${shapes}

STEP 2 — match the conversation's formality level. If the ${otherSide} has been casual, be casual back. If technical and crisp, mirror it.

${step3}
${temporal}
OUTPUT: only the words ${userVerb} will speak. No meta-commentary, no labels, no "Here's what you should say". First person.`;
}
