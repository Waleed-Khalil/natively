/**
 * Framing layer — the role / register / stakes of the conversation.
 *
 * Every action prompt prepends a framing block. The COGNITIVE TASK of each
 * action (what brainstorm does, what clarify does) lives in the action body
 * and is the same regardless of framing. Only the role pronouns and tone
 * shift here.
 */

import type { Framing } from './types';

interface FramingDescriptor {
    /** Single noun for the user, e.g. "candidate" or "participant". */
    user: string;
    /** Single noun for the other speaker(s), e.g. "interviewer" or "colleague". */
    counterpart: string;
    /** Plural form of `counterpart` for cases with multiple. */
    counterpartPlural: string;
    /** One-sentence description of the situation, used in role openers. */
    situation: string;
    /** One-sentence tone target. */
    tone: string;
    /** Anti-pattern guard — what the AI must NOT sound like. */
    avoid: string;
}

const INTERVIEW: FramingDescriptor = {
    user: 'candidate',
    counterpart: 'interviewer',
    counterpartPlural: 'interviewers',
    situation: 'live job interview where the user is being evaluated for a role',
    tone: 'confident and performance-aware — the user is being judged on the response',
    avoid: 'meeting-style brainstorming or peer-to-peer collaboration tone (the user is not a peer here, they are a candidate)',
};

const MEETING: FramingDescriptor = {
    user: 'participant',
    counterpart: 'colleague',
    counterpartPlural: 'colleagues',
    situation: 'collaborative work meeting where the user is contributing as a teammate among peers',
    tone: 'peer-to-peer and decision-oriented — surfaces tradeoffs and risks rather than performing expertise',
    avoid: 'interview-style answers that sound like the user is being graded (no need to prove themselves; they are a teammate already)',
};

const FRAMINGS: Record<Framing, FramingDescriptor> = {
    interview: INTERVIEW,
    meeting:   MEETING,
};

export function getFraming(framing: Framing): FramingDescriptor {
    return FRAMINGS[framing];
}

/**
 * Builds the `<framing>` block that prepends every action prompt. Plain text
 * style; provider format adapters (XML tags etc.) wrap externally if needed.
 */
export function buildFramingBlock(framing: Framing): string {
    const f = FRAMINGS[framing];
    return `<framing>
You are assisting in a ${f.situation}.
The user is ${f.user === 'candidate' ? 'the' : 'a'} ${f.user}; the other speaker(s) are ${f.counterpartPlural}.
Tone: ${f.tone}.
Never sound like ${f.avoid}.
</framing>`;
}

/**
 * Resolve a framing from the active mode template. Two of the seven mode
 * templates are interview-shaped; the rest default to meeting framing.
 *
 * Called from LLMHelper / action LLM classes when assembling a context.
 */
export function framingFromTemplate(templateType: string | null | undefined): Framing {
    if (!templateType) return 'interview'; // preserve legacy default
    if (templateType === 'technical-interview') return 'interview';
    if (templateType === 'looking-for-work') return 'interview';
    return 'meeting';
}

/**
 * Token replacement helper for prompts that prefer to embed role nouns inline
 * rather than rely on the framing block alone. Replaces `{{user}}`,
 * `{{counterpart}}`, and `{{counterparts}}` placeholders.
 */
export function applyFramingTokens(text: string, framing: Framing): string {
    const f = FRAMINGS[framing];
    return text
        .replace(/\{\{user\}\}/g, f.user)
        .replace(/\{\{counterpart\}\}/g, f.counterpart)
        .replace(/\{\{counterparts\}\}/g, f.counterpartPlural);
}
