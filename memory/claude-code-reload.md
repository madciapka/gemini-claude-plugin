---
name: Claude Code plugin reload command
description: The slash command to reload plugins/skills/agents/hooks in a running Claude Code session is /reload-plugins (not /plugin reload).
type: reference
---

The slash command to refresh plugin state in a running Claude Code session is `/reload-plugins`. It reloads plugins, skills, agents, hooks, and plugin MCP/LSP servers in place — no restart needed.

Why this matters: I previously suggested `/plugin reload` as the way to pick up new commands/agents after editing a plugin's files. That command does not exist. The user corrected this.

How to apply: When a user has just added or modified plugin files (commands/, agents/, skills/, hooks, plugin.json) and a slash command appears as "Unknown command", the correct first suggestion is `/reload-plugins`. Only suggest a full Claude Code restart if `/reload-plugins` doesn't surface the change.
