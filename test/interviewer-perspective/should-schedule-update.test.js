// Unit tests for shouldScheduleUpdate — the threshold-decision function
// that determines when the model-update LLM call fires.
//
// This is load-bearing for cold-start behaviour: the asymmetric threshold
// (FIRST_UPDATE=50 / SUBSEQUENT=150) is what makes the perspective layer
// activate inside the first minute of an interview rather than 5+ minutes
// in. A regression where both thresholds collapse to the same value would
// silently break that improvement; these tests pin the dispatch logic.
//
// Run: npm run test:interviewer-perspective

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const builderPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'InterviewerModelBuilder.js');
let shouldScheduleUpdate, DEFAULT_FIRST_UPDATE_THRESHOLD_WORDS, DEFAULT_SUBSEQUENT_UPDATE_THRESHOLD_WORDS, DEFAULT_UPDATE_DEBOUNCE_MS;
try {
    ({
        shouldScheduleUpdate,
        DEFAULT_FIRST_UPDATE_THRESHOLD_WORDS,
        DEFAULT_SUBSEQUENT_UPDATE_THRESHOLD_WORDS,
        DEFAULT_UPDATE_DEBOUNCE_MS,
    } = require(builderPath));
} catch (e) {
    test('should-schedule-update tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load builder from ${builderPath}: ${e.message}`);
    });
    return;
}

// Test fixture: deterministic args by passing thresholds explicitly so the
// tests aren't sensitive to env-var pollution between processes.
function args(overrides = {}) {
    return {
        updateInFlight: false,
        pendingSubstantiveWords: 0,
        modelVersion: 0,
        lastUpdateAt: 0,
        now: 1_000_000,
        firstThreshold: 50,
        subsequentThreshold: 150,
        debounceMs: 60_000,
        ...overrides,
    };
}

// ── Default constant sanity ──────────────────────────────────────

test('exports asymmetric default thresholds (first < subsequent)', () => {
    assert.equal(DEFAULT_FIRST_UPDATE_THRESHOLD_WORDS, 50);
    assert.equal(DEFAULT_SUBSEQUENT_UPDATE_THRESHOLD_WORDS, 150);
    assert.ok(
        DEFAULT_FIRST_UPDATE_THRESHOLD_WORDS < DEFAULT_SUBSEQUENT_UPDATE_THRESHOLD_WORDS,
        'first-update threshold must be lower than subsequent — that is the whole point of the asymmetric design',
    );
    assert.equal(DEFAULT_UPDATE_DEBOUNCE_MS, 60_000);
});

// ── First-update path (modelVersion === 0) ───────────────────────

test('first update fires at exactly the first-update threshold', () => {
    assert.equal(shouldScheduleUpdate(args({ pendingSubstantiveWords: 50 })), true);
});

test('first update fires above the first-update threshold', () => {
    assert.equal(shouldScheduleUpdate(args({ pendingSubstantiveWords: 51 })), true);
    assert.equal(shouldScheduleUpdate(args({ pendingSubstantiveWords: 100 })), true);
});

test('first update does NOT fire below the first-update threshold', () => {
    assert.equal(shouldScheduleUpdate(args({ pendingSubstantiveWords: 49 })), false);
    assert.equal(shouldScheduleUpdate(args({ pendingSubstantiveWords: 0 })), false);
});

test('first update is NOT gated by the debounce window', () => {
    // lastUpdateAt === 0 means "never updated" — debounce should be skipped
    // entirely, otherwise warm-up never fires until 60s after process start.
    assert.equal(
        shouldScheduleUpdate(args({
            pendingSubstantiveWords: 50,
            lastUpdateAt: 0,
            now: 100,  // tiny "now" — would fail any real debounce check
        })),
        true,
    );
});

// ── Subsequent-update path (modelVersion >= 1) ───────────────────

test('subsequent updates require the SUBSEQUENT threshold (50 is not enough)', () => {
    // This is the regression test: if both thresholds collapse to 50,
    // this case fires when it shouldn't, and we burn an LLM call on
    // incremental signal.
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 50,
            lastUpdateAt: 1,           // any non-zero value
            now: 1 + 60_001,           // past debounce
        })),
        false,
        'modelVersion>=1 must require >= subsequentThreshold (150), not the first-update threshold (50)',
    );
});

