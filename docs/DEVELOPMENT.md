# Developing the plugin

This is for people hacking on the plugin itself — not end users who just want to install it.

## Three different copies of the plugin live on your disk

When Claude Code installs this plugin (via `/plugin marketplace add` + `/plugin install`), it stores three copies in three places:

```
~/.claude/plugins/marketplaces/google-gemini/                 # git clone of the GitHub repo
~/.claude/plugins/cache/google-gemini/gemini/<version>/       # active install — what the loader reads
~/.claude/plugins/installed_plugins.json                      # version + commit-sha record
```

If you `git clone` this repo elsewhere and edit it, **Claude Code does not see your edits** — it reads from the cache slot, not your clone. Bumping `plugin.json` version in your clone does nothing to the running instance until a `/plugin update` happens.

This bit me hard during 1.1.0 development. Documenting so it doesn't bite again.

## Fast iteration via symlink

The cleanest dev workflow is to replace the cache slot with a symlink to your working tree. Edits then go live immediately.

```bash
# Find your installed version
grep -A 4 "google-gemini" ~/.claude/plugins/installed_plugins.json | grep version

# Back up the real cache (keep this for rollback)
SLOT=~/.claude/plugins/cache/google-gemini/gemini/<installed-version>
mv "$SLOT" "$SLOT.bak"

# Symlink to your working tree
ln -s /path/to/your/clone/plugins/gemini "$SLOT"
```

Restore the backup before running `/plugin update` — the updater will not be friendly to a symlinked slot.

```bash
rm "$SLOT" && mv "$SLOT.bak" "$SLOT"
```

## Loader reload semantics

The single most important thing to know about the Claude Code plugin loader:

| Change | What you need to do |
|---|---|
| Edit content of an existing file (command body, agent body, skill, etc.) | `/reload-plugins` is sufficient |
| **Add a new file** (new command, new agent, new skill) | **Cold Claude Code session restart required** — `/reload-plugins` does NOT re-scan directories |
| Change `plugin.json` metadata | Cold restart |
| Re-version | Full `/plugin update` (or symlink replacement + restart) |

`/reload-plugins` reports a count summary (`6 plugins · 19 skills · 14 agents · 11 hooks`). If you've added a new command/agent file and that count doesn't change, that's the loader telling you it didn't pick up the new file. Open a fresh session.

This is genuinely surprising the first time. The loader caches its file enumeration at install / cold-start time keyed on the `installed_plugins.json` entry; `/reload-plugins` re-evaluates content from already-known files but does not re-scan directories for new entries.

## Tests

```bash
# Unit + helpers — no Gemini, no network. Always run.
node plugins/gemini/tests/run.mjs

# End-to-end — real Gemini calls, real auth, real cost.
node plugins/gemini/tests/run.mjs --tag=live
# or
GEMINI_E2E=1 node plugins/gemini/tests/run.mjs
```

Unit tests live in `plugins/gemini/tests/lib/*.test.mjs` and are deterministic (no I/O beyond temp dirs). E2e tests live in `plugins/gemini/tests/e2e/runtime.test.mjs` and drive the real Gemini binary.

See `plugins/gemini/tests/README.md` for what each tier covers and the conventions for adding new e2e cases (minimal prompts, default to `--read-only`, tag with `live`, scope writes to `mkdtempSync` dirs).

## Companion-script CLI

You can drive the runtime directly without going through Claude Code:

```bash
node plugins/gemini/scripts/gemini-companion.mjs help

# Quick smoke
node plugins/gemini/scripts/gemini-companion.mjs setup
node plugins/gemini/scripts/gemini-companion.mjs task --read-only "what is 2+2"
node plugins/gemini/scripts/gemini-companion.mjs execute --wait --no-sandbox "say hi"
node plugins/gemini/scripts/gemini-companion.mjs status
```

This is the primary way to debug / smoke-test runtime changes without involving the Claude Code plugin loader.

## Adding a new slash command / agent / skill

1. Create the file in the appropriate directory (`commands/`, `agents/`, `skills/`).
2. If you're using the symlink dev override, edits to existing files go live with `/reload-plugins`.
3. **For new files: open a fresh Claude Code session.** `/reload-plugins` will not surface them.
4. Verify in the new session via `/help` or by typing `/<plugin>:` and checking the autocomplete.

If a command file fails to load silently (count unchanged after cold start), check the frontmatter. The loader rejects:

- Unknown / deferred tools in `tools:` lists (e.g., `Monitor` is a deferred tool — its schema isn't available at agent parse time, and the loader silently rejects agents that reference it).
- Invalid YAML frontmatter (mismatched quotes, bad indent).
- BOM-prefixed UTF-8 or non-UTF-8 files.

When in doubt, byte-compare your new file's frontmatter to a known-good neighbor's.

## Codex / Gemini adversarial review

Per the project's work discipline, every code change goes through Codex (`/codex:adversarial-review` for steering, `/codex:review` for plain). For the Gemini plugin specifically, also running `/gemini:adversarial-review` against the change is appropriate — the plugin reviewing itself with the very tool it ships. Use both when the change touches the executor envelope, the routing rule, or anything safety-relevant.

When Codex or Gemini surfaces findings, cross out items only after fix AND test confirm them resolved. Don't paraphrase findings — return the reviewer's text verbatim and address point-by-point.
