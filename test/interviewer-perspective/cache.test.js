// Unit tests for PerspectiveCache and perspectiveCacheKey — the bounded
// cache that fronts the perspective LLM call. Most-likely failure modes
// are TTL boundary, version invalidation, and eviction.
//
// Run: npm run test:interviewer-perspective

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const llmPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'llm', 'InterviewerPerspectiveLLM.js');
const enginePath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'IntelligenceEngine.js');
let PerspectiveCache, perspectiveCacheKey;
try {
    ({ PerspectiveCache } = require(llmPath));
    ({ perspectiveCacheKey } = require(enginePath));
} catch (e) {
    test('cache tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load cache modules: ${e.message}`);
    });
    return;
}

const SAMPLE = { perspective: 'sample text', recommendedAction: 'ANSWER' };

test('get returns null when key missing', () => {
    const c = new PerspectiveCache(30_000);
    assert.equal(c.get('missing'), null);
});

test('set + get round-trip within TTL', () => {
    const c = new PerspectiveCache(30_000);
    const now = 1000;
    c.set('k1', SAMPLE, now);
    assert.deepEqual(c.get('k1', now + 1000), SAMPLE);
    assert.deepEqual(c.get('k1', now + 29_999), SAMPLE);
});

test('TTL boundary: hit at TTL-1, miss at TTL', () => {
    const c = new PerspectiveCache(30_000);
    const now = 0;
    c.set('k', SAMPLE, now);
    // 29_999 ms after set → still alive (expiresAt = 30_000, check is > now)
    assert.deepEqual(c.get('k', now + 29_999), SAMPLE);
    // Exactly at expiry → expiresAt (30_000) is NOT > now (30_000), so miss
    assert.equal(c.get('k', now + 30_000), null);
    // Past expiry → miss
    assert.equal(c.get('k', now + 30_001), null);
});

test('expired entry is actively evicted on get, not just hidden', () => {
    const c = new PerspectiveCache(30_000);
    const now = 0;
    c.set('k', SAMPLE, now);
    assert.equal(c.size(), 1);
    // Reading at expiry should evict the entry
    c.get('k', now + 30_000);
    assert.equal(c.size(), 0);
});

test('set evicts expired siblings (pass-eviction)', () => {
    const c = new PerspectiveCache(30_000);
    c.set('old', SAMPLE, 0);
    c.set('older', SAMPLE, -10_000); // expiresAt = 20_000
    assert.equal(c.size(), 2);
    // Set at 31_000 → both old (expiresAt=30_000) and older (20_000) are expired.
    c.set('fresh', SAMPLE, 31_000);
    assert.equal(c.size(), 1);
    assert.equal(c.get('old', 31_000), null);
    assert.equal(c.get('older', 31_000), null);
    assert.deepEqual(c.get('fresh', 31_000), SAMPLE);
});

test('overwriting an existing key resets its TTL', () => {
    const c = new PerspectiveCache(30_000);
    c.set('k', SAMPLE, 0);
    c.set('k', { perspective: 'replaced', recommendedAction: 'BRIDGE' }, 25_000);
    // Original would have expired at 30_000. The replacement (set at 25_000)
    // should still be alive at 40_000 (expires at 55_000).
    const r = c.get('k', 40_000);
    assert.ok(r);
    assert.equal(r.perspective, 'replaced');
    assert.equal(r.recommendedAction, 'BRIDGE');
});

test('clear empties the store', () => {
    const c = new PerspectiveCache();
    c.set('a', SAMPLE);
    c.set('b', SAMPLE);
    assert.equal(c.size(), 2);
    c.clear();
    assert.equal(c.size(), 0);
});

test('different TTL is honoured', () => {
    const c = new PerspectiveCache(5_000);
    c.set('k', SAMPLE, 0);
    assert.deepEqual(c.get('k', 4_999), SAMPLE);
    assert.equal(c.get('k', 5_000), null);
});

// ── perspectiveCacheKey ─────────────────────────────────────────

test('cache key is deterministic for the same input', () => {
    const k1 = perspectiveCacheKey('Tell me about your last project', 5);
    const k2 = perspectiveCacheKey('Tell me about your last project', 5);
    assert.equal(k1, k2);
});

test('cache key changes when modelVersion changes', () => {
    const v1 = perspectiveCacheKey('Same question', 1);
    const v2 = perspectiveCacheKey('Same question', 2);
    assert.notEqual(v1, v2);
    // Confirm the version is the differentiator (suffix)
    assert.match(v1, /:v1$/);
    assert.match(v2, /:v2$/);
});

test('cache key changes when question text changes', () => {
    const k1 = perspectiveCacheKey('Question A', 1);
    const k2 = perspectiveCacheKey('Question B', 1);
    assert.notEqual(k1, k2);
});

test('version invalidation: same question + new version = cache miss', () => {
    // Composition of cache + key. This is the path that makes the model
    // version meaningful — a new model version should never serve cached
    // perspective from the old one.
    const c = new PerspectiveCache(30_000);
    const q = 'Tell me about a hard decision you made.';
    c.set(perspectiveCacheKey(q, 1), SAMPLE, 0);
    assert.deepEqual(c.get(perspectiveCacheKey(q, 1), 1000), SAMPLE);
    // Bump version → miss
    assert.equal(c.get(perspectiveCacheKey(q, 2), 1000), null);
});

test('cache key is bounded length even for huge questions', () => {
    const huge = 'x'.repeat(50_000);
    const k = perspectiveCacheKey(huge, 1);
    // sha1 truncated to 16 hex chars + ':v1' = 19 chars
    assert.equal(k.length, 19);
});
