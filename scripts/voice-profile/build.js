#!/usr/bin/env node
//
// Build the candidate voice profile from the local meetings DB.
//
// Reads recent user-channel transcripts via MeetingPersistence (single
// schema-coupling point), runs the pure builder + redaction pass, writes
// JSON with 0600 permissions to app.getPath('userData')/voice_profile.json.
//
// Usage:
//   npm run voice-profile:build
//   npm run voice-profile:build -- --limit 100
//   npm run voice-profile:build -- --allow "NxtHumans,Independence Blue Cross,United Safety"
//
// Prereq: dist-electron must exist. The npm script chains `build:electron:tsc`.

require('./_electron-shim');

const path = require('path');
const fs = require('fs');

const DEFAULT_ALLOW_LIST = [
    'NxtHumans',
    'Independence Blue Cross',
    'United Safety',
];

function parseArgs(argv) {
    const out = { limit: 50, allow: null, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 50;
        else if (a === '--allow') out.allow = argv[++i] ? argv[i].split(',').map(s => s.trim()).filter(Boolean) : null;
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '--help' || a === '-h') {
            console.log('Usage: voice-profile:build [--limit N] [--allow "A,B,C"] [--dry-run]');
            process.exit(0);
        }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const distRoot = path.resolve(__dirname, '..', '..', 'dist-electron');
    const meetingPersistencePath = path.join(distRoot, 'electron', 'MeetingPersistence.js');
    const builderPath = path.join(distRoot, 'electron', 'services', 'voiceProfileBuilder.js');
    const profilePath = path.join(distRoot, 'electron', 'services', 'CandidateVoiceProfile.js');

    if (!fs.existsSync(meetingPersistencePath) || !fs.existsSync(builderPath) || !fs.existsSync(profilePath)) {
        console.error('[voice-profile:build] Compiled electron output not found at dist-electron/. Run `npm run build:electron:tsc` first.');
        console.error(`  Expected: ${meetingPersistencePath}`);
        process.exit(1);
    }

    const { MeetingPersistence } = require(meetingPersistencePath);
    const { buildVoiceProfile } = require(builderPath);
    const { CandidateVoiceProfile } = require(profilePath);

    const allowList = args.allow ?? DEFAULT_ALLOW_LIST;

    console.log(`[voice-profile:build] Pulling user transcript corpus (limit=${args.limit} meetings)...`);
    const corpus = MeetingPersistence.getUserTranscriptCorpus({ meetingLimit: args.limit });

    if (corpus.segments.length === 0) {
        console.error('[voice-profile:build] No user-channel transcript segments found. Have you completed any meetings yet?');
        process.exit(2);
    }

    console.log(`[voice-profile:build] Corpus: ${corpus.sampleCount} meetings, ${corpus.segments.length} user segments`);
    console.log(`[voice-profile:build] Allow-list (${allowList.length}): ${allowList.join(', ')}`);

    const profile = buildVoiceProfile(corpus.segments, corpus.sampleCount, {
        companyAllowList: allowList,
    });

    if (!profile) {
        console.error('[voice-profile:build] Corpus too small to build a meaningful profile (need 20+ segments and 200+ words). Run more meetings first.');
        process.exit(3);
    }

    if (args.dryRun) {
        console.log('[voice-profile:build] --dry-run set, profile NOT written. Preview:');
        console.log(JSON.stringify(profile, null, 2));
        return;
    }

    const service = CandidateVoiceProfile.getInstance();
    service.writeProfile(profile);

    console.log(`[voice-profile:build] Wrote profile to ${service.getProfilePath()}`);
    console.log(`  excerpts:        ${profile.excerpts.length}`);
    console.log(`  avgSentenceLen:  ${profile.avgSentenceLength}`);
    console.log(`  topFillers:      ${profile.topFillers.join(', ') || '(none)'}`);
    console.log(`  commonOpeners:   ${profile.commonOpeners.join(', ') || '(none)'}`);
    console.log(`  bannedPhrases:   ${profile.bannedPhrases.length} (defaults shipped)`);
    console.log(`[voice-profile:build] Done. The runtime will pick this up on next app launch.`);
}

main().catch(err => {
    console.error('[voice-profile:build] Failed:', err);
    process.exit(1);
});
