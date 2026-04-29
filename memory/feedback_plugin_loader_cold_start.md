---
name: Plugin loader requires cold start to discover new files
description: For Claude Code plugin development, /reload-plugins does not pick up newly added files (commands, agents). Only a fresh process start re-enumerates the plugin directory.
type: feedback
originSessionId: ba10b55d-2a9b-44ec-ba01-32c476334467
---
When developing a Claude Code plugin and you add a new file (`commands/foo.md`, `agents/bar.md`, etc.), `/reload-plugins` will NOT make it discoverable. The reload only refreshes content of files the loader already knows about. To get new files registered, start a new Claude Code session (`cmd+Q` desktop or fully exit CLI, then reopen).

**Why:** Claude Code's plugin loader caches the file enumeration at install time / cold-start time, keyed on the entry in `~/.claude/plugins/installed_plugins.json`. `/reload-plugins` re-evaluates known files but does not re-scan directories. Verified 2026-04-29 against the gemini plugin: three reload cycles produced identical "6 plugins · 19 skills · 14 agents · 11 hooks" output even after adding `commands/probe.md`, `commands/rescue-stream.md`, and `agents/gemini-rescue-stream.md` to the install path. A fresh session immediately surfaced all three.

**How to apply:**
- Adding new commands/agents/skills to a plugin under development → tell the user a fresh session is required to test. `/reload-plugins` is not sufficient.
- Editing existing files (frontmatter, body) → `/reload-plugins` works fine; cold start not needed.
- Symlinking the cache slot to a working tree gets you live edits to existing files without `/plugin update`, but newly added files still need a cold start.
- The proper install path (`/plugin marketplace add <local-path>` + `/plugin install`) avoids cache-slot hacks but still requires cold start when adding new files.
