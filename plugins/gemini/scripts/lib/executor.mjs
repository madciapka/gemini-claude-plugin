// Pure helpers for the executor delegation surface.
//
// Stays free of node:fs/process side effects so the unit tests can exercise
// envelope assembly and handoff parsing without filesystem fixtures.

import fs from "node:fs";
import path from "node:path";

const HANDOFF_MARKER = /^HANDOFF:\s*(.+?)\s*$/m;
const PLACEHOLDER_RE = /\{\{([A-Z0-9_]+)\}\}/g;

// Render the executor envelope in a single regex pass so that values inserted
// for one placeholder cannot be re-evaluated on a later pass. A previous
// implementation used sequential `replaceAll` calls which could leak: if a
// system value (e.g. `CWD`) contained the literal string `{{TASK}}`, that
// literal would be substituted with the user's task on the final pass,
// injecting user text into the system section. Single-pass replacement
// eliminates the re-evaluation surface entirely.
export function renderExecutorEnvelope(template, systemVars, taskText) {
  if (Object.prototype.hasOwnProperty.call(systemVars, "TASK")) {
    throw new Error("TASK must be passed as the third argument, not in systemVars");
  }
  const lookup = { ...systemVars, TASK: String(taskText) };
  return String(template).replace(PLACEHOLDER_RE, (match, key) => {
    return Object.prototype.hasOwnProperty.call(lookup, key) ? String(lookup[key]) : match;
  });
}

// Parse the user's task argument. If it's a `@path` reference (or `read:path`),
// the prompt instructs Gemini to load the plan from disk; the inline task text
// is replaced with a directive to read it. Otherwise the task text passes
// through verbatim.
export function resolveTaskInput(rawTask) {
  const trimmed = rawTask.trim();
  if (!trimmed) {
    throw new Error("execute requires a task description or @path/to/plan.md");
  }
  const planMatch = trimmed.match(/^(?:@|read:)([^\s]+)(?:\s+(.+))?$/);
  if (planMatch) {
    const planPath = planMatch[1];
    const extra = planMatch[2]?.trim();
    const lines = [
      `Read the plan at \`${planPath}\` and execute it.`,
      "The file is the source of truth for goals, scope, constraints, and acceptance criteria — this prompt is only the wrapper.",
      extra ? `Additional context from the orchestrator: ${extra}` : null
    ].filter(Boolean);
    return { mode: "plan-file", planPath, taskText: lines.join("\n") };
  }
  return { mode: "inline", planPath: null, taskText: trimmed };
}

// Validate that a `@path` plan reference stays inside the workspace and uses
// only safe characters. Path traversal, absolute paths to outside the
// workspace, shell/format-breaking characters, and SYMLINKS escaping the
// workspace are rejected. The plan path is never passed to a shell — it only
// goes into the prompt — but those characters can mangle the prompt's
// backtick-quoted block, and a hostile repo could plant a symlink (`docs -> /`)
// that defeats lexical containment checks.
export function validatePlanPath(planPath, workspaceRoot, { fsImpl = fs } = {}) {
  if (!planPath) throw new Error("planPath required");
  if (!workspaceRoot) throw new Error("workspaceRoot required");
  if (/[`$"]/.test(planPath)) {
    throw new Error(`plan path contains unsafe characters: ${planPath}`);
  }
  const lexicalResolved = path.resolve(workspaceRoot, planPath);
  const lexicalRoot = path.resolve(workspaceRoot);
  if (lexicalResolved !== lexicalRoot && !lexicalResolved.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new Error(`plan path escapes workspace: ${planPath}`);
  }
  // Defeat hostile symlinks. Lexical containment can be bypassed by a repo
  // containing `docs -> /`; realpath canonicalizes against the on-disk inode
  // graph. If the path doesn't exist yet we fall back to lexical (the file
  // not existing is its own failure mode and Gemini will surface it).
  let canonicalResolved = lexicalResolved;
  let canonicalRoot = lexicalRoot;
  try {
    canonicalResolved = fsImpl.realpathSync(lexicalResolved);
  } catch { /* path doesn't exist — let Gemini fail naturally */ }
  try {
    canonicalRoot = fsImpl.realpathSync(lexicalRoot);
  } catch { /* should not happen for an existing workspace */ }
  if (canonicalResolved !== canonicalRoot && !canonicalResolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`plan path escapes workspace via symlink: ${planPath}`);
  }
  return canonicalResolved;
}

// Build the path where Gemini should write its handoff file. Co-located with
// other Claude Code session artifacts so the user (or Claude in a follow-up
// session) finds them in one place.
export function buildHandoffPath({ workspaceRoot, jobId, date }) {
  if (!workspaceRoot) throw new Error("workspaceRoot required");
  if (!jobId) throw new Error("jobId required");
  const day = date ?? new Date().toISOString().slice(0, 10);
  const shortId = jobIdToShort(jobId);
  return `${workspaceRoot.replace(/\/$/, "")}/.claude/handoffs/SESSION_HANDOFF_${day}_gemini_${shortId}.md`;
}

export function jobIdToShort(jobId) {
  // Job ids look like `execute-mn123abc-deadbe`. Take the trailing rand chunk
  // for a stable short identifier — same length whether prefix changes or not.
  const parts = String(jobId).split("-");
  return parts[parts.length - 1] || String(jobId).slice(-6);
}

// Pull the `HANDOFF: <path>` marker out of Gemini's stdout. Returns null if
// Gemini didn't emit one (which is itself a failure signal — the agent should
// surface "no handoff marker found").
export function extractHandoffPath(stdout) {
  if (!stdout) return null;
  const match = String(stdout).match(HANDOFF_MARKER);
  return match ? match[1] : null;
}

// Validate the handoff marker Gemini emitted. The marker must (a) be present,
// (b) match the precomputed handoff path the wrapper handed to Gemini, and
// (c) point inside the expected `.claude/handoffs/` subdirectory of the
// workspace. Returns { ok, reason, extracted } so the caller can surface a
// useful warning without throwing.
export function validateHandoffMarker(stdout, expectedPath, workspaceRoot) {
  const extracted = extractHandoffPath(stdout);
  if (!extracted) {
    return { ok: false, reason: "no HANDOFF marker in Gemini output", extracted: null };
  }
  if (extracted !== expectedPath) {
    return { ok: false, reason: `marker path \`${extracted}\` does not match expected \`${expectedPath}\``, extracted };
  }
  if (workspaceRoot) {
    const expectedDir = `${path.resolve(workspaceRoot)}/.claude/handoffs/`;
    if (!path.resolve(extracted).startsWith(expectedDir)) {
      return { ok: false, reason: `marker path escapes ${expectedDir}`, extracted };
    }
  }
  return { ok: true, reason: null, extracted };
}
