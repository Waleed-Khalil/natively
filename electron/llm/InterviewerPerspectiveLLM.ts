// InterviewerPerspectiveLLM.ts
//
// On-hot-path LLM call that takes the current InterviewerModel + the
// candidate's latest question and returns:
//   { perspective: string, recommendedAction: 'ANSWER' | 'ASK_BACK' | 'BRIDGE' | 'HOLD' }
//
// The `perspective` string gets injected into the answer prompt as
// <interviewer_perspective>. The `recommendedAction` is logged today and
// will be consumed by Phase 5's autopilot routing — populated and visible
// now so the data is there when Phase 5 lands.
//
// Design notes:
//   - Hard 250ms timeout via Promise.race. Cost of "less-targeted answer
//     because perspective skipped" beats cost of "two-second pause after
//     the user pressed the trigger". Returns null on timeout; caller
//     proceeds without the block.
//   - Skip entirely when the model has no meaningful content yet
//     (modelVersion === 0). Asking "what would impress this interviewer"
//     with an all-unknown profile is a waste of tokens.
//   - Format drift tolerance: if JSON parse fails, treat the whole text
//     as the perspective and default recommendedAction to ANSWER. This
//     means Gemini drifting back to plain-text doesn't break the
//     pipeline — it just loses the action signal.
//
// FOLLOW-UPS (tracked, not blocking):
//
//   1. AbortController. LLMHelper.streamChat does not yet accept one. On a
//      250ms timeout (or when a second trigger supersedes the first), the
//      underlying network call settles in the background and is discarded.
//      Cost-per-discarded-call is tiny on Flash Lite, but back-to-back
//      triggers on different questions can race, with the wrong perspective
//      potentially landing first. Threading AbortController through
//      streamChat's provider-specific paths is the right fix.
//
//   2. Decouple perspective from the user's default LLM. Today the
//      perspective call goes through LLMHelper.streamChat, which routes
//      to whichever model the user picked (often Pro on premium tiers).
//      Perspective is a 2-3 sentence inference task — Flash Lite is the
//      right tool. When the user's default is rate-limited (which we've
//      observed empirically — Pro 429s, Flash 503s same hour), perspective
//      goes down with it instead of failing over to a faster cheaper
//      provider. Pin perspective to Flash Lite directly, or build a tiny
//      "fastest-available" picker that prefers Flash > Flash Lite > Groq
//      regardless of user setting. Higher priority than initially scoped.

import { LLMHelper } from '../LLMHelper';
import { InterviewerModel } from '../services/InterviewerModelBuilder';
import { INTERVIEWER_PERSPECTIVE_PROMPT } from './prompts';

export const PERSPECTIVE_TIMEOUT_MS = 250;

export type RecommendedAction = 'ANSWER' | 'ASK_BACK' | 'BRIDGE' | 'HOLD';
const VALID_ACTIONS: RecommendedAction[] = ['ANSWER', 'ASK_BACK', 'BRIDGE', 'HOLD'];

export interface PerspectiveResult {
    perspective: string;
    recommendedAction: RecommendedAction;
}

