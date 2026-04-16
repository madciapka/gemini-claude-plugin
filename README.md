# Gemini CLI Plugin for Claude Code

The [Codex plugin](https://github.com/openai/codex-plugin-cc) showed that giving Claude Code a second brain to delegate to is genuinely useful — code reviews, rescue debugging, adversarial design challenges. Gemini is just as capable in that role, and sometimes better depending on the task. So why not have both?

This plugin brings Google's [Gemini CLI](https://github.com/google-gemini/gemini-cli) into Claude Code as a peer. Same architecture as the Codex plugin, same patterns — different model behind the curtain. Sharing is caring.

And I could not help myself and sent Gemini to do Codex for Gemini so we can close the circle ... https://github.com/madciapka/codex-gemini-skill :)

## Commands

| Command | Description |
|---------|-------------|
| `/gemini:setup` | Check if Gemini CLI is installed and authenticated |
| `/gemini:rescue` | Delegate investigation, debugging, or implementation to Gemini |
| `/gemini:review` | Run a code review against local git changes |
| `/gemini:adversarial-review` | Challenge your design choices and assumptions |
| `/gemini:status` | Show active and recent Gemini jobs |
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

Use `/reload-plugins` inside Claude Code to pick up changes without restarting.

## Usage

### Delegate a task

```
/gemini:rescue fix the flaky test in src/auth.test.ts
```

Gemini gets full access to your working directory and can read files, run commands, and make edits.

### Run a code review

```
/gemini:review
```

Reviews your current working tree changes (staged + unstaged). For branch reviews:

```
/gemini:review --base main
```

### Adversarial review

```
/gemini:adversarial-review
/gemini:adversarial-review --base main focus on auth and data handling
```

Challenges your implementation approach — looks for violated invariants, missing failure paths, race conditions, and assumptions that break under stress.

### Background execution

For long-running tasks, use `--background`:

```
/gemini:rescue --background refactor the payment module to use the new API
/gemini:status
/gemini:result
```

### Flags

| Flag | Description |
|------|-------------|
| `--background` | Run in the background |
| `--wait` | Run in the foreground (default) |
| `--model <name>` | Override the Gemini model |
| `--yolo` | Auto-accept all Gemini actions |
| `--sandbox` | Run Gemini in sandbox mode |
| `--base <ref>` | Set the base branch for reviews |
| `--scope <mode>` | Review scope: `auto`, `working-tree`, or `branch` |

## Architecture

```
.claude-plugin/marketplace.json      Marketplace catalog
plugins/gemini/
  .claude-plugin/plugin.json         Plugin metadata
  agents/gemini-rescue.md            Thin forwarder subagent
  commands/*.md                      User-invocable slash commands
  skills/*/SKILL.md                  Internal skills (prompting, runtime, result handling)
  scripts/gemini-companion.mjs       Main Node.js runtime
  scripts/lib/*.mjs                  Library modules (CLI wrapper, git, state, rendering)
  prompts/*.md                       Review prompt templates
```

The plugin follows a **companion script** pattern:

1. Claude Code routes `/gemini:*` commands to markdown-defined skills
2. The `gemini-rescue` subagent forwards tasks to the companion script
3. `gemini-companion.mjs` spawns the Gemini CLI in headless mode (`gemini -p "..." -o text`)
4. Output is returned verbatim to Claude Code — no rewriting or summarization

Background jobs are tracked via state files in `.gemini-companion/` within the workspace.

## Review Prompts

The plugin ships with two review prompt templates:

- **Standard review** (`prompts/review.md`) — finds bugs, security issues, and quality problems
- **Adversarial review** (`prompts/adversarial-review.md`) — actively tries to break confidence in the change, focusing on failure modes, trust boundaries, and rollback safety

Both enforce grounding rules to prevent hallucinated findings.

## Why this exists

The [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) proved that delegating to a second model — for reviews, debugging, or just a fresh perspective — makes Claude Code meaningfully better. Gemini is often surprisingly good at catching things others miss, and having it available alongside Codex means you pick the right tool for the job.

This plugin was built in a Claude Code session, reviewed by Codex (7 issues found, all fixed), and self-reviewed by Gemini CLI. The architecture and plugin structure are directly adapted from the Codex plugin — full credit to the OpenAI team for the original design.

## License

MIT
