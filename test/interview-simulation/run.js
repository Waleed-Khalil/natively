#!/usr/bin/env node
//
// Interview simulation harness.
//
// Drives a real LLM through a scripted interview transcript and triggers each
// of the manual action buttons (What to Answer, Clarify, Code Hint, Brainstorm,
// Follow-Up, Recap, Follow-Up Questions). Captures each AI response into a
// markdown report so behavior changes are easy to eyeball and compare across
// runs / model versions.
//
// Usage:
//   npm run simulate:interview                    # runs all scenarios
//   npm run simulate:interview -- backend-swe     # runs one scenario by name
//   npm run simulate:interview -- --list          # lists available scenarios
//
// Prereq: dist-electron must exist. The npm script chains build:electron:tsc.
//
// Credentials: by preference, reads from CredentialsManager (works when run
// under electron-as-node). Falls back to env vars: GEMINI_API_KEY, GROQ_API_KEY,
// OPENAI_API_KEY, CLAUDE_API_KEY.

const shim = require('./_electron-shim');

const path = require('path');
const fs = require('fs');

// Load .env from the repo root so users with CLAUDE_API_KEY (etc.) in their
// project .env file can run the simulator without exporting first. Mirrors
// the same pattern as electron/main.ts when running unpackaged.
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
} catch {
    // dotenv is a devDependency — if it's somehow missing, just continue and
    // rely on already-set environment variables.
}

const DIST_ROOT = path.resolve(__dirname, '..', '..', 'dist-electron');
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const RESULTS_DIR = path.join(__dirname, 'results');

function loadCompiledModules() {
    const llmHelperPath = path.join(DIST_ROOT, 'electron', 'LLMHelper.js');
    const intelligenceManagerPath = path.join(DIST_ROOT, 'electron', 'IntelligenceManager.js');
    if (!fs.existsSync(llmHelperPath) || !fs.existsSync(intelligenceManagerPath)) {
        console.error('[interview-sim] dist-electron/ is missing or incomplete. Run `npm run build:electron:tsc` first.');
        process.exit(1);
    }
    const { LLMHelper } = require(llmHelperPath);
    const { IntelligenceManager } = require(intelligenceManagerPath);
    return { LLMHelper, IntelligenceManager };
}

function readApiKeys() {
    const env = {
        gemini: process.env.GEMINI_API_KEY,
        groq:   process.env.GROQ_API_KEY,
        openai: process.env.OPENAI_API_KEY,
        claude: process.env.CLAUDE_API_KEY,
    };

    if (env.gemini || env.groq || env.openai || env.claude) {
        const set = ['gemini', 'groq', 'openai', 'claude'].filter(k => env[k]);
        console.log(`[interview-sim] using API keys from environment: ${set.join(', ')}`);
        return env;
    }

    // CredentialsManager uses Electron's safeStorage, which only works inside a
    // real Electron app context. Under ELECTRON_RUN_AS_NODE=1 there's no app
    // lifecycle, so safeStorage isn't available and decryption fails. Asking
    // the user to set env vars is the simplest workable path.
    console.error('');
    console.error('[interview-sim] No API keys found in environment.');
    console.error('');
    console.error('  CredentialsManager (the keys saved in the app) needs Electron\'s');
    console.error('  safeStorage, which doesn\'t work in CLI mode. Export at least one');
    console.error('  provider key before re-running:');
    console.error('');
    console.error('    export GEMINI_API_KEY=...');
    console.error('    # or GROQ_API_KEY / OPENAI_API_KEY / CLAUDE_API_KEY');
    console.error('');
    console.error('  Then: npm run simulate:interview -- <scenario-name>');
    console.error('');
    process.exit(1);
}

function listScenarios() {
    if (!fs.existsSync(SCENARIOS_DIR)) return [];
    return fs.readdirSync(SCENARIOS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => ({ id: path.basename(f, '.json'), file: path.join(SCENARIOS_DIR, f) }));
}

/**
 * Read the user's persona-intelligence-layer data from the local SQLite
 * `user_profile` table (populated by the in-app resume upload + parse). Returns
 * { intro, persona, voiceLoaded, voiceMeetings } or null when nothing is set.
 *
 * Lets scenarios marked `useUserProfile: true` ground the AI on the actual
 * user's background instead of a hardcoded fictional candidate.
 */
