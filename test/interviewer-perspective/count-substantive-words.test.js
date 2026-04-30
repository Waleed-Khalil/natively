// Unit tests for countSubstantiveWords — the threshold function that
// determines whether enough new content has accumulated to schedule a
// model update. Pure function, no I/O, no LLM.
//
// Run: npm run test:interviewer-perspective

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const builderPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'InterviewerModelBuilder.js');
let countSubstantiveWords;
try {
    ({ countSubstantiveWords } = require(builderPath));
} catch (e) {
    test('count-substantive-words tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load builder from ${builderPath}: ${e.message}`);
    });
    return;
}

test('counts a normal interviewer turn', () => {
    const text = 'Tell me about a time you led a team through a difficult migration project.';
    // Expected substantive: tell, me, about, time, led, team, through, difficult, migration, project
    // Filtered (in stoplists): "a" is too short; "you" is in fillers
    const n = countSubstantiveWords(text);
    assert.ok(n >= 9 && n <= 11, `expected ~10 substantive words, got ${n}`);
});

test('strips pure-filler turns to zero or near-zero', () => {
    assert.equal(countSubstantiveWords('yeah okay so'), 0);
    assert.equal(countSubstantiveWords('uh um yeah'), 0);
    assert.equal(countSubstantiveWords('ok ok got it'), 0);
});

test('handles empty / whitespace input', () => {
    assert.equal(countSubstantiveWords(''), 0);
    assert.equal(countSubstantiveWords('   '), 0);
    assert.equal(countSubstantiveWords(null), 0);
    assert.equal(countSubstantiveWords(undefined), 0);
});

test('contractions count as one substantive word', () => {
    // "don't" → "don t" after apostrophe→space → "don" survives (3 chars), "t" filtered (length < 2).
    // So "I don't think" → tokens: i (filler), don, t (length<2), think → 2 substantive (don, think).
    // Bit of a quirk — apostrophe handling is documented in the parseModelJson comment.
    const n = countSubstantiveWords("I don't think that's right");
    // Substantive after filters: don, think, that — "right" is in acks; "I" is in fillers; "s" is too short.
    assert.ok(n >= 2 && n <= 4, `expected 2-4 substantive, got ${n}`);
});

test('punctuation does not glue words together', () => {
    // "wait,what" should split into 2 tokens, not be one weird token.
    const n = countSubstantiveWords('wait,what about the database schema');
    assert.ok(n >= 4, `expected at least 4 substantive (wait, what, about, database, schema), got ${n}`);
});

test('substantive content over the 150-word threshold', () => {
    // Build a turn that's clearly above the threshold so we can verify the
    // count crosses 150. Use real-ish words to avoid relying on vocabulary
    // peculiarities.
    const word = 'architecture deployment latency throughput consistency replication ';
    const text = word.repeat(40);
    const n = countSubstantiveWords(text);
    assert.ok(n >= 150, `expected >=150 substantive, got ${n}`);
});

test('substantive content well under the threshold', () => {
    const text = 'Walk me through how you would approach this problem.';
    const n = countSubstantiveWords(text);
    assert.ok(n < 150 && n >= 4, `expected small count (4-10), got ${n}`);
});

test('case-insensitive filler matching', () => {
    // Mixed case: model output / quoted text shouldn't escape the filter.
    assert.equal(countSubstantiveWords('Yeah Okay So Uh'), 0);
});

test('quoted text contributes substantive words', () => {
    // "He said \"deploy on Friday\"" should count "said", "deploy", "on", "Friday"
    // (he and on and the apostrophes get filtered; quotes get stripped).
    const n = countSubstantiveWords('he said "deploy on friday"');
    assert.ok(n >= 3, `expected >=3 substantive (said, deploy, friday), got ${n}`);
});

test('repeated content counts each occurrence', () => {
    const a = countSubstantiveWords('database');
    const b = countSubstantiveWords('database database database');
    assert.equal(a, 1);
    assert.equal(b, 3);
});
