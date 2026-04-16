# Plan: Implement Codex Plugin for Gemini CLI

Create a "like for like" implementation of the `codex-plugin-cc` for Gemini CLI, allowing Gemini to delegate tasks (reviews, rescue) to the `codex` CLI.

## Objective
- Enable Gemini CLI to call the `codex` command as a helper.
- Provide slash commands: `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:status`, `/codex:result`, and `/codex:cancel`.
- Implement a `codex-rescue` sub-agent for autonomous delegation.

## Key Files & Context
- **Existing Reference**: `plugins/gemini/` (architecture to mirror)
- **New Plugin Root**: `plugins/codex/`
- **Skill**: `plugins/codex/skills/codex-cli-runtime/SKILL.md`
- **Sub-agent**: `plugins/codex/agents/codex-rescue.md`
- **Companion Script**: `plugins/codex/scripts/codex-companion.mjs`

## Implementation Steps

### 1. Project Scaffolding
- Create `plugins/codex` directory structure.
- Copy and adapt `.claude-plugin/plugin.json` for Codex.
- Create `plugins/codex/scripts/lib/` by linking or copying the shared logic from `plugins/gemini/scripts/lib/`.

### 2. Codex Companion Script
- Implement `plugins/codex/scripts/codex-companion.mjs`.
- Wrap the `codex` binary (review, task, etc.).
- Mirror the job management (background tasks) from the Gemini companion.

### 3. Gemini CLI Skill & Sub-agent
- Create `plugins/codex/skills/codex-cli-runtime/SKILL.md`.
- Define how Gemini should use the `codex-companion.mjs` to delegate work.
- Create `plugins/codex/agents/codex-rescue.md` to define the Codex helper persona.

### 4. Commands & Prompts
- Create `/codex:*` command files in `plugins/codex/commands/`.
- Create review and adversarial-review prompts in `plugins/codex/prompts/`.

### 5. Integration
- Ensure the `codex-cli-runtime` skill is discoverable.
- Test the delegation flow from Gemini CLI -> Codex.

## Verification & Testing
- Run `/codex:review` and verify it uses the local `codex` binary.
- Ask Gemini CLI to "Ask Codex to review my recent changes" and verify it triggers the sub-agent.
- Verify background jobs work via `/codex:status` and `/codex:result`.