function loadUserProfileData() {
    const userDataDir = shim.resolveUserDataPath();
    const dbPath = path.join(userDataDir, 'natively.db');
    const voicePath = path.join(userDataDir, 'voice_profile.json');

    let profileRow = null;
    try {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            const row = db.prepare('SELECT intro_interview, intro_short, compact_persona FROM user_profile ORDER BY id DESC LIMIT 1').get();
            if (row) profileRow = row;
        } catch {
            // user_profile table may not exist yet — fine, fall through
        }
        db.close();
    } catch {
        // SQLite unavailable / DB not present — fall through
    }

    let voiceLoaded = false;
    let voiceMeetings = 0;
    if (fs.existsSync(voicePath)) {
        try {
            const vp = JSON.parse(fs.readFileSync(voicePath, 'utf8'));
            voiceLoaded = true;
            voiceMeetings = vp?.metadata?.sampledMeetings ?? vp?.sampledMeetings ?? 0;
        } catch { /* ignore */ }
    }

    if (!profileRow && !voiceLoaded) return null;
    return {
        intro:   profileRow?.intro_interview || profileRow?.intro_short || null,
        persona: profileRow?.compact_persona || null,
        voiceLoaded,
        voiceMeetings,
    };
}

function buildPrimingFromUserProfile(profile) {
    const out = [];
    if (profile.intro) {
        out.push({
            speaker: 'user',
            text: `When asked to introduce myself, I would say: "${profile.intro}". My answers should anchor on this real background — never invent a different role, company, or technical specialty.`,
        });
    }
    if (profile.persona) {
        out.push({
            speaker: 'user',
            text: `Additional context about my actual experience and background: ${profile.persona}`,
        });
    }
    return out;
}

function loadScenario(file) {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
}

function nowMs() { return Date.now(); }
function fmtMs(ms) { return `${(ms / 1000).toFixed(2)}s`; }

// Pattern-match the fallback strings each LLM sub-class returns when its
// upstream call fails (rate limit, network, etc.). Per-class strings live
// in electron/llm/*LLM.ts. These are deliberately user-facing, so changing
// them in app code requires updating this list.
const SILENT_FAILURE_PATTERNS = [
    /^Could you repeat that\?/i,
    /^I couldn't analyze/i,
    /^I couldn't generate/i,
    /Make sure your (code|question) is visible/i,
];

function looksLikeSilentFailure(result) {
    if (typeof result !== 'string' || !result.trim()) return false;
    return SILENT_FAILURE_PATTERNS.some(p => p.test(result.trim()));
}

async function runAction(im, action, label) {
    const start = nowMs();
    let result;
    let error = null;

    // IntelligenceEngine emits 'error' for upstream failures rather than
    // letting them bubble — capture them so the report doesn't claim success.
    const capturedEngineErrors = [];
    const onError = (err /*, mode */) => {
        capturedEngineErrors.push(err);
    };
    im.on('error', onError);

    try {
        switch (action.action) {
            case 'assist':              result = await im.runAssistMode(); break;
            case 'what_to_say':         result = await im.runWhatShouldISay(action.question, action.confidence ?? 0.8, action.imagePaths); break;
            case 'clarify':             result = await im.runClarify(); break;
            case 'code_hint':           result = await im.runCodeHint(action.imagePaths, action.problem); break;
            case 'brainstorm':          result = await im.runBrainstorm(action.imagePaths, action.problem); break;
            case 'follow_up':           result = await im.runFollowUp(action.intent || 'elaborate', action.userRequest); break;
            case 'recap':               result = await im.runRecap(); break;
            case 'follow_up_questions': result = await im.runFollowUpQuestions(); break;
            case 'manual_question':     result = await im.runManualAnswer(action.question || ''); break;
            default:
                throw new Error(`Unknown action: ${action.action}`);
        }
    } catch (err) {
        error = err;
    } finally {
        im.off('error', onError);
    }

    // If the call didn't throw but the engine emitted an error event, OR the
    // result matches a known fallback string, treat it as a silent failure.
    if (!error && capturedEngineErrors.length > 0) {
        error = capturedEngineErrors[0];
    }
    if (!error && looksLikeSilentFailure(result)) {
        error = new Error(`Silent fallback response: "${String(result).slice(0, 120)}"`);
    }

    const elapsed = nowMs() - start;
    return { result, error, elapsed, label: label || action.label || null };
}

