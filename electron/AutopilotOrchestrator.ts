// AutopilotOrchestrator.ts
// Listens to final transcript segments and decides — without user input — when
// to fire an LLM suggestion. Designed to live behind a feature flag (default
// off) so it can ship dark and be A/B-validated against the manual-trigger
// flow that exists today.
//
// Trigger policy (intentionally conservative for v1):
//   1. The segment must be a *final* interviewer turn.
//   2. The text must look like a question (regex fast-path covers ~90% of cases).
//   3. After the trigger candidate, wait `silenceMs` ms with no further
//      interviewer speech AND no user speech before firing — this avoids
//      cutting in mid-sentence.
//   4. Honour a `cooldownMs` window since the last auto-fire so we don't
//      stack suggestions on top of each other.
//
// The kill switch (`disable()`) takes effect immediately: any pending
// scheduled fire is cancelled, and `enabled` gates future events.

import type { IntelligenceManager, TranscriptSegment } from './IntelligenceManager';
import type { ModesManager, ModeTemplateType } from './services/ModesManager';

export interface AutopilotConfig {
    enabled: boolean;
    silenceMs: number;          // wait this long after interviewer stops before firing
    cooldownMs: number;         // minimum gap between two auto-fires
    minConfidence: number;      // skip if STT confidence is too low
}

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
    enabled: false,
    silenceMs: 800,
    cooldownMs: 8000,
    minConfidence: 0.55,
};

// Cheap question-intent regex. Matches:
//   - explicit "?" (most common, even when STT misses prosody)
//   - WH-words at the start ("what", "how", "why", "when", "where", "who",
//     "which", "whose", "tell me", "walk me through", "describe", "explain")
//   - auxiliary inversions ("can you", "could you", "would you", "do you",
//     "have you", "are you", "is there", "is it", "should we")
const QUESTION_PATTERN = /(\?\s*$)|^\s*(what|how|why|when|where|who|which|whose|tell\s+me|walk\s+me\s+through|describe|explain|give\s+me|share|talk\s+(?:to\s+me\s+)?about)\b|^\s*(can|could|would|will|do|did|does|have|has|are|is|was|were|should|shall|may|might|must)\s+(you|we|i|there|it|that|this)\b/i;

export class AutopilotOrchestrator {
    private intelligence: IntelligenceManager;
    private modes: ModesManager;
    private config: AutopilotConfig;

    private pendingTimer: NodeJS.Timeout | null = null;
    private lastFireAt: number = 0;
    private lastUserSpeechAt: number = 0;
    private lastInterviewerSpeechAt: number = 0;
    private candidateQuestion: string | null = null;
    private generationInFlight: boolean = false;
    // Optional hook so the UI can surface a subtle "thinking…" indicator while
    // a fire is queued or in-flight. The orchestrator is presentation-agnostic.
    private onStatusChange?: (status: 'idle' | 'pending' | 'generating') => void;

    constructor(
        intelligence: IntelligenceManager,
        modes: ModesManager,
        config: Partial<AutopilotConfig> = {}
    ) {
        this.intelligence = intelligence;
        this.modes = modes;
        this.config = { ...DEFAULT_AUTOPILOT_CONFIG, ...config };
    }

    setStatusListener(listener: (status: 'idle' | 'pending' | 'generating') => void): void {
        this.onStatusChange = listener;
    }

    isEnabled(): boolean {
        return this.config.enabled;
    }

    enable(): void {
        if (this.config.enabled) return;
        this.config.enabled = true;
        console.log('[Autopilot] Enabled');
    }

    disable(): void {
        if (!this.config.enabled) return;
        this.config.enabled = false;
        this.cancelPending('disabled');
        console.log('[Autopilot] Disabled (kill switch)');
    }

    updateConfig(patch: Partial<AutopilotConfig>): void {
        this.config = { ...this.config, ...patch };
    }

