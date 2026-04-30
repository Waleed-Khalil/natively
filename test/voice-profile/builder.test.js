// Unit tests for buildVoiceProfile — corpus → VoiceProfile.
//
// Run: npm run test:voice-profile

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const builderPath = path.resolve(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'voiceProfileBuilder.js');
let buildVoiceProfile, VOICE_PROFILE_VERSION, DEFAULT_BANNED_PHRASES;
try {
    ({ buildVoiceProfile, VOICE_PROFILE_VERSION, DEFAULT_BANNED_PHRASES } = require(builderPath));
} catch (e) {
    test('voice-profile builder tests require dist-electron — run `npm run build:electron:tsc` first', () => {
        assert.fail(`Could not load builder from ${builderPath}: ${e.message}`);
    });
    return;
}

function fixtureCorpus(opts = {}) {
    const fillers = opts.fillers ?? ['like', 'you know', 'i mean'];
    const opener = opts.opener ?? 'so basically';
    const segments = [];
    let ts = 1700000000000;
    // Generate 30 segments, each ~40 words, with mixed fillers and openers.
    for (let i = 0; i < 30; i++) {
        const filler = fillers[i % fillers.length];
        const text = `${opener}, the way I think about this problem is, ${filler}, you take the input and pass it through a couple of stages. First we validate, then we normalize, ${filler}, and finally we produce the output.`;
        segments.push({ text, timestamp: ts });
        ts += 30000;
    }
    return segments;
}

test('returns null for tiny corpora', () => {
    assert.equal(buildVoiceProfile([], 0), null);
    assert.equal(buildVoiceProfile([{ text: 'hi', timestamp: 0 }], 1), null);
});

test('builds a valid profile from a sufficient corpus', () => {
    const corpus = fixtureCorpus();
    const profile = buildVoiceProfile(corpus, 5);
    assert.ok(profile, 'expected a profile, got null');
    assert.equal(profile.version, VOICE_PROFILE_VERSION);
    assert.equal(profile.sampleCount, 5);
    assert.ok(profile.builtAt.match(/^\d{4}-\d{2}-\d{2}T/), `builtAt should be ISO: ${profile.builtAt}`);
    assert.ok(profile.excerpts.length > 0, 'expected at least one excerpt');
    assert.ok(profile.excerpts.length <= 3, `expected at most 3 excerpts, got ${profile.excerpts.length}`);
});

test('topFillers ranks by frequency', () => {
    const corpus = fixtureCorpus({ fillers: ['like', 'like', 'like', 'you know'] });
    const profile = buildVoiceProfile(corpus, 5);
    assert.ok(profile);
    assert.equal(profile.topFillers[0], 'like', `expected "like" first, got ${JSON.stringify(profile.topFillers)}`);
});

test('commonOpeners surfaces repeated openers', () => {
    const corpus = fixtureCorpus({ opener: 'so basically' });
    const profile = buildVoiceProfile(corpus, 5);
    assert.ok(profile);
    assert.ok(
        profile.commonOpeners.some(o => o.includes('so basically')),
        `expected "so basically" in openers, got ${JSON.stringify(profile.commonOpeners)}`
    );
});

test('avgSentenceLength is a positive finite number', () => {
    const corpus = fixtureCorpus();
    const profile = buildVoiceProfile(corpus, 5);
    assert.ok(profile);
    assert.ok(Number.isFinite(profile.avgSentenceLength));
    assert.ok(profile.avgSentenceLength > 0);
});

test('bannedPhrases ships with defaults', () => {
    const corpus = fixtureCorpus();
    const profile = buildVoiceProfile(corpus, 5);
    assert.ok(profile);
    assert.ok(profile.bannedPhrases.length > 0);
    assert.deepEqual(profile.bannedPhrases, DEFAULT_BANNED_PHRASES);
});

test('excerpts respect min/max word bounds', () => {
    const corpus = fixtureCorpus();
    const profile = buildVoiceProfile(corpus, 5, { minExcerptWords: 30, maxExcerptWords: 60 });
    assert.ok(profile);
    for (const ex of profile.excerpts) {
        const words = ex.split(/\s+/).filter(Boolean).length;
        assert.ok(words >= 30 && words <= 60, `excerpt out of bounds (${words} words): "${ex}"`);
    }
});

test('redaction is applied to excerpts', () => {
    const segments = [];
    let ts = 1700000000000;
    for (let i = 0; i < 30; i++) {
        segments.push({
            text: `So basically, my email is jane.doe@example.com and at Acme we built a thing that processes about a hundred records per second through the pipeline reliably and consistently every day.`,
            timestamp: ts,
        });
        ts += 30000;
    }
    const profile = buildVoiceProfile(segments, 5, { companyAllowList: [] });
    assert.ok(profile);
    for (const ex of profile.excerpts) {
        assert.ok(!ex.includes('jane.doe@'), `excerpt should not contain raw email: ${ex}`);
        assert.ok(!ex.includes('Acme'), `excerpt should redact unlisted company: ${ex}`);
    }
});

test('allow-list passes through to redaction', () => {
    const segments = [];
    let ts = 1700000000000;
    // Each segment is 35-40 words so it fits comfortably inside the
    // [30, 60] excerpt-word window pickExcerpts uses.
    for (let i = 0; i < 30; i++) {
        segments.push({
            text: `At NxtHumans we shipped the multi-agent orchestrator over a couple of weeks while keeping latency below a second across the full load test runs and verification suites we wrote together with the platform team and the on-call rotation.`,
            timestamp: ts,
        });
        ts += 30000;
    }
    const profile = buildVoiceProfile(segments, 5, { companyAllowList: ['NxtHumans'] });
    assert.ok(profile);
    assert.ok(profile.excerpts.length > 0, `expected at least one excerpt, got: ${JSON.stringify(profile.excerpts)}`);
    const hasAllowedName = profile.excerpts.some(ex => ex.includes('NxtHumans'));
    assert.ok(hasAllowedName, `expected NxtHumans preserved in at least one excerpt, got: ${JSON.stringify(profile.excerpts)}`);
});