async function runScenario(scenario, im) {
    console.log(`\n=== Running scenario: ${scenario.name} ===`);
    const trace = [];

    // Build priming turns. Sources, in priority order:
    //   1. scenario.priming  — explicit hardcoded priming for fictional
    //      candidates (e.g. backend-swe.json, product-manager.json).
    //   2. scenario.useUserProfile — pull real user data from the local
    //      user_profile SQLite table + voice_profile.json, so the simulation
    //      grounds on the actual person rather than a made-up persona.
    //
    // Without this priming step, what_to_say on turn 1 has nothing but the
    // interviewer's words to anchor on and tends to hallucinate a generic
    // persona.
    let priming = Array.isArray(scenario.priming) ? scenario.priming.slice() : [];
    if (scenario.useUserProfile) {
        const profile = loadUserProfileData();
        if (profile) {
            const profilePriming = buildPrimingFromUserProfile(profile);
            if (profilePriming.length > 0) {
                console.log(`  [priming] using real user profile data (${profilePriming.length} turn(s)) — voice profile ${profile.voiceLoaded ? `loaded (${profile.voiceMeetings} meetings)` : 'not built yet'}`);
                priming = profilePriming.concat(priming);
            } else if (profile.voiceLoaded) {
                console.log(`  [priming] voice profile loaded (${profile.voiceMeetings} meetings) — no resume/intro in user_profile table; relying on voice profile alone`);
            }
        } else {
            console.warn('  [priming] useUserProfile requested but no user_profile row or voice_profile.json found — run the app and upload a resume in Settings → Profile first');
        }
    }

    if (priming.length > 0) {
        const baseTs = Date.now() - (priming.length + 1) * 60_000;
        priming.forEach((p, idx) => {
            if (!p.speaker || !p.text) return;
            im.addTranscript({
                speaker: p.speaker,
                text:    p.text,
                timestamp: baseTs + idx * 60_000,
                final:   true,
            }, true);
        });
    }

    for (let i = 0; i < scenario.turns.length; i++) {
        const turn = scenario.turns[i];

        if (turn.speaker && turn.text) {
            // Transcript turn — feed into IntelligenceManager
            const segment = {
                speaker: turn.speaker,
                text:    turn.text,
                timestamp: Date.now(),
                final:    true,
            };
            // Use skipRefinementCheck=true so the engine doesn't auto-trigger on every user turn
            im.addTranscript(segment, true);
            trace.push({ type: 'transcript', speaker: turn.speaker, text: turn.text });
            console.log(`  [${i + 1}] ${turn.speaker}: ${turn.text.slice(0, 80)}${turn.text.length > 80 ? '…' : ''}`);
            continue;
        }

        if (turn.action) {
            console.log(`  [${i + 1}] ▶ action: ${turn.action}${turn.label ? ` — ${turn.label}` : ''}`);
            const out = await runAction(im, turn, turn.label);
            const summary = out.error
                ? `ERROR: ${out.error.message}`
                : (typeof out.result === 'string' ? out.result.slice(0, 80) : JSON.stringify(out.result)?.slice(0, 80) || '(empty)');
            console.log(`         ${fmtMs(out.elapsed)} → ${summary}${typeof out.result === 'string' && out.result.length > 80 ? '…' : ''}`);

            // Feed the AI's answer back as a synthetic assistant message so subsequent
            // actions (like recap, follow-up) have it in context
            if (!out.error && typeof out.result === 'string' && out.result.trim()) {
                im.addAssistantMessage(out.result);
            }

            trace.push({
                type:    'action',
                action:  turn.action,
                label:   turn.label || null,
                intent:  turn.intent || null,
                elapsed: out.elapsed,
                // Keep the result alongside the error so the report can show
                // the silent-fallback text the AI returned (e.g. "Could you
                // repeat that?") while still flagging the action as failed.
                result:  out.result ?? null,
                error:   out.error ? out.error.message : null,
            });
            continue;
        }

        console.warn(`  [${i + 1}] skipping malformed turn:`, turn);
    }

    return trace;
}

