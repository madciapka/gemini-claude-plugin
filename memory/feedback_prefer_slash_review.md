---
name: Prefer /gemini:review over rescue subagent for code review
description: For "is this PR shippable" review work, slash /gemini:review beats the gemini-rescue subagent on quality, false-positive rate, and decision-supporting output shape.
type: feedback
---

For code review work in this project, prefer `/gemini:review` (or `/gemini:adversarial-review`) over spawning the `gemini:gemini-rescue` subagent.

**Why:** Direct A/B comparison run by the user 2026-05-02 on the same diff:
- **Slash review:** caught 3/3 real bugs (including a production-impact one — ClaudePCli stderr-masking bug that would destroy diagnostics at 1300-hotel batch scale), 0 false positives, severity-graded with no-ship verdict and concrete replacement code blocks.
- **Rescue subagent:** caught some real issues but ~3/8 findings were wrong (over-anchored on the prompt's checklist questions, got confused reading old-vs-new in the diff, answered all 8 checklist items even when the right answer was "no issue").
- Root cause: rescue is built for one-shot diagnosis. Pointing it at "review this PR" makes it answer the literal checklist instead of doing holistic review. The slash command's forced output schema (severity grading + ship/no-ship verdict + suggestion-with-code-block) is the load-bearing UX feature.

**How to apply:**
- Default to `/gemini:review` for "review my diff" / "is this shippable" requests.
- Use `/gemini:adversarial-review <focus>` when there's a specific angle to challenge.
- Reach for the `gemini:gemini-rescue` subagent only for narrow "is X true at line Y" diagnostic questions, not for holistic review.
- Both slash commands are now model-invocable (gate removed 2026-05-02), so the assistant can call them directly when needed during autonomous work.
