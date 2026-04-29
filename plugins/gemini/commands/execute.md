---
description: Delegate a planned subtask to Gemini for autonomous execution with self-healing and structured handoff
argument-hint: "[--wait] [--no-sandbox] [--model <model>] (<task description> | @path/to/plan.md)"
context: fork
allowed-tools: Bash(node:*)
---

Use this when you have a planned subtask and want Gemini to **do the work** end-to-end: implement, verify, and write a structured handoff. Gemini runs with `--approval-mode yolo` and `--sandbox` by default, on a child branch it creates itself.

For read-only diagnosis or a single-shot answer, use `/gemini:rescue` instead.
For passive observation of a long Gemini run, use `/gemini:rescue-stream`.

Route this request to the `gemini:gemini-execute` subagent.

Raw user request:
$ARGUMENTS

Operating rules:

- The subagent is a thin forwarder. It runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" execute ...` and surfaces the launch payload, streamed events, and final handoff verbatim.
- Default execution mode is background+stream. Add `--wait` to run in the foreground when the task is tightly bounded and you want the result inline.
- The user's task text may be inline ("implement X using Y") or a plan-file reference (`@path/to/plan.md`, optionally followed by extra context). The companion script handles both.
- Do not preset `--model`. Do not pass `--yolo` (forced) or `--read-only` (incompatible with executor mode).
- After Gemini finishes, the agent reads the handoff file from `handoffPath` and surfaces its contents. That handoff is the report — do not paraphrase or summarize it before showing the user.
- If Gemini did not write the handoff file, surface that as a failure with the final lines of the log so the user can diagnose.
- Do not auto-merge the executor's branch. The orchestrator (you or the user) decides merge timing.
- If no task was supplied, ask what Gemini should execute (and whether they have a plan file).
