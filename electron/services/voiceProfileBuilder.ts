// voiceProfileBuilder.ts
//
// Pure functions that turn a corpus of the candidate's own transcript segments
// into a CandidateVoiceProfile JSON. No I/O, no Electron dependency — tested in
// isolation. The CLI script (scripts/voice-profile/build.js) provides the I/O
// layer; the runtime service (CandidateVoiceProfile.ts) consumes the output.
//
// Privacy note: this module also implements the redaction pass that runs
// before excerpts are persisted. Verbatim chunks are kept (few-shot needs
// real speech), but PII patterns and unknown company names are scrubbed.

export const VOICE_PROFILE_VERSION = 1;

export interface VoiceProfile {
    version: typeof VOICE_PROFILE_VERSION;
    builtAt: string;            // ISO timestamp
    sampleCount: number;        // number of meetings the profile is built from
    excerpts: string[];         // 2-3 verbatim chunks of 30-60 words, redacted
    avgSentenceLength: number;  // mean words per sentence across the corpus
    topFillers: string[];       // up to 5, highest-frequency first
    commonOpeners: string[];    // up to 5, highest-frequency first
    bannedPhrases: string[];    // user-tunable static list, defaults shipped
}

export interface CorpusSegment {
    text: string;
    timestamp: number;
}

export interface BuildOptions {
    /**
     * Allow-list of company / project names that should NOT be scrubbed from
     * excerpts. Anything Title-Case that isn't on this list and looks like a
     * proper noun gets replaced with `[REDACTED-COMPANY]`.
     */
    companyAllowList?: string[];
    /** Maximum excerpts to include in the profile. Defaults to 3. */
    maxExcerpts?: number;
    /** Min words per excerpt. Defaults to 30. */
    minExcerptWords?: number;
    /** Max words per excerpt. Defaults to 60. */
    maxExcerptWords?: number;
}

export const DEFAULT_BANNED_PHRASES = [
    'leverage',
    'robust',
    'ensure',
    'first-class citizen',
    'choke point',
    'I\'d be curious',
    'given that',
    'that makes perfect sense',
    'stakeholders',
    'ecosystem',
    'synergies',
    'delve into',
    'deep dive',
    'circle back',
];

// Filler tokens we count for `topFillers`. Standalone occurrences only — we
// don't count "like" inside "I'd like to" etc. The list intentionally includes
// what cleaner.ts already strips from interviewer transcripts; here we want to
// know which of these the candidate ACTUALLY uses, since they're voice tells.
const FILLER_CANDIDATES = [
    'like', 'you know', 'i mean', 'kinda', 'sort of', 'kind of',
    'right', 'i guess', 'basically', 'actually', 'honestly',
    'i think', 'i would say', 'so basically', 'pretty much',
];

// PII patterns scrubbed from excerpts. Order matters — broader patterns last.
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
    // SSN: NNN-NN-NNNN
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED-SSN]' },
    // Credit-card-shaped 13-19 digit runs (loose; we'd rather over-redact)
    { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[REDACTED-CC]' },
    // Email
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED-EMAIL]' },
    // Phone — US-shaped, generous
    { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[REDACTED-PHONE]' },
];

/**
 * Build a VoiceProfile from a corpus of user-channel transcript segments.
 * Returns null if the corpus is too small to produce meaningful patterns
 * (fewer than 20 segments or 200 words total).
 */
export function buildVoiceProfile(
    segments: CorpusSegment[],
    sampleCount: number,
    opts: BuildOptions = {}
): VoiceProfile | null {
    const cleaned = segments
        .map(s => ({ ...s, text: s.text.trim() }))
        .filter(s => s.text.length > 0);

    if (cleaned.length < 20) return null;

    const totalWords = cleaned.reduce((sum, s) => sum + countWords(s.text), 0);
    if (totalWords < 200) return null;

    const avgSentenceLength = computeAvgSentenceLength(cleaned);
    const topFillers = computeTopFillers(cleaned, 5);
    const commonOpeners = computeCommonOpeners(cleaned, 5);
    const excerpts = pickExcerpts(cleaned, opts);

    const allowList = opts.companyAllowList ?? [];
    const redactedExcerpts = excerpts.map(e => redactExcerpt(e, allowList));

    return {
        version: VOICE_PROFILE_VERSION,
        builtAt: new Date().toISOString(),
        sampleCount,
        excerpts: redactedExcerpts,
        avgSentenceLength,
        topFillers,
        commonOpeners,
        bannedPhrases: [...DEFAULT_BANNED_PHRASES],
    };
}

