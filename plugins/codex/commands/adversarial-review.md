---
description: Run an adversarial Codex review to challenge design and security
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [focus ...]'
---

Run an adversarial Codex review.

This command asks Codex to challenge your implementation details, design tradeoffs, and potential edge cases.

Execution:
```bash
node plugins/codex/scripts/codex-companion.mjs adversarial-review "$ARGUMENTS"
```