test('subsequent updates fire at exactly the subsequent threshold', () => {
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 2,
            pendingSubstantiveWords: 150,
            lastUpdateAt: 1,
            now: 1 + 60_001,
        })),
        true,
    );
});

test('subsequent updates fire above the subsequent threshold', () => {
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 5,
            pendingSubstantiveWords: 200,
            lastUpdateAt: 1,
            now: 1 + 60_001,
        })),
        true,
    );
});

test('subsequent updates do NOT fire below the subsequent threshold', () => {
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 100,
            lastUpdateAt: 1,
            now: 1 + 60_001,
        })),
        false,
    );
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 149,
            lastUpdateAt: 1,
            now: 1 + 60_001,
        })),
        false,
    );
});

// ── Debounce gating (only applies after first update) ────────────

test('subsequent update inside debounce window does NOT fire', () => {
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 200,        // well over threshold
            lastUpdateAt: 1_000_000,
            now: 1_000_000 + 30_000,             // 30s — inside 60s window
        })),
        false,
    );
});

test('subsequent update at exactly the debounce boundary does NOT fire', () => {
    // strict <: now - lastUpdateAt < debounceMs blocks; equal passes.
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 200,
            lastUpdateAt: 1_000_000,
            now: 1_000_000 + 60_000,             // exactly 60s
        })),
        true,
        'at exactly debounceMs the update should fire — the gate is strictly less-than',
    );
});

test('subsequent update past the debounce window fires', () => {
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 200,
            lastUpdateAt: 1_000_000,
            now: 1_000_000 + 60_001,
        })),
        true,
    );
});

// ── In-flight gating ─────────────────────────────────────────────

test('updateInFlight blocks all updates regardless of threshold or debounce', () => {
    assert.equal(
        shouldScheduleUpdate(args({
            updateInFlight: true,
            pendingSubstantiveWords: 9999,
            modelVersion: 0,
            lastUpdateAt: 0,
        })),
        false,
    );
    assert.equal(
        shouldScheduleUpdate(args({
            updateInFlight: true,
            pendingSubstantiveWords: 9999,
            modelVersion: 5,
            lastUpdateAt: 1,
            now: 9_999_999,
        })),
        false,
    );
});

// ── Custom-threshold injection (env-flag override path) ──────────

test('custom thresholds via args override defaults', () => {
    // Mirror what NATIVELY_PHASE3_FIRST_THRESHOLD=20 would do at runtime.
    assert.equal(
        shouldScheduleUpdate(args({
            pendingSubstantiveWords: 20,
            firstThreshold: 20,
        })),
        true,
    );
    assert.equal(
        shouldScheduleUpdate(args({
            pendingSubstantiveWords: 19,
            firstThreshold: 20,
        })),
        false,
    );
});

test('custom debounceMs override is honoured', () => {
    // Mirror NATIVELY_PHASE3_DEBOUNCE_MS=10000 — tighter window for testing.
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 200,
            lastUpdateAt: 1_000_000,
            now: 1_000_000 + 10_001,
            debounceMs: 10_000,
        })),
        true,
    );
    assert.equal(
        shouldScheduleUpdate(args({
            modelVersion: 1,
            pendingSubstantiveWords: 200,
            lastUpdateAt: 1_000_000,
            now: 1_000_000 + 9_999,
            debounceMs: 10_000,
        })),
        false,
    );
});

// ── Cold-start regression test ───────────────────────────────────

test('REGRESSION: 50 substantive words crosses first-update but NOT subsequent', () => {
    // The whole point of the asymmetric design. If this test fails, both
    // thresholds collapsed to the same value and cold-start improvement is
    // gone (or steady-state cost-control is gone, depending on which way).
    const fresh = args({ modelVersion: 0, pendingSubstantiveWords: 50 });
    const warmed = args({
        modelVersion: 1,
        pendingSubstantiveWords: 50,
        lastUpdateAt: 1,
        now: 1 + 60_001,
    });
    assert.equal(shouldScheduleUpdate(fresh), true, 'fresh model with 50 substantive words MUST fire (warm-up)');
    assert.equal(shouldScheduleUpdate(warmed), false, 'warmed model with only 50 substantive words MUST NOT fire (steady-state cost control)');
});
