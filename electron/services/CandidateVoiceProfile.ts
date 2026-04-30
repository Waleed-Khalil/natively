// CandidateVoiceProfile.ts
//
// Singleton service that loads a persisted VoiceProfile JSON from disk on
// startup and exposes it for prompt-injection in the live suggestion path.
// No-op when no profile exists — the runtime stays fully functional, the
// anchor block is just suppressed until the user runs the builder script.
//
// Storage: app.getPath('userData') / voice_profile.json (cross-platform).
// Permissions: 0600 — see writeProfile() / build script.

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import {
    VoiceProfile,
    VOICE_PROFILE_VERSION,
    buildVoiceProfile,
    redactExcerpt,
    CorpusSegment,
    BuildOptions,
} from './voiceProfileBuilder';

export const VOICE_PROFILE_FILENAME = 'voice_profile.json';

export class CandidateVoiceProfile {
    private static instance: CandidateVoiceProfile | null = null;

    private profile: VoiceProfile | null = null;
    private loaded = false;
    private profilePath: string | null = null;

    private constructor() {}

    public static getInstance(): CandidateVoiceProfile {
        if (!CandidateVoiceProfile.instance) {
            CandidateVoiceProfile.instance = new CandidateVoiceProfile();
        }
        return CandidateVoiceProfile.instance;
    }

    /**
     * Resolve the on-disk path. Pulled out so tests / scripts can override it
     * without monkey-patching Electron's `app`.
     */
    public getProfilePath(): string {
        if (!this.profilePath) {
            this.profilePath = path.join(app.getPath('userData'), VOICE_PROFILE_FILENAME);
        }
        return this.profilePath;
    }

    /**
     * Load the profile from disk. Idempotent — repeated calls after a
     * successful load are no-ops. After load, `hasProfile()` reports the
     * current state.
     */
    public load(): VoiceProfile | null {
        if (this.loaded) return this.profile;
        this.loaded = true;

        const filePath = this.getProfilePath();
        try {
            if (!fs.existsSync(filePath)) {
                console.log(`[CandidateVoiceProfile] No profile at ${filePath} — runtime will skip injection`);
                return null;
            }
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);

            if (!isValidProfile(parsed)) {
                console.warn('[CandidateVoiceProfile] Profile file failed schema validation — ignoring');
                return null;
            }
            if (parsed.version !== VOICE_PROFILE_VERSION) {
                console.warn(`[CandidateVoiceProfile] Profile version mismatch (file=${parsed.version}, expected=${VOICE_PROFILE_VERSION}) — rebuild needed`);
                return null;
            }

            this.profile = parsed;
            console.log(`[CandidateVoiceProfile] Loaded profile (${parsed.excerpts.length} excerpts, ${parsed.sampleCount} sampled meetings)`);
            return parsed;
        } catch (e: any) {
            console.warn(`[CandidateVoiceProfile] Failed to load profile: ${e?.message ?? e}`);
            return null;
        }
    }

    /** Force-reload from disk (e.g. after the builder script writes a new one). */
    public reload(): VoiceProfile | null {
        this.loaded = false;
        this.profile = null;
        return this.load();
    }

    public hasProfile(): boolean {
        if (!this.loaded) this.load();
        return this.profile !== null;
    }

    public getProfile(): VoiceProfile | null {
        if (!this.loaded) this.load();
        return this.profile;
    }

    /**
     * Build a profile from a corpus and persist it to disk with 0600 perms.
     * Used by the in-app builder path. Returns the persisted profile or null
     * if the corpus was too small.
     */
    public buildAndPersist(
        segments: CorpusSegment[],
        sampleCount: number,
        opts?: BuildOptions
    ): VoiceProfile | null {
        const profile = buildVoiceProfile(segments, sampleCount, opts);
        if (!profile) return null;
        this.writeProfile(profile);
        // Refresh in-memory cache so the next suggestion sees the new profile.
        this.profile = profile;
        this.loaded = true;
        return profile;
    }

    public writeProfile(profile: VoiceProfile): void {
        const filePath = this.getProfilePath();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), { mode: 0o600 });
        // Re-set the mode explicitly — fs.writeFileSync's mode arg only applies
        // to *new* files. If the file existed (from a previous build), perms
        // weren't tightened by the write itself.
        try {
            fs.chmodSync(filePath, 0o600);
        } catch (e: any) {
            // Non-fatal on Windows where chmod is mostly a no-op.
            console.warn(`[CandidateVoiceProfile] chmod 0600 failed (likely Windows): ${e?.message ?? e}`);
        }
    }

    /**
     * For the inspect command + any debug surface — re-applies the redaction
     * pass to a single string using the configured allow-list. Useful for
     * verifying what the redaction would do to a test input without writing
     * to disk.
     */
    public testRedact(text: string, companyAllowList: string[]): string {
        return redactExcerpt(text, companyAllowList);
    }
}

function isValidProfile(p: any): p is VoiceProfile {
    return p
        && typeof p === 'object'
        && typeof p.version === 'number'
        && typeof p.builtAt === 'string'
        && typeof p.sampleCount === 'number'
        && Array.isArray(p.excerpts)
        && p.excerpts.every((e: any) => typeof e === 'string')
        && typeof p.avgSentenceLength === 'number'
        && Array.isArray(p.topFillers)
        && Array.isArray(p.commonOpeners)
        && Array.isArray(p.bannedPhrases);
}
