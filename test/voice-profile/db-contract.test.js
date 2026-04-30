// Contract test for the transcripts-table schema in DatabaseManager.ts.
//
// The voice-profile builder pipes through MeetingPersistence.getUserTranscriptCorpus,
// which queries the `transcripts` table by name and reads `speaker`, `content`,
// and `timestamp_ms`. If a future migration renames or drops one of those
// columns and the builder isn't updated in lockstep, suggestion quality
// regresses silently — there's no error, just an empty profile next rebuild.
//
// This test fails loudly the moment that schema diverges from what the
// builder expects. Static source-scan rather than a live SQLite test so it
// runs without dist-electron and without a real DB.
//
// Run: npm run test:voice-profile

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dbManagerPath = path.resolve(__dirname, '..', '..', 'electron', 'db', 'DatabaseManager.ts');

test('DatabaseManager source contains transcripts CREATE TABLE', () => {
    const src = fs.readFileSync(dbManagerPath, 'utf8');
    const match = src.match(/CREATE TABLE IF NOT EXISTS transcripts\s*\(([\s\S]+?)\);/);
    assert.ok(match, `Could not find "CREATE TABLE IF NOT EXISTS transcripts (...)" in ${dbManagerPath}`);
});

test('transcripts table declares the columns the voice-profile builder reads', () => {
    const src = fs.readFileSync(dbManagerPath, 'utf8');
    const match = src.match(/CREATE TABLE IF NOT EXISTS transcripts\s*\(([\s\S]+?)\);/);
    assert.ok(match);
    const block = match[1];

    const requiredColumns = [
        { name: 'meeting_id', type: 'TEXT' },
        { name: 'speaker', type: 'TEXT' },
        { name: 'content', type: 'TEXT' },
        { name: 'timestamp_ms', type: 'INTEGER' },
    ];

    for (const col of requiredColumns) {
        const colPattern = new RegExp(`\\b${col.name}\\b\\s+${col.type}\\b`, 'i');
        assert.match(
            block,
            colPattern,
            `transcripts table is missing "${col.name} ${col.type}" — voice-profile builder will break. ` +
            `If this column was renamed, update electron/services/voiceProfileBuilder.ts and ` +
            `electron/MeetingPersistence.ts accordingly.`
        );
    }
});

test('getMeetingDetails projects transcript rows as { speaker, text, timestamp }', () => {
    // The builder consumes the post-projection shape from getMeetingDetails,
    // not the raw column names. Pin the projection too.
    const src = fs.readFileSync(dbManagerPath, 'utf8');
    const projectionRegion = src.match(/transcriptRows\.map\(row => \(\{[\s\S]+?\}\)\)/);
    assert.ok(projectionRegion, 'Could not locate transcriptRows.map(...) projection in DatabaseManager.ts');
    const block = projectionRegion[0];

    assert.match(block, /\bspeaker:\s*row\.speaker\b/, 'projection should map row.speaker → speaker');
    assert.match(block, /\btext:\s*row\.content\b/, 'projection should map row.content → text (builder reads .text)');
    assert.match(block, /\btimestamp:\s*row\.timestamp_ms\b/, 'projection should map row.timestamp_ms → timestamp');
});

test('MeetingPersistence.getUserTranscriptCorpus is a static method', () => {
    // The CLI script calls this without instantiating MeetingPersistence
    // (which would require an IntelligenceEngine). If someone refactors it
    // back to an instance method, the script breaks at the call site.
    const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'electron', 'MeetingPersistence.ts'),
        'utf8'
    );
    assert.match(
        src,
        /public\s+static\s+getUserTranscriptCorpus\b/,
        'MeetingPersistence.getUserTranscriptCorpus must remain static — the CLI script depends on it.'
    );
});

test('MeetingPersistence filters transcript segments to the user channel', () => {
    // The whole point of the corpus is the candidate's own speech. If this
    // ever stops filtering on speaker === "user", the profile gets contaminated
    // with the interviewer's voice and the few-shot becomes worse-than-useless.
    // Loose source scan rather than function-body regex (which is brittle
    // against nested braces in the destructured options arg).
    const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'electron', 'MeetingPersistence.ts'),
        'utf8'
    );
    assert.match(
        src,
        /seg\.speaker\s*!==\s*['"]user['"]/,
        'MeetingPersistence must filter on speaker === "user" before feeding the voice profile — anything else contaminates the few-shot.'
    );
});
