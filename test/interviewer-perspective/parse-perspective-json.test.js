// Unit tests for parsePerspectiveJson — the perspective-LLM output parser.
// Format-drift tolerant: handles ```json fences, surrounding prose, and
// falls back to plain-text-as-perspective when JSON.parse fails.
//
// Run: npm run test:interviewer-perspective

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const llmPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'llm', 'InterviewerPerspectiveLLM.js');
let parsePerspectiveJson;
try {
    ({ parsePerspectiveJson } = require(llmPath));
} catch (e) {
    test('parse-perspective-json tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load InterviewerPerspectiveLLM from ${llmPath}: ${e.message}`);
    });
    return;
}

const VALID = JSON.stringify({
    perspective: 'They want to hear concrete trade-offs, not idealised architecture. Specifics about scale and team dynamics will land well; abstract framework talk will read as rehearsed.',
    recommendedAction: 'ANSWER',
});

test('parses a clean JSON response', () => {
    const r = parsePerspectiveJson(VALID);
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ANSWER');
    assert.ok(r.perspective.startsWith('They want to hear'));
});

test('strips ```json fences', () => {
    const r = parsePerspectiveJson('```json\n' + VALID + '\n```');
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ANSWER');
});

test('extracts JSON from surrounding prose', () => {
    const messy = "Here's the briefing for you:\n\n" + VALID + '\n\nLet me know if you need more.';
    const r = parsePerspectiveJson(messy);
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ANSWER');
});

test('coerces unknown action values to ANSWER', () => {
    const odd = JSON.stringify({ perspective: 'something', recommendedAction: 'NOTAREALACTION' });
    const r = parsePerspectiveJson(odd);
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ANSWER');
});

test('case-insensitive action parsing', () => {
    const r = parsePerspectiveJson(JSON.stringify({ perspective: 'p', recommendedAction: 'ask_back' }));
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ASK_BACK');
});

test('all four valid actions are recognised', () => {
    for (const action of ['ANSWER', 'ASK_BACK', 'BRIDGE', 'HOLD']) {
        const r = parsePerspectiveJson(JSON.stringify({ perspective: 'p', recommendedAction: action }));
        assert.ok(r, `failed on ${action}`);
        assert.equal(r.recommendedAction, action);
    }
});

test('plain-text fallback when JSON.parse fails — defaults to ANSWER', () => {
    const plain = 'They want concrete trade-offs and recent examples. Anything that sounds like a textbook walkthrough will read as rehearsed.';
    const r = parsePerspectiveJson(plain);
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ANSWER');
    assert.equal(r.perspective, plain);
});

test('returns null on empty input', () => {
    assert.equal(parsePerspectiveJson(''), null);
    assert.equal(parsePerspectiveJson(null), null);
    assert.equal(parsePerspectiveJson(undefined), null);
});

test('truncated JSON falls back to plain text rather than nulling out', () => {
    // Mid-stream timeout scenario. Better to use the partial as text than to
    // discard it entirely.
    const truncated = '{"perspective": "They want concrete examples';
    const r = parsePerspectiveJson(truncated);
    assert.ok(r);
    assert.equal(r.recommendedAction, 'ANSWER');
});

test('strips trailing whitespace from perspective', () => {
    const padded = JSON.stringify({ perspective: '   trimmed   ', recommendedAction: 'HOLD' });
    const r = parsePerspectiveJson(padded);
    assert.ok(r);
    assert.equal(r.perspective, 'trimmed');
});
