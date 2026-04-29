---
name: gemini-cli-runtime
description: Internal helper contract for calling the gemini-companion runtime from Claude Code
user-invocable: false
---

# Gemini Runtime

Use this skill only inside the `gemini:gemini-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct Gemini CLI strings, or any other Bash activity.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, `tail`, or `cancel` from `gemini:gemini-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gemini-prompting` skill to rewrite the user's request into a tighter Gemini prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave `--model` unset unless the user explicitly requests a specific model.
- Default to `--read-only` (Gemini in `plan` approval mode, no writes, no sandbox) when the user asked for review, diagnosis, research, or "look at" work without an explicit request to apply fixes.
- For explicit fix or implementation requests, default to a write-capable run (no `--sandbox`, no `--read-only`).
- If the user asks for `--yolo`, pass it through. This enables auto-accept of all actions and is mutually exclusive with `--read-only`; if both are present, `--read-only` wins.
- If the user asks for `--sandbox`, pass it through. This enables sandbox mode and is ignored when `--read-only` is set.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background`, `--wait`, or `--stream`, treat them as Claude-side execution controls.
  - `--background` → run `task --background` and return the queued-launch payload.
  - `--stream` → only used by the `gemini:rescue-stream` flow. Forward `--stream` through to `task`.
  - `--wait` → run foreground (the default). Strip the flag before forwarding the natural-language task text.
- If the forwarded request includes `--model`, pass it through to `task`.

Safety rules:
- Read-only by default for review/diagnosis/research; write-capable only for explicit fix/implementation requests.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, tail logs, cancel jobs, summarize output, or do any follow-up work of your own — except inside the streaming forwarder (`gemini:gemini-rescue-stream`), which is *required* to attach `Monitor` to the events file the helper prints.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Gemini cannot be invoked, return nothing.
