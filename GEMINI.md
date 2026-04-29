# Gemini plugin — how to use it

The `google-gemini` plugin (`/gemini:*` slash commands) lets you delegate work to Gemini CLI from inside Claude Code. Three entry points cover three distinct shapes of work.

## Pick the entry point first

| You want… | Use |
|---|---|
| Read-only diagnosis or a single-shot research answer | `/gemini:rescue` |
| Passive observation of a long-running Gemini job (events stream back) | `/gemini:rescue-stream` |
| Autonomous execution of a planned subtask, with self-healing + structured handoff | `/gemini:execute` |
| Plain "review my diff" | `/gemini:review` |
| Review with steering / adversarial questions | `/gemini:adversarial-review <focus>` |
| Background job control | `/gemini:status` · `/gemini:result` · `/gemini:cancel` |
| Verify install + auth | `/gemini:setup` |

## Three rules that prevent misroutes

1. **`/gemini:rescue` is read-only by default.** It runs Gemini under `--approval-mode plan`. If the user wants Gemini to actually change files, that is `/gemini:execute`, not `rescue --yolo` (don't reach for the rescue with a yolo flag — execute is the right shape and carries the executor envelope).
2. **`/gemini:execute` is write-capable and autonomous by default** (`--yolo --sandbox`, background+stream). Don't use it for review or research — those are `rescue`. Don't use it without a real plan; vague asks produce vague execution.
3. **Foreground vs background:**
   - `/gemini:rescue` defaults to foreground; add `--background` for unclear-scope investigations.
   - `/gemini:execute` defaults to background+stream; add `--wait` only for tight, bounded tasks.
   - `/gemini:rescue-stream` is always streamed.

## Don't touch unless explicitly asked

- `--model` — leave **unset**. Gemini picks its own default.
- `--yolo` (rescue only) — only when the user explicitly wants writes via rescue. Prefer `/gemini:execute` instead.
- `--no-sandbox` (execute only) — only when the task genuinely needs host access (rare).

## Delegating planned work to Gemini

When the user says "delegate this to Gemini", "have Gemini do X", "let Gemini handle it", or hands off a planned task → use `/gemini:execute`. Default behavior:

- **Background.** Executor jobs are usually multi-step; the user orchestrates while Gemini grinds.
- **Hand Gemini a real plan, not a one-liner.** Include: goal, relevant file paths/symbols, what's been tried or ruled out, and acceptance criteria (tests, build, smoke command). Terse prompts produce shallow execution. If a plan file already exists, point at it: `/gemini:execute @docs/closing-window-plan.md`.
- **Don't preset `--model`.** Let Gemini choose.
- **Don't shadow the work.** Once delegated, do not re-do the same investigation in the main thread — wait for the handoff and surface it verbatim.
- **Branches.** By default Gemini creates `gemini-exec/<short-id>` from the current branch and commits there. The user (or you, post-handoff) decides merge timing. Tell Gemini explicitly if you want a specific branch.
- **Verification.** The executor envelope mandates a verification loop with up to 3 self-healing attempts. The handoff records the verification command, exit code, and (on failure) last 20 lines of output.

## Handoff contract

Every `/gemini:execute` run writes a handoff file at `.claude/handoffs/SESSION_HANDOFF_<date>_gemini_<short-id>.md` with these required sections:

- **Status** — `completed | failed | blocked`
- **Summary** — what was done and the outcome
- **Files touched** — bullet list with reason per file
- **Branch** — name + last commit sha
- **Verification** — command, exit code, summary, output if failed
- **Decisions made** — judgment calls under CONFLICT RESOLUTION
- **Extra findings and observations** — surprises, edge cases, follow-ups

Read the handoff before deciding whether to merge. The "Extra findings" section is where Gemini surfaces things the planner did not anticipate; ignoring it is how regressions sneak in.

## Workflow discipline

- **Don't fix findings in the same turn as a Gemini review.** Review is review. Return Gemini's output verbatim and let the user decide next steps.
- **Don't auto-merge an executor branch.** The user orchestrates merges; you surface the diff and the handoff.
- Codex review is mandatory before committing per the global CLAUDE.md "Work discipline" rule. That includes work that Gemini executed on your behalf — Gemini's output gets the same review treatment as your own.
