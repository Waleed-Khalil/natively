#!/usr/bin/env node
//
// Inspect the persisted candidate voice profile.
//
// Prints the JSON, file size, file mode (verifies 0600), and a copy of
// exactly the prompt block the runtime would inject. Use this to audit
// what's being sent to LLM providers as part of every suggestion.
//
// Usage:
//   npm run voice-profile:inspect

require('./_electron-shim');

const fs = require('fs');
const path = require('path');

async function main() {
    const distRoot = path.resolve(__dirname, '..', '..', 'dist-electron');
    const profilePath = path.join(distRoot, 'electron', 'services', 'CandidateVoiceProfile.js');

    if (!fs.existsSync(profilePath)) {
        console.error('[voice-profile:inspect] Compiled electron output not found at dist-electron/. Run `npm run build:electron:tsc` first.');
        process.exit(1);
    }

    const { CandidateVoiceProfile } = require(profilePath);
    const service = CandidateVoiceProfile.getInstance();
    const filePath = service.getProfilePath();

    if (!fs.existsSync(filePath)) {
        console.log(`[voice-profile:inspect] No profile at ${filePath}`);
        console.log('[voice-profile:inspect] Run `npm run voice-profile:build` to create one.');
        process.exit(0);
    }

    const stat = fs.statSync(filePath);
    const mode = (stat.mode & 0o777).toString(8);
    const isOwnerOnly = (stat.mode & 0o077) === 0;

    console.log(`[voice-profile:inspect] Path:  ${filePath}`);
    console.log(`[voice-profile:inspect] Size:  ${stat.size} bytes`);
    console.log(`[voice-profile:inspect] Mode:  0${mode}${isOwnerOnly ? ' (owner-only — OK)' : ' (WARNING: world/group readable, expected 0600)'}`);
    console.log('');

    const profile = service.load();
    if (!profile) {
        console.error('[voice-profile:inspect] Profile failed to load (schema mismatch or parse error). Try rebuilding.');
        process.exit(2);
    }

    console.log('--- profile JSON ---');
    console.log(JSON.stringify(profile, null, 2));
    console.log('');
    console.log('--- prompt block (this is exactly what gets injected into every suggestion) ---');
    console.log(service.buildAnchorBlock());
}

main().catch(err => {
    console.error('[voice-profile:inspect] Failed:', err);
    process.exit(1);
});
