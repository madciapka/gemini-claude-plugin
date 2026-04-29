---
description: Delegate diagnosis, research, or a single bounded answer to Gemini in one shot — read-only by default. For autonomous file changes use /gemini:execute.
argument-hint: "[--background|--wait] [--model <model>] [--read-only|--yolo|--sandbox] [what Gemini should investigate or research]"
context: fork
allowed-tools: Bash(node:*)
---

Use this when you want Gemini's *final answer* as a single artifact — bounded research, diagnosis, or a "look at this" pass. Defaults to `--read-only`.

**For autonomous file changes** (Gemini implements, verifies, writes a structured handoff), use `/gemini:execute` — that is the surface designed for write-capable delegation with self-healing. Do not pass `--yolo` to rescue as a way to get write capability; route to `/gemini:execute` instead.

**For passive observation** of a long Gemini run with streamed events, use `/gemini:rescue-stream`.

Route this request to the `gemini:gemini-rescue` subagent.
The final user-visible response must be Gemini's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `gemini:gemini-rescue` subagent in the background.
- If the request includes `--wait`, run the `gemini:gemini-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model`, `--read-only`, `--yolo`, and `--sandbox` are runtime flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- Default to `--read-only` when the user asked for review, diagnosis, research, or "look at" work without an explicit request to apply fixes. `--read-only` runs Gemini under `--approval-mode plan` (no writes, no sandbox overhead).

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Gemini companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/gemini:status`, fetch `/gemini:result`, call `/gemini:cancel`, summarize output, or do follow-up work of its own.
- Leave `--model` unset unless the user explicitly asks for a specific model.
- If the user did not supply a request, ask what Gemini should investigate or fix.
