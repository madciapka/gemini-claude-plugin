---
description: Delegate to Gemini and stream its events back to Claude as they happen
argument-hint: "[--model <model>] [--read-only|--yolo|--sandbox] [what Gemini should investigate, solve, or research]"
context: fork
allowed-tools: Bash(node:*)
---

Use this when the Gemini run is **long, open-ended, or write-capable** and you want Claude to react to interim progress (file edits, tool calls, partial findings) instead of waiting for one final blob.

Use `/gemini:rescue` (not this command) when you only need Gemini's final answer as a single artifact.

Raw user request:
$ARGUMENTS

Operating contract:

- Run a Bash call to launch the streamed background job:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task --stream "$ARGUMENTS"
  ```
  The companion prints a JSON-ish payload (`jobId`, `eventsFile`, `logFile`).
- Capture the `jobId` and `eventsFile` from that output.
- Tail the job with `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" tail "$jobId"` (`run_in_background: true`) and read new lines via `BashOutput` periodically. **Do not use raw `tail -F`** — it leaks. The companion's `tail` exits on terminal job status.
- Each event line is JSON-line (`stream-json`). Common `type` values include `init`, `message`, `tool_use`, `error`. Treat lines that fail to parse as raw progress text.
- The companion's `tail` exits on its own when the job is `completed` / `failed` / `cancelled`. If it's still running after 30 s with no new lines, surface a stall.
- After completion, fetch the final response with:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" result <jobId>
  ```
  and return that verbatim, exactly like `/gemini:rescue`.

Argument handling:

- Preserve the user's natural-language task text exactly.
- `--model`, `--read-only`, `--yolo`, `--sandbox` are runtime flags — pass them through.
- Do **not** strip `--stream`; the helper requires it.
- Default to `--read-only` when the user asked for review/diagnosis/research with no explicit request to apply fixes.

Don'ts:

- Do not paraphrase or summarize Gemini's events. Surface them verbatim.
- Do not fall back to `/gemini:rescue` if streaming fails — surface the error and stop.
- Do not auto-apply fixes from a streamed review. Same rule as `/gemini:rescue`.
