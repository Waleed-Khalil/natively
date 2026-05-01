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

function loadScenario(file) {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
}

function nowMs() { return Date.now(); }
function fmtMs(ms) { return `${(ms / 1000).toFixed(2)}s`; }

async function runAction(im, action, label) {
    const start = nowMs();
    let result;
    let error = null;
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
    }
    const elapsed = nowMs() - start;
    return { result, error, elapsed, label: label || action.label || null };
}

async function runScenario(scenario, im) {
    console.log(`\n=== Running scenario: ${scenario.name} ===`);
    const trace = [];

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
                result:  out.error ? null : out.result,
                error:   out.error ? out.error.message : null,
            });
            continue;
        }

        console.warn(`  [${i + 1}] skipping malformed turn:`, turn);
    }

    return trace;
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
    out.push('## Summary');
    out.push('');
    out.push(`- **Total turns:** ${trace.length}`);
    out.push(`- **Actions invoked:** ${actionCount}`);
    out.push(`- **Errors:** ${errorCount}`);
    if (actionCount > 0) {
        out.push(`- **Mean action latency:** ${fmtMs(totalActionMs / actionCount)}`);
        out.push(`- **Total LLM time:** ${fmtMs(totalActionMs)}`);
    }

    return out.join('\n');
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
    const providerLabel = llmHelper.getCurrentProvider
        ? `${llmHelper.getCurrentProvider()} / ${llmHelper.getCurrentModel?.() || 'unknown'}`
        : 'unknown';
    console.log(`[interview-sim] LLMHelper ready — ${providerLabel}`);

    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const ts = timestamp();
    let totalErrors = 0;

    for (const sc of target) {
        const scenario = loadScenario(sc.file);
        // Fresh IntelligenceManager per scenario so context doesn't bleed
        const im = new IntelligenceManager(llmHelper);
        im.initializeLLMs();

        const startedAt = new Date().toISOString();
        const trace = await runScenario(scenario, im);

        const report = renderReport(scenario, trace, { runAt: startedAt, providerLabel });
        const outFile = path.join(RESULTS_DIR, `${ts}-${sc.id}.md`);
        fs.writeFileSync(outFile, report, 'utf8');
        console.log(`\n[interview-sim] wrote ${outFile}`);

        const errs = trace.filter(t => t.type === 'action' && t.error).length;
        totalErrors += errs;
    }

    console.log('\n[interview-sim] done. Errors across all scenarios:', totalErrors);
    if (totalErrors > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('[interview-sim] fatal:', err);
    process.exit(1);
});