export class InterviewerPerspectiveLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate the perspective + recommended action. Returns null on
     * timeout, on missing model content, or on any LLM failure (caller
     * proceeds without injection).
     */
    public async generate(
        model: InterviewerModel,
        question: string,
        modelVersion: number
    ): Promise<PerspectiveResult | null> {
        if (modelVersion === 0) return null;
        const trimmedQuestion = (question || '').trim();
        if (!trimmedQuestion) return null;

        const modelJson = JSON.stringify(model, null, 2);
        const systemPrompt = INTERVIEWER_PERSPECTIVE_PROMPT
            .replace('{model_json}', modelJson)
            .replace('{question}', trimmedQuestion);

        const collect = async (): Promise<string> => {
            let out = '';
            try {
                for await (const tok of this.llmHelper.streamChat(
                    'Generate the briefing now.',
                    undefined,
                    undefined,
                    systemPrompt,
                    true
                )) {
                    out += tok;
                    // Hard ceiling. The output should be a small JSON object;
                    // if the model goes pathological, cut it off. The timeout
                    // would catch us anyway but this keeps memory bounded.
                    if (out.length > 1500) break;
                }
            } catch (e: any) {
                console.warn('[InterviewerPerspectiveLLM] streamChat failed:', e?.message ?? e);
                return '';
            }
            return out.trim();
        };

        const startedAt = Date.now();
        const result = await raceWithTimeout(collect(), PERSPECTIVE_TIMEOUT_MS);
        const elapsed = Date.now() - startedAt;

        if (result === TIMEOUT_SENTINEL) {
            console.log(
                `[InterviewerPerspectiveLLM] Timed out after ${elapsed}ms (cap=${PERSPECTIVE_TIMEOUT_MS}ms) — proceeding without perspective`
            );
            return null;
        }

        const text = result;
        if (!text || text.length < 10) return null;

        const parsed = parsePerspectiveJson(text);
        if (!parsed || parsed.perspective.length < 10) return null;

        console.log(
            `[InterviewerPerspectiveLLM] Generated in ${elapsed}ms — action=${parsed.recommendedAction}, ${parsed.perspective.length} chars`
        );
        return parsed;
    }
}

/**
 * Parse the perspective LLM's JSON output. Format-drift tolerant: strips
 * ```json fences, handles extra surrounding text, and if JSON.parse fails
 * outright, falls back to treating the whole response as the perspective
 * with recommendedAction defaulting to ANSWER.
 *
 * Exported so unit tests can exercise the format-drift cases directly.
 */
export function parsePerspectiveJson(raw: string): PerspectiveResult | null {
    if (!raw) return null;
    let body = raw.trim();
    const fenced = body.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenced) body = fenced[1].trim();

    // Try to locate a JSON object even if there's surrounding prose
    // (Gemini sometimes prepends "Here's the briefing:"). Greedy match
    // up to the last `}` so a nested object inside `perspective` doesn't
    // truncate the parse.
    const objMatch = body.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            const parsed = JSON.parse(objMatch[0]);
            const perspective = typeof parsed.perspective === 'string' ? parsed.perspective.trim() : '';
            const rawAction = typeof parsed.recommendedAction === 'string'
                ? parsed.recommendedAction.toUpperCase().trim()
                : 'ANSWER';
            const recommendedAction = (VALID_ACTIONS as string[]).includes(rawAction)
                ? rawAction as RecommendedAction
                : 'ANSWER';
            if (perspective) return { perspective, recommendedAction };
        } catch {
            // Fall through to plain-text fallback.
        }
    }

    // Plain-text fallback. Format drifted, but the model still gave us
    // usable prose — treat it as the perspective and default the action.
    return { perspective: body, recommendedAction: 'ANSWER' };
}

/**
 * 30s-TTL keyed cache for perspective results. Pulled out of
 * IntelligenceEngine so the eviction logic can be unit-tested in
 * isolation. Eviction is pass-based: every set() drops any entries
 * that have expired by the call time. Cache size is bounded by
 * unique-questions-per-session, which is small in practice.
 */
export class PerspectiveCache {
    private store: Map<string, { value: PerspectiveResult; expiresAt: number }> = new Map();
    private ttlMs: number;

    constructor(ttlMs: number = 30_000) {
        this.ttlMs = ttlMs;
    }

    public get(key: string, now: number = Date.now()): PerspectiveResult | null {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= now) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    public set(key: string, value: PerspectiveResult, now: number = Date.now()): void {
        this.store.set(key, { value, expiresAt: now + this.ttlMs });
        // Pass-evict expired entries. Iterating a Map while deleting is
        // stable in JS — the iterator records the live entry list.
        for (const [k, v] of this.store) {
            if (v.expiresAt <= now) this.store.delete(k);
        }
    }

    public clear(): void {
        this.store.clear();
    }

    public size(): number {
        return this.store.size;
    }
}

const TIMEOUT_SENTINEL = Symbol('PERSPECTIVE_TIMEOUT');

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT_SENTINEL> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
    });
    return Promise.race<T | typeof TIMEOUT_SENTINEL>([
        p.then((v) => {
            if (timer) clearTimeout(timer);
            return v;
        }),
        timeoutPromise,
    ]);
}
