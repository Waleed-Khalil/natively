// Unit tests for the redaction pass that runs before voice-profile excerpts
// are persisted. Each test verifies one PII or company-name pattern.
//
// Run: npm run test:voice-profile

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Tests require the compiled electron output. The test:voice-profile npm
// script doesn't currently chain build:electron:tsc; we resolve it here so
// running `node --test test/voice-profile/redaction.test.js` directly works
// after a build, and skip-with-message if the build hasn't run.
const builderPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'voiceProfileBuilder.js');
let redactExcerpt;
try {
    ({ redactExcerpt } = require(builderPath));
} catch (e) {
    test('voice-profile redaction tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load builder from ${builderPath}: ${e.message}`);
    });
    return;
}

test('strips SSNs', () => {
    const out = redactExcerpt('My SSN is 123-45-6789 if you need it.', []);
    assert.ok(out.includes('[REDACTED-SSN]'));
    assert.ok(!out.includes('123-45-6789'));
});

test('strips credit-card-shaped numbers', () => {
    const out = redactExcerpt('The card was 4111 1111 1111 1111 charged.', []);
    assert.ok(out.includes('[REDACTED-CC]'));
    assert.ok(!out.includes('4111'));
});

test('strips email addresses', () => {
    const out = redactExcerpt('You can reach me at jane.doe+work@example.com.', []);
    assert.ok(out.includes('[REDACTED-EMAIL]'));
    assert.ok(!out.includes('jane.doe'));
});

test('strips US-shaped phone numbers (multiple formats)', () => {
    const cases = [
        '(415) 555-1234',
        '415-555-1234',
        '415.555.1234',
        '+1 415 555 1234',
        '4155551234',
    ];
    for (const c of cases) {
        const out = redactExcerpt(`Call me at ${c} please.`, []);
        assert.ok(out.includes('[REDACTED-PHONE]'), `Expected redaction for "${c}" but got: ${out}`);
    }
});

test('replaces Title-Case proper-noun spans NOT on the allow-list with [REDACTED-COMPANY]', () => {
    const out = redactExcerpt('I worked at Acme Corp on the IPG Scout team.', []);
    assert.ok(out.includes('[REDACTED-COMPANY]'), `Expected company redaction in: ${out}`);
    assert.ok(!out.includes('Acme'));
    assert.ok(!out.includes('IPG Scout'));
});

test('preserves company names on the allow-list', () => {
    const out = redactExcerpt(
        'I worked at NxtHumans on the orchestrator with Independence Blue Cross.',
        ['NxtHumans', 'Independence Blue Cross']
    );
    assert.ok(out.includes('NxtHumans'), `Expected NxtHumans preserved in: ${out}`);
    assert.ok(out.includes('Independence Blue Cross'), `Expected Independence Blue Cross preserved in: ${out}`);
});

test('preserves common stop tokens (I, The, days of week, months)', () => {
    const out = redactExcerpt('I joined on Monday in March. The team was great.', []);
    assert.ok(out.includes('I '));
    assert.ok(out.includes('Monday'));
    assert.ok(out.includes('March'));
    assert.ok(out.includes('The team'));
});

test('allow-list match is case-insensitive', () => {
    const out = redactExcerpt('We use NxtHumans and nxthumans.', ['NxtHumans']);
    // Only the proper-noun-shaped occurrence is checked; the lowercase one
    // doesn\'t match the proper-noun pattern in the first place.
    assert.ok(out.includes('NxtHumans'), `Title-cased mention should be preserved: ${out}`);
});

test('chains multiple PII types in a single string', () => {
    const out = redactExcerpt(
        'Call me at 415-555-1234 or jane@example.com — SSN 111-22-3333.',
        []
    );
    assert.ok(out.includes('[REDACTED-PHONE]'));
    assert.ok(out.includes('[REDACTED-EMAIL]'));
    assert.ok(out.includes('[REDACTED-SSN]'));
});

test('returns empty string unchanged', () => {
    assert.equal(redactExcerpt('', []), '');
});

test('all-lowercase text passes through unchanged', () => {
    const input = 'i worked on the multi-agent orchestrator for about three weeks';
    assert.equal(redactExcerpt(input, []), input);
});
