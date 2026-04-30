// InterviewerModelBuilder.ts
//
// Maintains a structured profile of the interviewer over the course of a
// session. The profile is updated off-hot-path on a debounced "substantive
// content" threshold rather than on every turn, so the cost stays bounded
// even on long interviews (typically 3-8 model updates per session).
//
// The on-hot-path consumer is InterviewerPerspectiveLLM, which takes the
// current profile + the latest question and asks "what does this interviewer
// actually want to hear?" That's the call the answer LLM benefits from.
//
// Lifetime: per-session. Owned by IntelligenceEngine, reset on engine reset.

import { LLMHelper } from '../LLMHelper';
import { INTERVIEWER_MODEL_UPDATE_PROMPT } from '../llm/prompts';

export interface InterviewerModel {
    inferredRole: string;
    inferredSeniority: string;
    technicalDepth: 'low' | 'medium' | 'high' | 'unknown';
    communicationStyle: string;
    concernsRevealed: string[];
    painPointsRevealed: string[];
    signalsAboutCandidate: string[];
    whatTheyAreLookingFor: string;
}

const EMPTY_MODEL: InterviewerModel = {
    inferredRole: 'unknown',
    inferredSeniority: 'unknown',
    technicalDepth: 'unknown',
    communicationStyle: 'unknown',
    concernsRevealed: [],
    painPointsRevealed: [],
    signalsAboutCandidate: [],
    whatTheyAreLookingFor: 'unknown',
};

// Substantive-word filter — same vocabulary used by transcriptCleaner so the
// two views of "meaningful speech" stay aligned. Acknowledgements and pure
// fillers don't count toward the update threshold.
const FILLER_WORDS = new Set([
    'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm',
    'like', 'you', 'know', 'i', 'mean', 'basically', 'actually',
    'so', 'well', 'anyway', 'anyways',
]);
const ACKNOWLEDGEMENTS = new Set([
    'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got', 'it',
    'gotcha', 'uh-huh', 'mm-hmm', 'mhm', 'cool', 'great',
    'nice', 'perfect', 'alright',
]);

const SUBSTANTIVE_THRESHOLD_WORDS = 150;
const UPDATE_DEBOUNCE_MS = 60_000;

/**
 * Count words in text that aren't fillers or acknowledgements. Pure
 * function, exported for unit tests.
 *
 * Notes on edge cases:
 *  - Contractions ("don't") are normalised to one token by replacing the
 *    apostrophe with a space then dropping the trailing single letter
 *    via the length filter. Net: counts as 1 substantive word.
 *  - Single letters (length < 2) are filtered to swallow the dangling
 *    "t" from contractions and one-letter STT artifacts.
 *  - Punctuation chars are replaced with whitespace, not stripped, so
 *    "wait,what" parses as two tokens.
 */