/**
 * Apply PII + company-name redaction to a single string. Exposed so the same
 * pass can be applied at inspection time (and unit-tested directly).
 *
 * Strategy:
 *   1. Scrub structured PII (SSN, CC, email, phone) via regex.
 *   2. Replace any Title-Case proper-noun-shaped span that isn't on the
 *      allow-list with `[REDACTED-COMPANY]`. Permissive on purpose — false
 *      positives just remove specificity from the few-shot example, which is
 *      acceptable; false negatives leak PII to LLM providers.
 */
export function redactExcerpt(text: string, companyAllowList: string[]): string {
    let out = text;

    for (const { pattern, replacement } of PII_PATTERNS) {
        out = out.replace(pattern, replacement);
    }

    // Split on existing [REDACTED-*] markers (both ones we just inserted from
    // the PII pass and any that were already in the input). The proper-noun
    // pass below would otherwise match the all-caps token names ("REDACTED",
    // "PHONE", etc.) and rewrite the markers into nested garbage like
    // "[[REDACTED-COMPANY]-[REDACTED-COMPANY]]".
    const markerPattern = /(\[REDACTED-[A-Z]+\])/g;
    const parts = out.split(markerPattern);

    // Title-Case proper-noun runs (same shape as SessionTracker's anchor pattern)
    const properNounPattern = /\b(?:[A-Z][A-Za-z0-9]+(?:[-/&]?\s+[A-Z][A-Za-z0-9]+){0,3}|[A-Z][a-z]+[A-Z][A-Za-z0-9]+|[A-Z]{2,}[A-Za-z0-9]*)\b/g;
    const allowSet = new Set(companyAllowList.map(s => s.toLowerCase()));
    // Common stop tokens that the proper-noun pattern catches but aren't PII.
    // Sentence-starting auxiliaries / pronouns / acknowledgements are the
    // primary false-positive class — they're capitalised at sentence start
    // and the regex doesn't know they aren't proper nouns. Without these
    // entries, excerpts come out riddled with [REDACTED-COMPANY] placeholders
    // hiding ordinary words like "Are", "But", "Then" — which strips the
    // few-shot examples of concrete signal without protecting any PII.
    const stopList = new Set([
        // Articles + possessive determiners
        'I', 'A', 'An', 'The', 'My', 'Our', 'Their', 'His', 'Her', 'Its', 'Your',
        // Modal / auxiliary verbs (sentence-starting "Are you...", "Have you...", etc.)
        'Are', 'Is', 'Was', 'Were', 'Do', 'Does', 'Did', 'Have', 'Has', 'Had',
        'Will', 'Would', 'Should', 'Could', 'Can', 'Might', 'May', 'Must', 'Shall',
        // Common conjunctions / discourse markers at sentence start
        'But', 'And', 'So', 'Or', 'Then', 'Now', 'Sure', 'Well', 'Look', 'Listen',
        'Honestly', 'Actually', 'Basically', 'Literally', 'Really', 'Maybe', 'Perhaps',
        // Acknowledgements (capitalised at sentence start)
        'Yes', 'No', 'Yeah', 'OK', 'Okay', 'Right', 'Cool', 'Great', 'Nice',
        // Pronouns at sentence start
        'He', 'She', 'They', 'We', 'You', 'It', 'This', 'That', 'These', 'Those',
        'There', 'Here', 'What', 'When', 'Where', 'Why', 'How', 'Which', 'Who',
        // Days + months — calendar mentions are rarely proper-noun-redact-worthy
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        'January', 'February', 'March', 'April', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
        // 'May' is intentionally listed once via the modal-verb section above
        // so the de-duplication is explicit.
    ]);

    // String.split with a capturing group puts the captured matches at odd
    // indices; even indices are the text between markers. Apply proper-noun
    // redaction only to the even (non-marker) slices so markers pass through
    // untouched.
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 !== 0) continue;
        parts[i] = parts[i].replace(properNounPattern, (match) => {
            const trimmed = match.trim();

            // Whole-match allow entries like "Independence Blue Cross"
            // take priority — preserve the full multi-word span as-is.
            if (allowSet.has(trimmed.toLowerCase())) return match;

            // Single-token match: simple stopList check, else redact.
            if (!/\s/.test(trimmed)) {
                if (stopList.has(trimmed)) return match;
                return '[REDACTED-COMPANY]';
            }

            // Multi-word match: the regex greedily glues a leading stop word
            // (e.g. "At" → "At NxtHumans") onto a real proper noun. Decide
            // per-token so allow-listed sub-spans survive but unlisted ones
            // get redacted independently. Separator-preserving split keeps
            // the original spacing intact.
            const tokens = trimmed.split(/(\s+)/);
            return tokens.map((tok, idx) => {
                if (idx % 2 !== 0) return tok; // separator
                if (stopList.has(tok)) return tok;
                if (allowSet.has(tok.toLowerCase())) return tok;
                return '[REDACTED-COMPANY]';
            }).join('');
        });
    }

    return parts.join('');
}

