---
name: codex-helper
description: Delegate complex tasks, code reviews, and adversarial design checks to OpenAI Codex. Use when the user specifically asks for "Codex" to review, rescue, or check code.
---

# Codex Helper

This skill instructs you on how to delegate tasks to the `codex` CLI. Use this when the user asks for a "Codex review", "Codex second opinion", or to "ask Codex to do X".

## Workflows

### 1. Code Review (`codex review`)
When asked to have Codex review uncommitted or staged changes:
1. Gather the diff using `git diff HEAD` (or against a specific branch if requested).
2. Save the diff to a temporary file (e.g., `/tmp/codex-review.diff`).
3. Run `codex review - < /tmp/codex-review.diff` using `run_shell_command`.

### 2. Adversarial Review (`codex review` with custom prompt)
When asked for an adversarial or security-focused review:
1. Gather the diff to a temporary file (e.g., `/tmp/codex-adv.diff`).
2. Run `cat /tmp/codex-adv.diff | codex review "Perform an adversarial review. Find flaws, edge cases, race conditions, and architectural weaknesses." -`

### 3. Task Delegation (`codex exec`)
When asked to delegate a coding task to Codex:
1. Construct a clear prompt explaining what needs to be done.
2. Run `codex exec "<your prompt>"` using `run_shell_command`. 
   *(Note: `codex exec` supports the `--sandbox read-only` flag if the task should not modify files).*

## Execution Rules & Backgrounding

Codex can take several minutes to process large files or complex reasoning tasks. 

**Always use background processes for Codex:**
1. When calling `codex review` or `codex exec`, ALWAYS set `is_background: true` in your `run_shell_command` tool call.
2. After launching, immediately tell the user: "I've asked Codex to start working on this in the background (PID: X). You can continue working, or ask me to check the status."
3. Wait for the user to ask for the result, or use `read_background_output` in a subsequent turn to check on it.

## Example Tools Calls

**Starting a background review:**
```json
{
  "command": "git diff HEAD > /tmp/diff.txt && codex review - < /tmp/diff.txt",
  "is_background": true,
  "description": "Running Codex review in background"
}
```

**Starting a background task:**
```json
{
  "command": "codex exec 'Refactor the authentication middleware to use standard JWT tokens'",
  "is_background": true,
  "description": "Delegating refactor task to Codex"
}
```
