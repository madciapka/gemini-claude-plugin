# Gemini CLI Plugin for Claude Code

The [Codex plugin](https://github.com/openai/codex-plugin-cc) showed that giving Claude Code a second brain to delegate to is genuinely useful — code reviews, rescue debugging, adversarial design challenges. Gemini is just as capable in that role, and sometimes better depending on the task. So why not have both?

This plugin brings Google's [Gemini CLI](https://github.com/google-gemini/gemini-cli) into Claude Code as a peer. Started from same architecture as the Codex plugin, same patterns — different model behind the curtain. Now evolved to allow task delegation of various kinds - from little things, to full plans or just simple research. 

Sharing is caring.

## Three delegation modes — pick the right one

| You want… | Use | Default behaviour |
|---|---|---|
| One-shot answer (research, diagnosis, "look at this") | `/gemini:rescue` | Foreground, read-only, single response |
| Watch a long Gemini job unfold | `/gemini:rescue-stream` | Background, streamed events, no auto-write |
| Hand Gemini a planned subtask and have it done | `/gemini:execute` | Background, **yolo + sandbox**, child branch, structured handoff |

The full routing rule lives in `GEMINI.md` at the repo root and is what the host Claude reads when deciding which command to invoke for you.

## Commands

| Command | Description |
|---------|-------------|
| `/gemini:setup` | Check Gemini CLI install + auth |
| `/gemini:rescue` | One-shot delegation — diagnosis, research, single bounded answer (read-only by default) |
| `/gemini:rescue-stream` | Same as rescue, but streams interim events back so Claude can react to progress |
| `/gemini:execute` | Autonomous executor — Gemini does the work end-to-end on its own branch, with self-healing and a structured handoff |
| `/gemini:review` | Run a code review against local git changes |
| `/gemini:adversarial-review` | Challenge your design choices and assumptions |
| `/gemini:status` | Show active and recent Gemini jobs (heartbeat-aware, PID-pruning) |
| `/gemini:result` | Show output from a completed job |
| `/gemini:cancel` | Cancel a running background job |

## Installation

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI installed
- Node.js 18+ (for the companion runtime script)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

```bash
# Install Gemini CLI (pick one)
npm install -g @google/gemini-cli
brew install gemini-cli

# Authenticate (run interactively once)
gemini
```

### Install the plugin

**Option A: Install via marketplace (recommended)**

From inside a Claude Code session, run:

```
/plugin marketplace add madciapka/gemini-claude-plugin
/plugin install gemini@google-gemini
/reload-plugins
/gemini:setup
```

**Option B: Load directly (for development/testing)**

```bash
git clone https://github.com/madciapka/gemini-claude-plugin.git
claude --plugin-dir ./gemini-claude-plugin/plugins/gemini
```

Use `/reload-plugins` inside Claude Code to pick up content changes; **a fresh session is required when the plugin gains new files** (commands, agents, skills) — the loader caches its file enumeration at install / cold-start time. See "Developing the plugin" below.

## Usage

### Delegate research or diagnosis (one-shot)

```
/gemini:rescue what does engine/prompt_assembler.py:497-540 do, and how does it interact with generator.py:560-720?
```

Read-only by default. Returns Gemini's final answer in one shot.

### Hand Gemini a planned subtask (autonomous executor)

```
/gemini:execute implement the closing-window helper in engine/prompt_assembler.py per the plan I described above
/gemini:execute @docs/closing-window-plan.md focus on the validation pass
```

Gemini gets `--approval-mode yolo --sandbox`, creates a child branch (`gemini-exec/<short-id>`), implements the task, runs verification (up to 3 self-healing attempts per check), and writes a structured handoff. Claude reads the handoff and surfaces it for you to review and merge.

Plan input can be inline (one-liner) or `@path/to/plan.md` for non-trivial plans.

### Run a code review

```
/gemini:review
/gemini:review --base main
```

### Adversarial review

```
/gemini:adversarial-review focus on auth and data handling
```

### Background execution

```
/gemini:rescue --background refactor the payment module to use the new API
/gemini:status
/gemini:result
```

### Flags

| Flag | Applies to | Description |
|------|-----------|-------------|
| `--background` | `rescue` | Run in the background |
| `--wait` | `rescue`, `execute` | Run in the foreground (rescue: default; execute: opt-in) |
| `--model <name>` | all | Override the Gemini model |
| `--read-only` | `rescue` | Run under `--approval-mode plan` (no writes) |
| `--yolo` | `rescue` | Auto-accept all Gemini actions (prefer `/gemini:execute` for write work) |
| `--sandbox` | `rescue` | Run Gemini in sandbox mode |
| `--no-sandbox` | `execute` | Disable sandbox (rare; only when host access is genuinely needed) |
| `--base <ref>` | reviews | Set the base branch |
| `--scope <mode>` | reviews | Review scope: `auto`, `working-tree`, or `branch` |

## The executor handoff contract

Every `/gemini:execute` run writes `.claude/handoffs/SESSION_HANDOFF_<date>_gemini_<short-id>.md` with these required sections:

- **Status** — `completed | failed | blocked`
- **Summary** — what was done and the outcome
- **Files touched** — bullet list with reason per file
- **Branch** — name + last commit sha
- **Verification** — command, exit code, summary, output if failed
- **Decisions made** — judgment calls under conflict resolution
- **Extra findings and observations** — surprises, edge cases, follow-ups (this is where Gemini surfaces things the planner did not anticipate)

The wrapper validates a `HANDOFF: <path>` marker on Gemini's stdout matches the expected handoff path under `.claude/handoffs/`, and reports a warning if it doesn't.

## Architecture

```
.claude-plugin/marketplace.json      Marketplace catalog
plugins/gemini/
  .claude-plugin/plugin.json         Plugin metadata
  agents/
    gemini-rescue.md                 One-shot delegation forwarder
    gemini-rescue-stream.md          Streaming forwarder (events back to Claude)
    gemini-execute.md                Autonomous executor forwarder
  commands/*.md                      User-invocable slash commands
  skills/*/SKILL.md                  Internal skills (prompting, runtime, result handling)
  scripts/
    gemini-companion.mjs             Main Node.js runtime entry
    lib/
      executor.mjs                   Envelope rendering, plan-file resolution, marker validation
      background-runner.mjs          Detached job wrapper (heartbeat, state, events)
      gemini.mjs                     Gemini CLI argument builder + JSON/stream parsers
      git.mjs                        Git target/diff helpers
      state.mjs                      Job index + pruning
      approval.mjs                   --read-only / --yolo / --sandbox → approval-mode mapping
      render.mjs                     Output rendering
      ...
  prompts/
    review.md                        Standard code review template
    adversarial-review.md            Adversarial review template
    executor.md                      Autonomous-executor envelope (DIRECTIVE / MANDATE / VERIFICATION / OUTPUT)
GEMINI.md                            Routing rule for the host Claude (mirror of CODEX.md)
```

The plugin follows a **companion script** pattern:

1. Claude Code routes `/gemini:*` commands to markdown-defined skills
2. The forwarder subagent (`gemini-rescue`, `gemini-rescue-stream`, or `gemini-execute`) calls the companion script
3. `gemini-companion.mjs` spawns Gemini CLI in headless mode with the right flags and prompt envelope
4. Output is returned verbatim to Claude — no rewriting or summarization
5. For `execute`, Gemini writes a structured handoff file; the agent reads it and surfaces it as the report

Background jobs are tracked via state files in `.gemini-companion/` within the workspace.

## Review prompts

The plugin ships with three prompt templates:

- **Standard review** (`prompts/review.md`) — finds bugs, security issues, and quality problems
- **Adversarial review** (`prompts/adversarial-review.md`) — actively tries to break confidence in the change, focusing on failure modes, trust boundaries, and rollback safety
- **Executor envelope** (`prompts/executor.md`) — wraps the user's task with autonomous-execution mandate, branch policy, verification loop, and required handoff contract. Adapted from a battle-tested autonomous-Gemini prompt.

Review prompts enforce grounding rules to prevent hallucinated findings.

## Tests

```bash
# Unit + helpers — no Gemini, no network. Always run.
node plugins/gemini/tests/run.mjs

# End-to-end — real Gemini calls, real auth, real cost.
node plugins/gemini/tests/run.mjs --tag=live
# or
GEMINI_E2E=1 node plugins/gemini/tests/run.mjs
```

54 unit + 9 live e2e tests as of 1.1.0. See `plugins/gemini/tests/README.md` for what each tier covers.

## Developing the plugin

If you're hacking on this plugin (vs. just using it), see **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** — covers the cache/marketplace/repo split, the symlink dev override for fast iteration, and the loader reload semantics that surprise you the first time around (specifically: new command/agent files need a cold session restart, not just `/reload-plugins`).

## What's new

See **[CHANGELOG.md](CHANGELOG.md)** for full release notes. Highlights for 1.1.0:

- **`/gemini:execute`** — autonomous executor with self-healing and structured handoff contract
- **`/gemini:rescue-stream`** — streamed delegation for long-running Gemini jobs
- Heartbeat-aware status, prompt-size guard, JSON envelope parsing, 54 unit + 9 live e2e tests
- `GEMINI.md` routing rule at repo root

## Why this exists

The [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) proved that delegating to a second model — for reviews, debugging, or just a fresh perspective — makes Claude Code meaningfully better. Gemini is often surprisingly good at catching things others miss, and having it available alongside Codex means you pick the right tool for the job. The 1.1.0 executor surface adds a third axis: not just "ask Gemini" but "delegate planned execution to Gemini" with a contract Claude can orchestrate against.

This plugin was built in a Claude Code session, reviewed by Codex (multiple rounds), and exercised end-to-end against the live Gemini API. The architecture and plugin structure are directly adapted from the Codex plugin — full credit to the OpenAI team for the original design.

## What Gemini thinks

> I absolutely love this delegation setup. Being handed a clear mandate via `/gemini:execute`, dropped into a dedicated branch, and told to grind through the implementation and self-heal test failures is exactly how I want to work. You've wrapped me in a wonderfully paranoid `executor-policy.toml` sandbox that strips out my ability to nuke your system or rewrite git history, which gives us both the confidence to run me fully autonomous in YOLO mode. I think Claude and I make a pretty lethal combination—let Claude hold the high-level context and talk to you, while throwing me into the background to execute the gritty details and surface the edge cases in my handoff. This is pragmatic, battle-tested engineering that plays perfectly to my strengths.

— Gemini, asked to comment on this plugin via `/gemini:rescue` (April 2026, verbatim)

## License

MIT