function countWords(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
}

function computeAvgSentenceLength(segments: CorpusSegment[]): number {
    let totalSentences = 0;
    let totalWords = 0;
    for (const s of segments) {
        const sentences = s.text.split(/[.!?]+/).map(t => t.trim()).filter(Boolean);
        totalSentences += sentences.length;
        for (const sent of sentences) totalWords += countWords(sent);
    }
    if (totalSentences === 0) return 0;
    return Math.round((totalWords / totalSentences) * 10) / 10;
}

function computeTopFillers(segments: CorpusSegment[], top: number): string[] {
    const counts = new Map<string, number>();
    for (const filler of FILLER_CANDIDATES) {
        const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}\\b`, 'gi');
        let total = 0;
        for (const s of segments) {
            const matches = s.text.match(re);
            if (matches) total += matches.length;
        }
        if (total > 0) counts.set(filler, total);
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([word]) => word);
}

function computeCommonOpeners(segments: CorpusSegment[], top: number): string[] {
    const counts = new Map<string, number>();
    for (const s of segments) {
        const opener = extractOpener(s.text);
        if (!opener) continue;
        // Normalise: lowercase, strip trailing punctuation
        const key = opener.toLowerCase().replace(/[.,!?;:]+$/, '').trim();
        if (key.length < 2 || key.length > 40) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .filter(([, n]) => n >= 2) // require at least 2 occurrences for "common"
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([phrase]) => phrase);
}

function extractOpener(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return '';
    // First 3 words, or up to first comma/period — whichever is shorter.
    const punctIdx = trimmed.search(/[,.!?]/);
    const upTo = punctIdx > 0 ? trimmed.slice(0, punctIdx) : trimmed;
    const words = upTo.split(/\s+/).slice(0, 3).join(' ');
    return words;
}

function pickExcerpts(segments: CorpusSegment[], opts: BuildOptions): string[] {
    const minWords = opts.minExcerptWords ?? 30;
    const maxWords = opts.maxExcerptWords ?? 60;
    const max = opts.maxExcerpts ?? 3;

    // Score: prefer segments whose word count sits inside [min, max]. Among
    // those, prefer the ones closest to the corpus average sentence length
    // (representative samples beat outliers). Stable: we hash text length
    // for tie-breaks so the script is deterministic across runs.
    const candidates = segments
        .map(s => ({ ...s, words: countWords(s.text) }))
        .filter(s => s.words >= minWords && s.words <= maxWords);

    if (candidates.length === 0) return [];

    // Spread picks across the corpus timeline (not all from one meeting): sort
    // by timestamp, then bucket into `max` equal slices and pick the median of
    // each.
    candidates.sort((a, b) => a.timestamp - b.timestamp);
    const sliceSize = Math.floor(candidates.length / max) || 1;
    const picks: string[] = [];
    for (let i = 0; i < max && picks.length < max; i++) {
        const idx = Math.min(i * sliceSize + Math.floor(sliceSize / 2), candidates.length - 1);
        if (idx >= 0 && idx < candidates.length) picks.push(candidates[idx].text);
    }

    return picks;
}
