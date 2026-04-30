// Unit tests for parseModelJson — the defensive parser that turns the LLM's
// JSON output into a typed InterviewerModel. Format-drift cases are the main
// thing we care about: Gemini occasionally emits markdown fences, truncated
// output (especially under timeout), or additional fields.
//
// Run: npm run test:interviewer-perspective

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const builderPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'InterviewerModelBuilder.js');
let parseModelJson;
try {
    ({ parseModelJson } = require(builderPath));
} catch (e) {
    test('parse-model-json tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load builder from ${builderPath}: ${e.message}`);
    });
    return;
}

const VALID_JSON = JSON.stringify({
    inferredRole: 'VP of Engineering',
    inferredSeniority: 'VP',
    technicalDepth: 'medium',
    communicationStyle: 'patient, redirects when too technical',
    concernsRevealed: ['data security', 'jurisdictional compliance'],
    painPointsRevealed: ['HRIS not GDPR-compliant'],
    signalsAboutCandidate: ['asked candidate to slow down'],
    whatTheyAreLookingFor: 'Wants strategic thinking, not implementation detail.',
});

test('parses a clean JSON response', () => {
    const result = parseModelJson(VALID_JSON);
    assert.ok(result);
    assert.equal(result.inferredRole, 'VP of Engineering');
    assert.equal(result.technicalDepth, 'medium');
    assert.equal(result.concernsRevealed.length, 2);
});

test('strips ```json fences when the model emits them', () => {
    const wrapped = '```json\n' + VALID_JSON + '\n```';
    const result = parseModelJson(wrapped);
    assert.ok(result);
    assert.equal(result.inferredRole, 'VP of Engineering');
});

test('strips bare ``` fences', () => {
    const wrapped = '```\n' + VALID_JSON + '\n```';
    const result = parseModelJson(wrapped);
    assert.ok(result);
    assert.equal(result.inferredRole, 'VP of Engineering');
});

test('returns null on truncated JSON (timeout case)', () => {
    const truncated = '{"inferredRole": "VP", "concernsRevealed": ["data secu';
    const result = parseModelJson(truncated);
    assert.equal(result, null);
});

test('returns null on completely malformed input', () => {
    assert.equal(parseModelJson('not json at all'), null);
    assert.equal(parseModelJson('{this is broken'), null);
});

test('returns null on empty input', () => {
    assert.equal(parseModelJson(''), null);
    assert.equal(parseModelJson(null), null);
    assert.equal(parseModelJson(undefined), null);
});

test('coerces missing required fields to safe defaults', () => {
    const partial = JSON.stringify({ inferredRole: 'CTO' });
    const result = parseModelJson(partial);
    assert.ok(result);
    assert.equal(result.inferredRole, 'CTO');
    assert.equal(result.inferredSeniority, 'unknown');
    assert.equal(result.technicalDepth, 'unknown');
    assert.equal(result.communicationStyle, 'unknown');
    assert.deepEqual(result.concernsRevealed, []);
    assert.deepEqual(result.painPointsRevealed, []);
    assert.deepEqual(result.signalsAboutCandidate, []);
    assert.equal(result.whatTheyAreLookingFor, 'unknown');
});

test('clamps technicalDepth to enum or "unknown"', () => {
    for (const valid of ['low', 'medium', 'high', 'LOW', 'Medium']) {
        const r = parseModelJson(JSON.stringify({ technicalDepth: valid }));
        assert.ok(r);
        assert.ok(['low', 'medium', 'high'].includes(r.technicalDepth));
    }
    const r = parseModelJson(JSON.stringify({ technicalDepth: 'expert' }));
    assert.equal(r.technicalDepth, 'unknown');
    const r2 = parseModelJson(JSON.stringify({ technicalDepth: 42 }));
    assert.equal(r2.technicalDepth, 'unknown');
});

test('filters non-string entries from string-array fields', () => {
    const dirty = JSON.stringify({
        concernsRevealed: ['data security', 42, null, 'compliance', { nested: 'object' }],
    });
    const result = parseModelJson(dirty);
    assert.ok(result);
    assert.deepEqual(result.concernsRevealed, ['data security', 'compliance']);
});

test('caps array fields at 12 entries', () => {
    const many = Array.from({ length: 30 }, (_, i) => `concern ${i}`);
    const dirty = JSON.stringify({ concernsRevealed: many });
    const result = parseModelJson(dirty);
    assert.ok(result);
    assert.equal(result.concernsRevealed.length, 12);
});

test('extra unexpected fields are ignored without breaking parse', () => {
    const withExtra = JSON.stringify({
        inferredRole: 'CTO',
        somethingTheModelMadeUp: 'should be ignored',
        anotherThing: { nested: 'whatever' },
    });
    const result = parseModelJson(withExtra);
    assert.ok(result);
    assert.equal(result.inferredRole, 'CTO');
});

test('handles wrong types on every field defensively', () => {
    // Every typed field, given a wrong type, should fall back to its default
    // rather than throw or propagate the bad value.
    const allWrong = JSON.stringify({
        inferredRole: 42,
        inferredSeniority: ['array', 'instead'],
        technicalDepth: { object: true },
        communicationStyle: null,
        concernsRevealed: 'not an array',
        painPointsRevealed: 12,
        signalsAboutCandidate: { not: 'an array' },
        whatTheyAreLookingFor: ['array'],
    });
    const result = parseModelJson(allWrong);
    assert.ok(result);
    assert.equal(result.inferredRole, 'unknown');
    assert.equal(result.inferredSeniority, 'unknown');
    assert.equal(result.technicalDepth, 'unknown');
    assert.equal(result.communicationStyle, 'unknown');
    assert.deepEqual(result.concernsRevealed, []);
    assert.deepEqual(result.painPointsRevealed, []);
    assert.deepEqual(result.signalsAboutCandidate, []);
    assert.equal(result.whatTheyAreLookingFor, 'unknown');
});

test('preserves a previously-good model when LLM returns "unknown" for a field', () => {
    // The class layer (not parseModelJson) handles the merge — parseModelJson
    // just emits whatever the LLM said. This test pins the contract: "unknown"
    // arrives as the literal string, not as null/undefined.
    const result = parseModelJson(JSON.stringify({ inferredRole: 'unknown' }));
    assert.ok(result);
    assert.equal(result.inferredRole, 'unknown');
});