export function countSubstantiveWords(text: string): number {
    const tokens = (text || '')
        .toLowerCase()
        .replace(/[.,!?;:'"()\[\]{}]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    let count = 0;
    for (const t of tokens) {
        if (FILLER_WORDS.has(t)) continue;
        if (ACKNOWLEDGEMENTS.has(t)) continue;
        if (t.length < 2) continue;
        count++;
    }
    return count;
}

/**
 * Parse the interviewer-model JSON returned by the update LLM. Defensive:
 *  - Strips ```json fences if the model emits them.
 *  - Coerces missing/wrong-typed fields to safe defaults so a partial
 *    response doesn't blank out a previously-good model.
 *  - Logs the raw response when JSON.parse fails so format drift is
 *    visible in the dev console (Gemini occasionally changes its
 *    output shape; we want to see when that happens).
 *
 * Pure function, exported for unit tests.
 */
export function parseModelJson(raw: string): InterviewerModel | null {
    if (!raw) return null;
    let body = raw.trim();
    const fenced = body.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenced) body = fenced[1].trim();

    let parsed: any;
    try {
        parsed = JSON.parse(body);
    } catch (e: any) {
        console.warn(
            '[InterviewerModelBuilder] parseModelJson: JSON.parse failed:',
            e?.message ?? e,
            '\n  raw response (first 500 chars):',
            body.slice(0, 500)
        );
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const depth = String(parsed.technicalDepth ?? 'unknown').toLowerCase();
    const safeDepth: InterviewerModel['technicalDepth'] =
        depth === 'low' || depth === 'medium' || depth === 'high'
            ? depth
            : 'unknown';

    return {
        inferredRole: typeof parsed.inferredRole === 'string' ? parsed.inferredRole : 'unknown',
        inferredSeniority: typeof parsed.inferredSeniority === 'string' ? parsed.inferredSeniority : 'unknown',
        technicalDepth: safeDepth,
        communicationStyle: typeof parsed.communicationStyle === 'string' ? parsed.communicationStyle : 'unknown',
        concernsRevealed: Array.isArray(parsed.concernsRevealed)
            ? parsed.concernsRevealed.filter((s: any) => typeof s === 'string').slice(0, 12)
            : [],
        painPointsRevealed: Array.isArray(parsed.painPointsRevealed)
            ? parsed.painPointsRevealed.filter((s: any) => typeof s === 'string').slice(0, 12)
            : [],
        signalsAboutCandidate: Array.isArray(parsed.signalsAboutCandidate)
            ? parsed.signalsAboutCandidate.filter((s: any) => typeof s === 'string').slice(0, 12)
            : [],
        whatTheyAreLookingFor: typeof parsed.whatTheyAreLookingFor === 'string'
            ? parsed.whatTheyAreLookingFor
            : 'unknown',
    };
}

export class InterviewerModelBuilder {
    private llmHelper: LLMHelper;
    private model: InterviewerModel = { ...EMPTY_MODEL };

    // Bumped on every successful update. Used as part of the perspective-cache
    // key so cached perspectives invalidate the moment the model changes.
    private modelVersion = 0;

    // Buffered turns since the last update — joined into the prompt context.
    private pendingTurns: string[] = [];
    // Substantive-word count across pendingTurns. Cheap incremental counter
    // so we can decide when to schedule an update without re-tokenising.
    private pendingSubstantiveWords = 0;

    private lastUpdateAt = 0;
    private updateInFlight = false;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Feed a final interviewer transcript turn. Cheap path: trims, counts
     * substantive words, decides whether to fire an update. The update runs
     * async; this method returns immediately.
     */
    public feedTurn(text: string): void {
        const trimmed = (text || '').trim();
        if (!trimmed) return;

        const substantiveCount = countSubstantiveWords(trimmed);
        // Cheap floor: ignore turns under 5 substantive words. They're almost
        // always acknowledgements / one-word answers / "yeah, makes sense".
        if (substantiveCount < 5) return;

        this.pendingTurns.push(trimmed);
        this.pendingSubstantiveWords += substantiveCount;

        if (this.shouldScheduleUpdate()) {
            // Fire-and-forget on the hot path. runUpdate has its own
            // try/catch around the LLM call, but we attach a defensive
            // .catch() here too so any synchronous throw inside runUpdate
            // (e.g. before the try block establishes) becomes a logged
            // warning rather than an unhandled rejection.
            void this.runUpdate().catch(e => {
                console.warn(
                    '[InterviewerModelBuilder] runUpdate threw outside its catch (unexpected):',
                    e?.message ?? e
                );
            });
        }
    }

    public getModel(): InterviewerModel {
        return this.model;
    }

    public getVersion(): number {
        return this.modelVersion;
    }

    public reset(): void {
        this.model = { ...EMPTY_MODEL };
        this.modelVersion = 0;
        this.pendingTurns = [];
        this.pendingSubstantiveWords = 0;
        this.lastUpdateAt = 0;
        this.updateInFlight = false;
    }

    /**
     * Returns true if the model has any non-default content. Used by the
     * perspective pass to decide whether to skip the LLM call entirely on
     * fresh sessions where the model is still all "unknown".
     */
    public hasMeaningfulModel(): boolean {
        return this.modelVersion > 0;
    }

    private shouldScheduleUpdate(): boolean {
        if (this.updateInFlight) return false;
        if (this.pendingSubstantiveWords < SUBSTANTIVE_THRESHOLD_WORDS) return false;
        // Debounce: only one update per UPDATE_DEBOUNCE_MS window. Buffer
        // continues to accumulate during the debounce; the next update picks
        // up everything since the last one ran.
        if (Date.now() - this.lastUpdateAt < UPDATE_DEBOUNCE_MS) return false;
        return true;
    }

    private async runUpdate(): Promise<void> {
        if (this.updateInFlight) return;
        this.updateInFlight = true;
        // Snapshot what we're about to summarise so concurrent feeds don't
        // mutate underfoot. If the LLM call fails we'll re-attempt on the
        // next threshold crossing — no need to merge the snapshot back in.
        const turnsSnapshot = this.pendingTurns.slice();
        this.pendingTurns = [];
        this.pendingSubstantiveWords = 0;

        try {
            const updated = await this.callLLM(turnsSnapshot);
            if (updated) {
                this.model = updated;
                this.modelVersion++;
                this.lastUpdateAt = Date.now();
                console.log(
                    `[InterviewerModelBuilder] Model updated to v${this.modelVersion} ` +
                    `(role="${updated.inferredRole}", depth=${updated.technicalDepth})`
                );
            }
        } catch (e: any) {
            console.warn('[InterviewerModelBuilder] Update failed (non-fatal):', e?.message ?? e);
        } finally {
            this.updateInFlight = false;
        }
    }

    private async callLLM(turns: string[]): Promise<InterviewerModel | null> {
        const priorJson = JSON.stringify(this.model, null, 2);
        const newTurnsBlock = turns.map((t, i) => `Turn ${i + 1}: ${t}`).join('\n\n');

        const message = [
            'PRIOR PROFILE:',
            priorJson,
            '',
            'NEW TURNS:',
            newTurnsBlock,
        ].join('\n');

        // Use streamChat (the existing pattern) and collect tokens. Pass
        // ignoreKnowledgeMode=true so KnowledgeOrchestrator doesn't intercept
        // — this is a meta call, not a candidate question.
        let raw = '';
        try {
            for await (const tok of this.llmHelper.streamChat(
                message,
                undefined,
                undefined,
                INTERVIEWER_MODEL_UPDATE_PROMPT,
                true
            )) {
                raw += tok;
            }
        } catch (e: any) {
            console.warn('[InterviewerModelBuilder] streamChat failed:', e?.message ?? e);
            return null;
        }

        return parseModelJson(raw);
    }
}