function renderExpectationsSection(expectationResults) {
    if (!expectationResults || expectationResults.length === 0) return null;
    const out = [];
    out.push('## Expectations');
    out.push('');

    const passed = expectationResults.filter(r => r.passed).length;
    const failed = expectationResults.length - passed;
    out.push(`**${passed} passed · ${failed} failed** out of ${expectationResults.length}.`);
    out.push('');

    for (const r of expectationResults) {
        const exp = r.expectation;
        const status = r.passed ? '✅' : '❌';
        const turnLabel = exp.turn != null ? `Turn ${exp.turn}` : 'Scenario';
        const reason = exp.reason ? ` — ${exp.reason}` : '';
        out.push(`- ${status} **${turnLabel}**${reason}`);
        if (!r.passed) {
            for (const f of r.failures) {
                out.push(`    - \`${f}\``);
            }
        }
    }
    out.push('');
    return out.join('\n');
}

function renderReport(scenario, trace, meta) {
    const out = [];
    out.push(`# Interview Simulation: ${scenario.name}`);
    out.push('');
    out.push(`**Run at:** ${meta.runAt}`);
    out.push(`**Provider/model:** ${meta.providerLabel}`);
    out.push('');
    if (scenario.description) {
        out.push(`**Scenario:** ${scenario.description}`);
        out.push('');
    }
    if (scenario.context) {
        out.push('**Context:**');
        for (const [k, v] of Object.entries(scenario.context)) {
            out.push(`- **${k}**: ${v}`);
        }
        out.push('');
    }

    out.push('---');
    out.push('');
    out.push('## Trace');
    out.push('');

    let actionCount = 0;
    let totalActionMs = 0;
    let errorCount = 0;

    for (let i = 0; i < trace.length; i++) {
        const entry = trace[i];
        if (entry.type === 'transcript') {
            out.push(`### Turn ${i + 1} — ${entry.speaker}`);
            out.push('');
            out.push(`> ${entry.text.replace(/\n/g, '\n> ')}`);
            out.push('');
        } else if (entry.type === 'action') {
            actionCount++;
            totalActionMs += entry.elapsed;
            const labelText = entry.label ? ` — _${entry.label}_` : '';
            const intentText = entry.intent ? ` (intent: \`${entry.intent}\`)` : '';
            out.push(`### Action — \`${entry.action}\`${intentText}${labelText}`);
            out.push('');
            out.push(`**Elapsed:** ${fmtMs(entry.elapsed)}`);
            out.push('');
            if (entry.error) {
                errorCount++;
                out.push(`**❌ Error:** \`${entry.error}\``);
                if (entry.result) {
                    out.push('');
                    out.push('**Fallback response shown to user:**');
                    out.push('');
                    out.push('```');
                    out.push(typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result));
                    out.push('```');
                }
            } else if (entry.result == null || entry.result === '') {
                out.push('**Response:** _(empty)_');
            } else if (typeof entry.result === 'string') {
                out.push('**Response:**');
                out.push('');
                out.push('```');
                out.push(entry.result);
                out.push('```');
            } else {
                out.push('**Response (JSON):**');
                out.push('');
                out.push('```json');
                out.push(JSON.stringify(entry.result, null, 2));
                out.push('```');
            }
            out.push('');
        }
    }

    out.push('---');
    out.push('');

    if (meta.expectationsSection) {
        out.push(meta.expectationsSection);
        out.push('---');
        out.push('');
    }

    out.push('## Summary');
    out.push('');
    out.push(`- **Total turns:** ${trace.length}`);
    out.push(`- **Actions invoked:** ${actionCount}`);
    out.push(`- **Errors:** ${errorCount}`);
    if (typeof meta.expectationsPassed === 'number') {
        out.push(`- **Expectations:** ${meta.expectationsPassed} passed / ${meta.expectationsFailed} failed`);
    }
    if (actionCount > 0) {
        out.push(`- **Mean action latency:** ${fmtMs(totalActionMs / actionCount)}`);
        out.push(`- **Total LLM time:** ${fmtMs(totalActionMs)}`);
    }

    return out.join('\n');
}

