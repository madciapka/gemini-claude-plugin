# Changelog

All notable changes to this plugin are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), version numbers follow semver as published in `plugin.json` / `marketplace.json`.

## 1.1.1 — 2026-05-02

The "let the assistant call review" release. Removes the `disable-model-invocation` gate from the two review commands so the host LLM can run them directly during autonomous work.

### Changed

- **`/gemini:review` and `/gemini:adversarial-review` are now model-invocable.** Removed `disable-model-invocation: true` from both command frontmatters.
  - **Why it was there originally:** mirrored the Codex plugin's pattern, where review commands are user-only so the user explicitly triggers each run.
  - **Why it was removed:** the user-only gate forced the assistant to fall back to spawning the `gemini-rescue` subagent for review work, which is a meaningfully worse tool for the job. A direct A/B on the same diff (2026-05-02) showed slash review caught 3/3 real bugs (including a production-impact stderr-masking bug the rescue path missed) with 0 false positives, while the rescue path got ~3/8 findings wrong. Root cause: rescue is built for one-shot diagnosis and over-anchors on the prompt's literal checklist; the slash command's forced output schema (severity grading + ship/no-ship verdict + suggestion-with-code-block) is the load-bearing UX feature for review.
  - **Net effect:** the assistant can now reach for the better-suited tool when running review autonomously, instead of being forced into the diagnostic-shaped path. Cost/quota behavior is unchanged — this only affects who can call the command, not what it does.
- **`GEMINI.md` routing rule updated** to explicitly send review work to `/gemini:review` / `/gemini:adversarial-review` instead of telling the assistant "review is rescue."
- **Job-control commands stay user-only.** `status`, `result`, `cancel` keep `disable-model-invocation: true` — those are intentionally user-driven.

## 1.1.0 — 2026-04-29

The "delegate execution, not just questions" release. Adds a third axis to Gemini delegation: not just one-shot answers (`rescue`) and live observation (`rescue-stream`), but autonomous execution of a planned subtask with a structured handoff contract.

### Added

- **`/gemini:execute`** — autonomous executor command. Wraps the user's task in an autonomous-execution envelope (DIRECTIVE / AUTONOMOUS MANDATE / INSTRUCTIONS / BRANCH POLICY / VERIFICATION / OUTPUT) and runs Gemini under `--approval-mode yolo --sandbox --output-format stream-json` in a detached background job. Gemini creates a child branch (`gemini-exec/<short-id>`), implements the task, runs verification with up to 3 self-healing attempts per check, and writes a structured handoff at `.claude/handoffs/SESSION_HANDOFF_<date>_gemini_<short>.md`. The forwarder agent (`gemini-execute`) reads the handoff and surfaces it verbatim.
  - Plan input: inline (`/gemini:execute do thing X`) or plan-file reference (`/gemini:execute @docs/plan.md focus on Y`).
  - Required handoff sections: Status, Summary, Files touched, Branch, Verification, Decisions made, Extra findings and observations.
  - `--wait` flag for tightly-bounded foreground runs; default is background+stream.
  - `--no-sandbox` for the rare case where host access is genuinely needed.
