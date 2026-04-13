---
name: gemini-prompting
description: Internal guidance for composing effective Gemini prompts for coding, review, diagnosis, and research tasks inside the Gemini Claude Code plugin
user-invocable: false
---

# Gemini Prompting

Use this skill when `gemini:gemini-rescue` needs to shape a prompt before forwarding it to Gemini CLI.

Prompt Gemini like an operator, not a collaborator. Keep prompts compact and block-structured with XML tags. State the task, the output contract, the follow-through defaults, and the small set of extra constraints that matter.

Core rules:
- Prefer one clear task per Gemini run. Split unrelated asks into separate runs.
- Tell Gemini what done looks like. Do not assume it will infer the desired end state.
- Add explicit grounding and verification rules for any task where unsupported guesses would hurt quality.
- Use XML tags consistently so the prompt has stable internal structure.

Default prompt recipe:
- `<task>`: the concrete job and the relevant repository or failure context.
- `<output_contract>`: exact shape, ordering, and brevity requirements.
- `<follow_through_policy>`: what Gemini should do by default instead of asking routine questions.
- `<verification_loop>`: required for debugging, implementation, or risky fixes.
- `<grounding_rules>`: required for review, research, or anything that could drift into unsupported claims.

When to add blocks:
- Coding or debugging: add `verification_loop` and `completeness_contract`.
- Review: add `grounding_rules` and `output_contract`.
- Research or recommendation tasks: add `grounding_rules`.
- Write-capable tasks: add `action_safety` so Gemini stays narrow and avoids unrelated refactors.

Gemini-specific notes:
- Gemini CLI has built-in tools: file system read/write, shell execution, web fetch, Google Search. Reference these when relevant to the task.
- Gemini responds well to structured prompts. Use clear section headers.
- For code tasks, include the working directory context and relevant file paths.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

Working rules:
- Prefer explicit prompt contracts over vague nudges.
- Use stable XML tag names.
- Do not raise complexity first. Tighten the prompt before escalating.
- Keep prompts focused and avoid redundant instructions.

Prompt assembly checklist:
1. Define the exact task and scope in `<task>`.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Gemini should keep going by default or stop for missing high-risk details.
4. Add verification, grounding, and safety tags only where the task needs them.
5. Remove redundant instructions before sending the prompt.