/**
 * Evaluate scenario.expectations against the recorded trace. Each expectation
 * targets a turn (1-based, matching the report numbering) and asserts a rule.
 *
 * Supported rules:
 *   must_match       — single regex string OR array; ALL must match the result
 *   must_not_match   — single regex string OR array; NONE may match the result
 *   min_length       — number; result string length must be >= this value
 *   max_length       — number; result string length must be <= this value
 *   min_elapsed_ms   — number; the action must have actually taken at least
 *                      this long (catches silent no-ops like the cooldown bug)
 *   no_error         — boolean true; the trace entry must have error === null
 *
 * Multiple rules in one expectation are AND'd. Each expectation also takes a
 * `reason` string explaining what regression it guards against.
 */
function evaluateExpectations(scenario, trace) {
    const expectations = Array.isArray(scenario.expectations) ? scenario.expectations : [];
    const results = [];

    for (const exp of expectations) {
        const turnIdx = (exp.turn ?? 0) - 1; // 1-based to 0-based
        const entry = trace[turnIdx];
        const r = { expectation: exp, passed: true, failures: [] };

        if (!entry) {
            r.passed = false;
            r.failures.push(`Turn ${exp.turn} not found in trace (trace has ${trace.length} entries)`);
            results.push(r);
            continue;
        }
        if (entry.type !== 'action') {
            r.passed = false;
            r.failures.push(`Turn ${exp.turn} is a ${entry.type}, expected an action`);
            results.push(r);
            continue;
        }

        const resultStr = typeof entry.result === 'string' ? entry.result : '';

        if (exp.no_error === true && entry.error) {
            r.passed = false;
            r.failures.push(`expected no error, got: ${entry.error}`);
        }

        if (exp.must_match != null) {
            const patterns = Array.isArray(exp.must_match) ? exp.must_match : [exp.must_match];
            for (const p of patterns) {
                const re = new RegExp(p, 'i');
                if (!re.test(resultStr)) {
                    r.passed = false;
                    r.failures.push(`must_match /${p}/i did not match`);
                }
            }
        }

        if (exp.must_not_match != null) {
            const patterns = Array.isArray(exp.must_not_match) ? exp.must_not_match : [exp.must_not_match];
            for (const p of patterns) {
                const re = new RegExp(p, 'i');
                if (re.test(resultStr)) {
                    r.passed = false;
                    r.failures.push(`must_not_match /${p}/i unexpectedly matched`);
                }
            }
        }

        if (typeof exp.min_length === 'number' && resultStr.length < exp.min_length) {
            r.passed = false;
            r.failures.push(`min_length ${exp.min_length}, got ${resultStr.length}`);
        }
        if (typeof exp.max_length === 'number' && resultStr.length > exp.max_length) {
            r.passed = false;
            r.failures.push(`max_length ${exp.max_length}, got ${resultStr.length}`);
        }

        if (typeof exp.min_elapsed_ms === 'number' && entry.elapsed < exp.min_elapsed_ms) {
            r.passed = false;
            r.failures.push(`min_elapsed_ms ${exp.min_elapsed_ms}, got ${entry.elapsed}ms`);
        }

        results.push(r);
    }

    return results;
}