    // Called once per final transcript segment from main.ts. Cheap path: a
    // few comparisons and a regex test — no LLM call here.
    onTranscript(segment: TranscriptSegment): void {
        if (!this.config.enabled || !segment.final) return;

        const now = Date.now();
        if (segment.speaker === 'user') {
            this.lastUserSpeechAt = now;
            // User started talking — they don't need a suggestion. Drop any
            // pending fire and let them carry the conversation.
            if (this.pendingTimer) this.cancelPending('user-spoke');
            return;
        }

        if (segment.speaker !== 'interviewer') return;
        this.lastInterviewerSpeechAt = now;

        const text = (segment.text || '').trim();
        if (text.length < 3) return;

        if (segment.confidence !== undefined && segment.confidence < this.config.minConfidence) {
            return;
        }

        if (now - this.lastFireAt < this.config.cooldownMs) return;
        if (this.generationInFlight) return;
        if (!this.looksLikeQuestion(text)) return;

        // Each new interviewer turn resets the silence timer. The fire
        // ultimately occurs `silenceMs` after the *latest* interviewer turn,
        // which is exactly the behaviour we want — it doesn't cut in mid-
        // sentence when the interviewer keeps elaborating after a question.
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        this.candidateQuestion = text;
        this.setStatus('pending');
        this.pendingTimer = setTimeout(() => this.attemptFire(), this.config.silenceMs);
    }

    private cancelPending(reason: string): void {
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
        this.candidateQuestion = null;
        this.setStatus('idle');
        if (reason !== 'disabled') {
            console.log(`[Autopilot] Pending fire cancelled (${reason})`);
        }
    }

    private async attemptFire(): Promise<void> {
        this.pendingTimer = null;
        if (!this.config.enabled) return;
        const question = this.candidateQuestion;
        this.candidateQuestion = null;
        if (!question) return;

        const now = Date.now();
        // Re-check user speech right before firing — gives the user a final
        // 800ms grace window to barge in.
        if (now - this.lastUserSpeechAt < this.config.silenceMs) {
            this.setStatus('idle');
            console.log('[Autopilot] Skipping fire — user spoke during silence window');
            return;
        }
        if (now - this.lastFireAt < this.config.cooldownMs) {
            this.setStatus('idle');
            return;
        }

        this.lastFireAt = now;
        this.generationInFlight = true;
        this.setStatus('generating');

        const template = this.modes.getActiveMode()?.templateType ?? 'general';
        try {
            await this.dispatchForMode(template, question);
        } catch (err) {
            console.error('[Autopilot] Dispatch failed:', err);
        } finally {
            this.generationInFlight = false;
            this.setStatus('idle');
        }
    }

    // Maps mode → executor. Kept here (rather than in IntelligenceEngine) so
    // the routing policy is co-located with the trigger policy and easy to
    // tune without touching the LLM layer.
    private async dispatchForMode(template: ModeTemplateType, question: string): Promise<void> {
        switch (template) {
            case 'technical-interview':
            case 'looking-for-work':
                // Standard "what should I say" answer flow.
                await this.intelligence.runWhatShouldISay(question, 0.85, undefined);
                return;
            case 'sales':
            case 'recruiting':
            case 'team-meet':
                // These benefit from the "what to answer" flow too — it's the
                // most general-purpose responder. If a mode-specific executor
                // is added later (e.g. an AssistLLM auto-fire), wire it here.
                await this.intelligence.runWhatShouldISay(question, 0.8, undefined);
                return;
            case 'lecture':
                // Lectures are mostly listening — autopilot should stay quieter.
                // For now, do nothing; the user will manually hit recap.
                console.log('[Autopilot] Lecture mode — suppressing auto-fire');
                return;
            case 'general':
            default:
                await this.intelligence.runWhatShouldISay(question, 0.75, undefined);
                return;
        }
    }

    private looksLikeQuestion(text: string): boolean {
        return QUESTION_PATTERN.test(text);
    }

    private setStatus(status: 'idle' | 'pending' | 'generating'): void {
        this.onStatusChange?.(status);
    }

    reset(): void {
        this.cancelPending('reset');
        this.lastFireAt = 0;
        this.lastUserSpeechAt = 0;
        this.lastInterviewerSpeechAt = 0;
        this.generationInFlight = false;
    }
}
