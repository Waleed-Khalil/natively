# Interview Simulation

Drives `IntelligenceManager` through a scripted interview transcript and triggers the same manual action buttons exposed in the UI (What to Answer, Clarify, Code Hint, Brainstorm, Follow-Up, Recap, Follow-Up Questions, Manual Question). Each AI response is captured into a markdown report so you can eyeball behavior, regress against earlier runs, and decide where prompts/routing need tightening.

## Quick start

```bash
# Run all scenarios using your saved API keys (CredentialsManager)
npm run simulate:interview

# Run a single scenario by name (matches the JSON filename without extension)
npm run simulate:interview -- backend-swe

# List available scenarios
npm run simulate:interview -- --list
```

Reports land in `test/interview-simulation/results/<timestamp>-<scenario-id>.md`.

## Credentials

The runner reads API keys from environment variables — at least one of:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENAI_API_KEY`
- `CLAUDE_API_KEY`

```bash
export GEMINI_API_KEY=...
npm run simulate:interview
```

**Why not the saved keys from the app?** CredentialsManager uses Electron's `safeStorage`, which only works inside a full Electron app runtime. The simulator runs in CLI mode (`ELECTRON_RUN_AS_NODE=1`) where `safeStorage` isn't available, so it can't decrypt them. Easiest path is to export the same key you have saved in the app.

Gemini is the cheapest/fastest provider for iterating on prompts. Claude or GPT-4 will give you higher-fidelity responses to evaluate behavior.

The runner picks a default model based on which key you exported (Gemini Flash if Gemini is set, else Claude Sonnet, else Groq Llama, else GPT). Override with `SIMULATE_MODEL`:

```bash
export CLAUDE_API_KEY=...
export SIMULATE_MODEL=claude-haiku   # cheaper Claude
npm run simulate:interview
```

Recognized values follow `LLMHelper.setModel()`: `gemini` (Flash), `gemini-pro`, `claude` (Sonnet), `claude-haiku`, `llama`, `gpt-5.4`, or any concrete model ID.

## Scenario format

Scenarios live in `scenarios/*.json`. Each is a sequence of **turns**, where every turn is either a transcript line or a scheduled action invocation.

```json
{
  "name": "Backend SWE — Distributed Systems",
  "description": "...",
  "context": { "role": "...", "company": "...", "candidate": "..." },
  "turns": [
    { "speaker": "interviewer", "text": "Tell me about yourself." },
    { "action": "what_to_say", "label": "User clicks 'What to answer'" },
    { "speaker": "user", "text": "I'm a backend engineer..." },
    { "action": "follow_up", "intent": "elaborate" },
    { "action": "recap" }
  ]
}
```

### Priming (optional)

A scenario can include a `priming` array of synthetic transcript turns fed before the main scenario starts. Use this to anchor the candidate's background so the AI doesn't hallucinate a persona on the opening question.

```json
"priming": [
  { "speaker": "user", "text": "Quick context for myself: I'm a senior backend engineer..." }
],
"turns": [ ... ]
```

These turns are pushed into the transcript with timestamps an hour before turn 1, so they read like prior conversation context rather than as part of the live interview. They never trigger actions and they don't appear in the trace section of the report.

**Why this matters:** `WhatToAnswerLLM` grounds on transcript history plus your on-disk `CandidateVoiceProfile`. With zero prior turns and a thin profile, it tends to confabulate a generic persona on the opener (we caught it inventing an "ML infrastructure" background for a Go fintech candidate). Priming gives it real anchor text to reference.

### Using your real persona (`useUserProfile`)

A scenario can set `"useUserProfile": true` instead of (or in addition to) hardcoded `priming`. The runner will pull two sources of real persona data and synthesize priming from them:

- **`user_profile.intro_interview` / `compact_persona`** from the local SQLite DB. This is the parsed-resume self-description populated by **Settings → Profile → Upload Resume** in the app. The runner reads it read-only and uses `intro_interview` as the answer to "tell me about yourself" anchor and `compact_persona` as additional grounding.
- **`voice_profile.json`** in your `userData` directory, built from your past meetings via `npm run voice-profile:build`. The runner doesn't read it directly — `CandidateVoiceProfile.getInstance()` does, automatically, because `WhatToAnswerLLM` already consults it to anchor the candidate's speaking style.

If neither is set up, the runner warns and falls back to whatever `priming` block the scenario also defines.

`scenarios/self-profile.json` uses `useUserProfile: true` and is the right place to evaluate "how does the AI represent ME specifically" rather than a fictional persona.

### Expectations / regression checks

A scenario can include an `expectations` array. After the run, each expectation is evaluated against the trace; failures appear in an Expectations section in the report and bump the runner's exit code to 1 (so this can gate CI).

```json
{
  "expectations": [
    {
      "turn": 12,
      "must_not_match": ["^we had a", "the worst one I dealt with"],
      "must_match": "\\[your ",
      "reason": "Brainstorm must scaffold with placeholders, never fabricate a story"
    },
    {
      "turn": 5,
      "min_elapsed_ms": 500,
      "min_length": 100,
      "no_error": true,
      "reason": "what_to_say must not silently no-op (cooldown regression)"
    }
  ]
}
```

`turn` is 1-based to match the report numbering. Supported rule keys:

- `must_match` — string regex OR array of regexes; **all** must match the result (case-insensitive)
- `must_not_match` — string regex OR array; **none** may match
- `min_length` / `max_length` — character bounds on the result string
- `min_elapsed_ms` — guards against silent no-ops (e.g. cooldown bugs that return null in 0ms)
- `no_error` — `true` requires the action to have completed without an engine error or silent fallback

`reason` is human-readable and shows in the report next to the pass/fail icon. Use it to name the regression you're guarding against — when an expectation fails six months from now, future-you should know exactly what bug it was meant to catch.

### Turn shapes

**Transcript turn** — gets fed into `IntelligenceManager.addTranscript()`:

```json
{ "speaker": "interviewer" | "user", "text": "..." }
```

**Action turn** — invokes the matching `IntelligenceManager.run*()` method:

| `action` value | maps to | optional fields |
|---|---|---|
| `assist` | `runAssistMode()` | — |
| `what_to_say` | `runWhatShouldISay()` | `question`, `confidence`, `imagePaths` |
| `clarify` | `runClarify()` | — |
| `code_hint` | `runCodeHint()` | `imagePaths`, `problem` |
| `brainstorm` | `runBrainstorm()` | `imagePaths`, `problem` |
| `follow_up` | `runFollowUp()` | `intent` (default `elaborate`), `userRequest` |
| `recap` | `runRecap()` | — |
| `follow_up_questions` | `runFollowUpQuestions()` | — |
| `manual_question` | `runManualAnswer()` | `question` |

`label` is optional metadata that appears in the report ("User clicks 'What to answer' on opening question") — useful for narrating *why* the user would have pressed that button at this point in the interview.

### Important behavior

After every action that produces a string response, the runner feeds the AI's answer back via `addAssistantMessage()`. This means later actions (especially `recap`) see the conversation as if the user had actually used the AI's suggestions — which is the realistic case to test.

## Adding a scenario

1. Drop a new JSON file in `scenarios/`.
2. Stage interviewer questions, user responses, and action triggers in the order they'd happen.
3. Run `npm run simulate:interview -- <new-scenario-id>`.
4. Read the generated markdown report in `results/`.

Tips for good scenarios:

- **Mix easy and hard questions.** Easy ones tell you the prompt isn't being weird; hard ones surface where the AI struggles.
- **Trigger the same action at different points.** `what_to_say` after the opening question vs. after a system design pivot will exercise different prompt branches.
- **Include a `recap` at the end.** This validates the whole-session summarization works with the actual transcript shape.
- **Add a `follow_up` with a specific `intent`** (`elaborate`, `rephrase`, `add_example`, `more_confident`, `more_casual`, `more_formal`, `simplify`) to test the refinement code path.

## Reading the report

Each report has:

- **Header** — scenario name, run timestamp, model that ran the scenario, and the candidate context.
- **Trace** — every turn in order. Transcript turns are quoted; action turns include the elapsed time and the AI's full response in a code block.
- **Summary** — turn/action counts, error count, mean and total LLM latency.

What to look for:

- **Hallucinated context** — the AI mentioning things that weren't in the transcript.
- **Tone drift** — `more_casual` actually producing more casual phrasing, etc.
- **Recap accuracy** — does the recap remember the actual interview flow, or does it confabulate?
- **Latency outliers** — actions that suddenly take 10× longer than usual.
- **Empty or error responses** — anywhere the AI returns null or throws.

## CI use

The script exits with code 1 if any action errors out. To wire this into CI:

```yaml
- run: npm run simulate:interview
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Pin a model version in your scenario's expected behavior notes (in `description`) and diff the report markdown across runs to catch regressions.