function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function parseArgs(argv) {
    const out = { list: false, scenarioFilter: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        // Trailing shell comments aren't always stripped by npm's script runner —
        // ignore everything from a `#` token onward so trailing notes like
        // `npm run simulate:interview -- backend-swe # the SWE one` still work.
        if (a === '#' || a.startsWith('#')) break;
        if (a === '--list' || a === '-l') {
            out.list = true;
            continue;
        }
        if (a === '--help' || a === '-h') {
            console.log('Usage: simulate:interview [scenario-name] [--list]');
            process.exit(0);
        }
        if (!a.startsWith('-') && out.scenarioFilter === null) {
            // Take the FIRST positional arg only; ignore extras so a stray
            // word doesn't silently override the requested scenario.
            out.scenarioFilter = a;
        }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const scenarios = listScenarios();
    if (scenarios.length === 0) {
        console.error('[interview-sim] No scenarios found in', SCENARIOS_DIR);
        process.exit(1);
    }

    if (args.list) {
        console.log('Available scenarios:');
        for (const s of scenarios) console.log(`  ${s.id}`);
        return;
    }

    const target = args.scenarioFilter
        ? scenarios.filter(s => s.id === args.scenarioFilter)
        : scenarios;

    if (args.scenarioFilter && target.length === 0) {
        console.error(`[interview-sim] Scenario not found: ${args.scenarioFilter}`);
        console.error('Available:', scenarios.map(s => s.id).join(', '));
        process.exit(1);
    }

    const { LLMHelper, IntelligenceManager } = loadCompiledModules();
    const keys = readApiKeys();

    if (!keys.gemini && !keys.groq && !keys.openai && !keys.claude) {
        console.error('[interview-sim] No API keys available. Set at least one of GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY.');
        process.exit(1);
    }

    const llmHelper = new LLMHelper(keys.gemini, false, undefined, undefined, keys.groq, keys.openai, keys.claude);

    // LLMHelper defaults to Gemini Flash. Prefer the higher-fidelity
    // provider when multiple keys are available — users who set Claude or
    // GPT keys almost always intend to use them; Gemini free-tier quota
    // depletion is a common silent failure mode otherwise.
    // SIMULATE_MODEL overrides for explicit selection.
    let modelChoice = process.env.SIMULATE_MODEL;
    if (!modelChoice) {
        if (keys.claude)       modelChoice = 'claude';
        else if (keys.openai)  modelChoice = 'gpt-5.4';
        else if (keys.gemini)  modelChoice = null; // default is already Gemini Flash
        else if (keys.groq)    modelChoice = 'llama';
    }
    if (modelChoice) {
        llmHelper.setModel(modelChoice, []);
    }

    const providerLabel = llmHelper.getCurrentProvider
        ? `${llmHelper.getCurrentProvider()} / ${llmHelper.getCurrentModel?.() || 'unknown'}`
        : 'unknown';
    console.log(`[interview-sim] LLMHelper ready — ${providerLabel}`);

    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const ts = timestamp();
    let totalErrors = 0;
    let totalExpectationFails = 0;

    for (const sc of target) {
        const scenario = loadScenario(sc.file);
        // Fresh IntelligenceManager per scenario so context doesn't bleed
        const im = new IntelligenceManager(llmHelper);
        im.initializeLLMs();

        const startedAt = new Date().toISOString();
        const trace = await runScenario(scenario, im);

        const expectationResults = evaluateExpectations(scenario, trace);
        const expPassed = expectationResults.filter(r => r.passed).length;
        const expFailed = expectationResults.length - expPassed;
        const expectationsSection = renderExpectationsSection(expectationResults);

        const report = renderReport(scenario, trace, {
            runAt: startedAt,
            providerLabel,
            expectationsSection,
            expectationsPassed: expectationResults.length > 0 ? expPassed : undefined,
            expectationsFailed: expFailed,
        });
        const outFile = path.join(RESULTS_DIR, `${ts}-${sc.id}.md`);
        fs.writeFileSync(outFile, report, 'utf8');
        console.log(`\n[interview-sim] wrote ${outFile}`);

        if (expectationResults.length > 0) {
            console.log(`[interview-sim] expectations: ${expPassed} passed / ${expFailed} failed`);
            for (const r of expectationResults) {
                if (!r.passed) {
                    const reason = r.expectation.reason ? ` — ${r.expectation.reason}` : '';
                    console.log(`  ❌ Turn ${r.expectation.turn}${reason}`);
                    for (const f of r.failures) console.log(`     · ${f}`);
                }
            }
        }

        const errs = trace.filter(t => t.type === 'action' && t.error).length;
        totalErrors += errs;
        totalExpectationFails += expFailed;
    }

    console.log('\n[interview-sim] done.');
    console.log(`  errors:                  ${totalErrors}`);
    console.log(`  expectation failures:    ${totalExpectationFails}`);
    if (totalErrors > 0 || totalExpectationFails > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('[interview-sim] fatal:', err);
    process.exit(1);
});
