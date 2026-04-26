# Open issues — gemini plugin streaming runtime

Branch: `feature/gemini-streaming-rich-runtime` (commits `a38b2fb`, `6c0ce21`, `5be1bb6`-ish — see `git log main..HEAD`).

The runtime, JSON parsing, streaming wrapper, heartbeat, retention, prompt-size guard, and test harness are all working — full automated suite passes 37/37 (28 unit + 9 live e2e against real Gemini). What is *not* working is making the new slash commands and the new agent visible inside a running Claude Code session. Picking up the work means solving discovery, not the runtime.

## What does work (verified)

- `node plugins/gemini/scripts/gemini-companion.mjs help` — all subcommands listed.
- `... task --read-only --json "..."` — JSON envelope parsed, usage/duration/model captured, stdout streamed to TTY in real time.
- `... task --background --read-only "..."` — wrapper writes log + state + prompt files, heartbeat updates every 5s, completion sets `status: completed|failed`.
- `... task --stream --read-only "..."` — `events.jsonl` is produced with valid NDJSON.
- `... tail <jobId>` — waits for terminal status (regression-tested against the early-exit bug Gemini caught).
- `... result <jobId>` — for streamed jobs uses `extractStreamJsonResponse` (regression-tested).
- `... status --prune` and `pruneJobs` — PID-aware, reaps zombies.
- `... review` and `... adversarial-review` — auto scope, oversize-diff chunking at 600 KB.
- `node plugins/gemini/tests/run.mjs` (unit) and `GEMINI_E2E=1 node plugins/gemini/tests/run.mjs` (live).

## What does not work (the actual blockers)

### 1. `/gemini:rescue-stream` is not recognized in Claude Code

**Symptom:** `Unknown command: /gemini:rescue-stream` even after `/reload-plugins` reports success ("5 plugins · 15 skills · 7 agents · 9 hooks").

**What was tried and failed:**

