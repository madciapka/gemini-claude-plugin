---
name: codex-helper
description: Delegate complex tasks, code reviews, and adversarial design checks to OpenAI Codex. Use when the user specifically asks for "Codex" to review, rescue, or check code.
---

# Codex Helper

This skill instructs you on how to delegate tasks to the `codex` CLI. Use this when the user asks for a "Codex review", "Codex second opinion", or to "ask Codex to do X".

## Workflows

### 1. Code Review (`codex review`)
When asked to have Codex review uncommitted or staged changes:
1. Generate a unique temp file path: `TMP_DIFF=$(mktemp)`.
2. Gather the diff: `git diff HEAD > "$TMP_DIFF"`.
3. Run `codex review - < "$TMP_DIFF"`.
4. Clean up: `rm "$TMP_DIFF"`.

### 2. Adversarial Review (`codex review` with custom prompt)
When asked for an adversarial or security-focused review:
1. Generate a unique temp file path: `TMP_DIFF=$(mktemp)`.
2. Gather the diff: `git diff HEAD > "$TMP_DIFF"`.
3. Run `codex review "Perform an adversarial review. Find flaws, edge cases, race conditions, and architectural weaknesses." - < "$TMP_DIFF"`.
4. Clean up: `rm "$TMP_DIFF"`.

### 3. Task Delegation (`codex exec`)
When asked to delegate a coding task to Codex:
1. Construct a clear prompt explaining what needs to be done.
2. Run `codex exec "<your prompt>"`. 
   *(Note: `codex exec` supports the `--sandbox read-only` flag if the task should not modify files).*

## Execution Rules & Backgrounding

**Decide on Backgrounding:**
- For small reviews or quick tasks, run synchronously (no `is_background` flag) so the user gets an immediate answer.
- For large diffs (>500 lines) or complex implementation tasks, set `is_background: true` in your `run_shell_command` tool call.
- If backgrounded, tell the user: "I've asked Codex to start working on this in the background. I'll let you know when the results are ready."

## Example Tools Call (Backgrounded)
```json
{
  "command": "T=$(mktemp) && git diff HEAD > $T && codex review - < $T; rm $T",
  "is_background": true,
  "description": "Running Codex review in background"
}
```
