---
name: codex-cli-runtime
description: Use OpenAI Codex as a helper for coding, review, and task delegation from Gemini CLI
---

# Codex Runtime

Use this skill when you want to delegate a task, code review, or complex implementation to OpenAI Codex.

Primary helper:
- `node "${WORKSPACE_ROOT}/plugins/codex/scripts/codex-companion.mjs" task "<task description>"`

Execution rules:
- When the user asks for a "Codex review" or "Ask Codex to...", use this skill.
- Prefer `task` for general implementation or debugging requests.
- Use `review` for read-only code reviews of the current changes.
- Use `adversarial-review` for deep design and security challenges.
- Return Codex's output to the user as a "Second Opinion" or "Codex Analysis".

Examples:
- "Ask Codex to review my changes": `node plugins/codex/scripts/codex-companion.mjs review`
- "Have Codex check this for race conditions": `node plugins/codex/scripts/codex-companion.mjs adversarial-review "focus on race conditions"`
- "Delegate this fix to Codex": `node plugins/codex/scripts/codex-companion.mjs task "Fix the bug in src/auth.mjs"`

Job Management:
- If a task is expected to take a long time, you can suggest running it with `--background`.
- Use `status`, `result`, and `cancel` subcommands of the companion to manage background Codex jobs.