- Created `plugins/gemini/commands/rescue-stream.md` with frontmatter mirroring `rescue.md`. Reloaded — not seen.
- Removed `Monitor` from `allowed-tools` (claude-code-guide subagent's hypothesis was that conditional/deferred tools cause silent rejection at load). Reloaded — still not seen.
- Bumped plugin version to `1.1.0` in both `plugin.json` and `marketplace.json`. Reloaded — still not seen.
- Confirmed the file is on disk, UTF-8 with no BOM, mode `0644`, frontmatter byte-identical to `rescue.md` for the first 7 lines.
- Created a brand-new `commands/probe.md` (exact `cancel.md` shape) to test whether *any* newly added command appears after reload. **Test was not completed** — the user pivoted before the probe was checked. **Run the probe first when picking this up.**

**Likely root causes (untested):**

- `/reload-plugins` may only re-read files it discovered on initial scan, not files added after that scan. A full Claude Code restart would be the next thing to try.
- Plugin command names may need to be enumerated somewhere (in `plugin.json` or a manifest) — current `plugin.json` only carries metadata. claude-code-guide said discovery is automatic; that may be wrong or version-dependent.
- The `commands/` directory may need a marker / index file we don't have.

**Probe still on disk:** `plugins/gemini/commands/probe.md` — declares `/gemini:probe`. Run `/reload-plugins`, try `/gemini:probe`. If unknown → `/reload-plugins` doesn't pick up new files (restart Claude Code). If recognized → there is something specific to `rescue-stream.md` causing rejection (re-bisect by pruning the body progressively).

Delete `probe.md` once the diagnosis is settled.

### 2. `gemini-rescue-stream` agent: not yet exercised inside Claude Code

The agent file at `plugins/gemini/agents/gemini-rescue-stream.md` declares `tools: Bash, Monitor, Read`. Even if the command is fixed and the agent loads, the contract assumes Claude can `Monitor` the events file. We have **no evidence** that:

- `Monitor` is actually accepted in agent `tools:` lists in this Claude Code build,
- attaching `Monitor` to `events.jsonl` produces useful per-line notifications,
- Gemini's `stream-json` event types (`init`, `message`, `complete`, possibly `tool_use`) come through cleanly enough to drive Claude's reactions.

If `Monitor` turns out to be unavailable or unreliable, the streaming agent should be rewritten to use `Bash run_in_background` plus periodic `BashOutput` reads of `tail -f` or `node ... tail <jobId>`. That is the more portable path and doesn't depend on a deferred tool.

### 3. Tier 3 streaming UX is unobserved end-to-end

Even ignoring discovery, no one has actually run `/gemini:rescue-stream --read-only ...` from Claude Code and watched what surfaces. The notion that streaming events will read better than a single blob is theoretical until someone tries it on a real long-running Gemini job.

### 4. Documentation gaps still open

- Repo root `README.md` is unchanged — does not mention `--read-only`, `--stream`, the new commands, the test harness, or the heartbeat/prune behaviour.
- No CHANGELOG / upgrade notes.
- No troubleshooting section for common Gemini failures (`MODEL_CAPACITY_EXHAUSTED`, missing auth, binary not on PATH).
- No diagram / decision rule for picking `/gemini:rescue` vs `/gemini:rescue-stream` outside the one sentence at the top of each command file.

### 5. Real >600 KB review path never exercised

`runChunkedReview` is unit-tested via small fixtures only. A real giant diff has not been thrown at it.

## Files of interest if picking this up

- `plugins/gemini/commands/rescue-stream.md` — the command that won't load.
- `plugins/gemini/agents/gemini-rescue-stream.md` — the agent the command would dispatch to.
- `plugins/gemini/commands/probe.md` — diagnostic probe (delete after diagnosis).
- `plugins/gemini/scripts/gemini-companion.mjs` — runtime, all subcommands.
- `plugins/gemini/scripts/lib/background-runner.mjs` — detached wrapper.
- `plugins/gemini/scripts/lib/gemini.mjs` — JSON envelope + stream-line parsers.
- `plugins/gemini/tests/README.md` — how to run the suites.
- `.claude-plugin/marketplace.json`, `plugins/gemini/.claude-plugin/plugin.json` — plugin metadata.

## CONFIRMED — full Claude Code restart did NOT fix it

Update from the user (2026-04-26): a brand new Claude Code session does not see `/gemini:rescue-stream` either. So the "maybe `/reload-plugins` doesn't pick up new files, restart will fix it" hypothesis is **wrong**. The command is rejected by the plugin loader for a reason that is not yet understood.

This means at least one of the following is true and untested by the assistant:

- New `commands/*.md` files require some registration step beyond just being on disk (a manifest entry, an explicit list, a generated index).
- The loader has an undocumented filename / naming rule that `rescue-stream.md` violates (hyphen? length? collision with a sibling whose stem is a prefix of this one?).
- The loader has a per-plugin command count cap, an alphabetical / ordering quirk, or some other constraint not surfaced in the docs.
- The plugin was installed from a different copy than this working tree, so changes here are landing on a path Claude Code is not reading. **Verify which directory the active gemini plugin is loaded from before doing anything else.**

The assistant's previous suggestions (`/plugin reload`, `/reload-plugins`, restart, version bump, removing `Monitor` from `allowed-tools`) were guesses based on docs the assistant had not verified against the actual loader. None of them solved the problem. **Treat the assistant's prior plugin/command discovery advice as unreliable and start from scratch on this question.**

## What to actually do when picking this up

1. **Find where Claude Code is loading the gemini plugin from.** Likely candidates: `~/.claude/plugins/`, `~/Library/Application Support/Claude/plugins/`, a symlink under `~/.claude-plugins/`, or the marketplace path inside this repo. `find ~ -name marketplace.json 2>/dev/null` is a starting point. Until this is known, *no* file edit in this repo is guaranteed to be observed by Claude Code.
2. **Inspect the running plugin's actual `commands/` directory.** Compare to this repo's `plugins/gemini/commands/`. If they differ, that explains everything — the install is stale.
3. **If the install is stale**, figure out the right way to install/update a plugin from a local source for this Claude Code build. Reinstall, then check.
4. **Only after `/gemini:rescue-stream` actually surfaces** is it worth touching the agent contract, the README, the >600 KB review path, or anything else. Until then, the runtime is unreachable from Claude Code regardless of how good it is.

The runtime code itself (everything under `plugins/gemini/scripts/`) is solid and tested. The discovery / installation problem is independent of the runtime and needs someone who actually knows this Claude Code build's plugin model.
