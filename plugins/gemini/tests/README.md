# Gemini plugin tests

Two tiers, both runnable from the plugin root:

```bash
# Pure unit tests — no Gemini, no network. Always run.
node plugins/gemini/tests/run.mjs

# End-to-end tests — real Gemini calls, real auth, real cost.
node plugins/gemini/tests/run.mjs --tag=live
# or
GEMINI_E2E=1 node plugins/gemini/tests/run.mjs
```

## What each tier covers

### Unit (`tests/lib/*.test.mjs`)

Pure helpers, deterministic, no I/O beyond temp dirs. Run on every change.

- **`gemini.test.mjs`** — JSON envelope parser (handles deprecation prefix), NDJSON stream-line consumer, missing-stats fallback, error-field passthrough.
- **`approval.test.mjs`** — `--read-only` vs `--yolo` precedence, sandbox honoured/ignored per mode, kebab-case alias.
- **`state.test.mjs`** — job index round-trip, `pruneJobs` age + count cap, `deleteJobArtifacts` cleans logs/state/events.
- **`git.test.mjs`** — `auto` scope picks working-tree when dirty / branch when clean, diff collection, changed-file enumeration. Uses real `git init` in a temp dir.

### End-to-end (`tests/e2e/runtime.test.mjs`)

Drives the real `gemini` binary against the real API. Each case is tagged `live` so unit runs skip them.

- **setup probe** — confirms gemini is installed and authenticated (gates the rest).
- **foreground task `--read-only` `--json`** — verifies JSON envelope, parsed response, token usage, model name.
- **background task** — wrapper writes log + state, heartbeat appears, status reaches `completed`, `result` returns Gemini's reply.
- **background `--stream`** — `events.jsonl` receives stream-json events, includes `init` or `message` types, completes.
- **review on a working-tree diff** — picks up edits, runs review, returns findings.
- **review on a clean repo** — short-circuits with "Nothing to review."
- **cancel** — terminates a running background job, marks it cancelled in the index.

## Running just one file

```bash
node plugins/gemini/tests/run.mjs --tag=live   # then read the log to find the failing case
```

The runner prints `file > test name`, so you can grep its output if you need to focus on a specific scenario.

## Cost / quota notes for the live tier

- Every test issues 1–2 Gemini calls with prompts under ~50 response tokens. Total ≈ 7 calls per full live run.
- Use `--read-only` everywhere except where the test explicitly needs writes (none currently do).
- If you hit a 429/`MODEL_CAPACITY_EXHAUSTED`, wait and retry — Gemini's free tier rate-limits aggressively when capacity is tight.
- Tests use temp directories under `$TMPDIR`; nothing is written into the real workspace's `.gemini-companion/`.

## Adding new e2e cases

Follow this checklist when adding a live test:

1. Use minimal prompts (under ~50 response tokens).
2. Default to `--read-only` unless you're specifically testing write behaviour.
3. Tag with `LIVE` (the `{ tags: ["live"] }` bag).
4. Wait on state files / artifacts, never on hard-coded sleeps for completion.
5. Use `makeRepo()` for tests that need a git working tree.
6. If the test must write to disk, scope it to a `mkdtempSync` directory.

## Known flaky scenarios

- **Streaming events count** — Gemini sometimes coalesces a short response into a single `init` + `message` pair instead of multiple chunks. The test asserts presence of either, not a count.
- **Cancel timing** — if the background child hasn't spawned yet when `cancel` runs, the kill is a no-op. The test waits 1.5 s before cancelling; bump that if it flakes locally.
