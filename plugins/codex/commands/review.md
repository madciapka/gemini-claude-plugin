---
description: Run an OpenAI Codex code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]'
---

Run an OpenAI Codex code review.

This command delegates the review to the `codex` CLI helper. It will collect the relevant git diffs and pass them to Codex for analysis.

Execution:
```bash
node plugins/codex/scripts/codex-companion.mjs review "$ARGUMENTS"
```