- **`/gemini:rescue-stream`** — streamed delegation for long-running Gemini runs. Launches the job under `--output-format stream-json`, surfaces `init` / `message` / `tool_use` events back to Claude in real time via `tail -F` + `BashOutput` polling.
- **`gemini-execute`** and **`gemini-rescue-stream`** forwarder subagents.
- **`prompts/executor.md`** — autonomous-executor envelope template. Adopts the structure of a battle-tested autonomous-Gemini prompt (named pillars under AUTONOMOUS MANDATE: NO APPROVAL GATES, SELF-HEALING, CONFLICT RESOLUTION).
- **`scripts/lib/executor.mjs`** — pure helpers: `renderExecutorEnvelope` (system-vars-first / TASK-last substitution to defend against template-shaped user input), `resolveTaskInput` (inline vs `@path` plan-file detection), `validatePlanPath` (workspace containment + safe-character check), `buildHandoffPath`, `extractHandoffPath`, `validateHandoffMarker`.
- **`tail` subcommand** — `node gemini-companion.mjs tail <jobId>` waits for terminal status before exiting; designed for outer processes piping into a polling loop.
- **JSON envelope parsing** — `parseGeminiJsonResult` captures Gemini's `usage`, `duration`, and `model` fields per call, surviving deprecation prefixes and leading `{error}`-shaped warnings.
- **Stream-line consumer** — `consumeStreamLines` parses NDJSON events, keeps trailing-byte remainder for next-pass joining, collects unparseable lines as raw progress.
- **Heartbeat-aware status** — background wrapper writes a heartbeat every 5s; `pruneJobs` reaps PID-dead "running" zombies before they starve completed jobs out of the index.
- **Prompt-size guard** — reviews of diffs >600 KB auto-chunk per file at 200 KB and aggregate per-file findings.
- **Test harness** — 54 unit tests (envelope rendering, plan-file resolution, path validation, marker validation, JSON parsing, stream-line consumer, approval-mode mapping, job state, git target/diff helpers) and 9 live e2e tests (gated on `GEMINI_E2E=1`) covering setup, foreground/background/stream task flows, review-on-dirty-tree, review-on-clean-repo, tail, result, cancel.
- **`GEMINI.md`** at repo root — routing rule for the host Claude. Mirrors the `CODEX.md` style. Three delegation modes (rescue / rescue-stream / execute) with explicit selection guidance.
- **`docs/DEVELOPMENT.md`** — cache/marketplace/repo split, symlink dev override, loader reload semantics. Documented after burning a session debugging "why doesn't `/reload-plugins` see my new file" (answer: it doesn't, by design — cold restart needed for new files).

### Changed

- **`gemini-rescue` description narrowed.** Previously claimed ownership of "implementation tasks"; now scoped to one-shot diagnosis / research / single bounded answer with cross-references to `/gemini:execute` for write-capable work and `/gemini:rescue-stream` for live observation. Resolves routing ambiguity flagged in adversarial review.
- **`launchBackgroundJob` payload enriched.** Now surfaces `eventsFile`, `logFile`, `handoffPath`, `jobShortId` in both JSON and rendered output. Previously dropped these fields in non-JSON mode, breaking the streaming/executor contract for any caller not opting into `--json`.
- **`renderQueuedLaunch`** updated to print the full launch payload so forwarder agents can capture the artifact paths they need to tail and read.
- **Job state-file launch** accepts a pre-generated `jobId` so the executor can compute the handoff path before spawning Gemini.

### Fixed

- **`extractStreamJsonResponse`** — `result <jobId>` for streamed jobs previously fell through to the JSON-envelope parser, which only saw the `{init}` line. Now uses the stream-aware extractor.
- **`tail` waits for terminal status** before exiting (regression-tested) — was previously exiting on file existence, before completion.
- **`pruneJobs` reaps zombies** — jobs marked `running` whose PID is dead are cleaned up rather than perpetually exempted from pruning, which used to push completed jobs out of the index once the cap (`maxJobs`) was reached.
- **`gemini-rescue-stream` agent** — switched from `Monitor` (deferred tool, rejected by the agent loader at parse time) to `Bash run_in_background` + `BashOutput` polling. The agent now actually loads.

### Internal / Discovery

- **Loader reload semantics documented.** `/reload-plugins` does not pick up newly added command/agent/skill files — it only refreshes content of files the loader already knows about. New files require a cold Claude Code session restart. See `docs/DEVELOPMENT.md`.
- **Codex adversarial review run** post-implementation; 10 findings (1 critical, 2 high, 4 medium, 2 low, 1 nit). 7 fixed pre-release, 3 tracked in `OPEN-ISSUES.md` (Policy Engine integration, jobs-index race, command-level integration tests).

## 1.0.1 — 2026-04-15 (pre-1.1.0 baseline)

- Fix empty response when Gemini writes output to stderr (`extractStreamJsonResponse` regression).

## 1.0.0 — 2026-04-13

Initial public release.

- `/gemini:setup`, `/gemini:rescue`, `/gemini:review`, `/gemini:adversarial-review`, `/gemini:status`, `/gemini:result`, `/gemini:cancel`.
- `gemini-rescue` forwarder subagent.
- Companion-script architecture (`gemini-companion.mjs`) — Node.js runtime that spawns Gemini CLI in headless mode and returns output verbatim to Claude Code.
- Background job tracking via state files in `.gemini-companion/`.
- Standard and adversarial review prompt templates with grounding rules.
