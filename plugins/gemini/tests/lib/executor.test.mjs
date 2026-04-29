import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderExecutorEnvelope,
  resolveTaskInput,
  validatePlanPath,
  buildHandoffPath,
  jobIdToShort,
  extractHandoffPath,
  validateHandoffMarker
} from "../../scripts/lib/executor.mjs";

export default function (t) {
  t.test("renderExecutorEnvelope substitutes system vars and TASK separately", () => {
    const tpl = "cwd={{CWD}} task={{TASK}} short={{JOB_SHORT_ID}} hand={{HANDOFF_PATH}}";
    const out = renderExecutorEnvelope(
      tpl,
      { CWD: "/tmp/proj", JOB_SHORT_ID: "ab12cd", HANDOFF_PATH: "/x/h.md" },
      "do thing"
    );
    assert.equal(out, "cwd=/tmp/proj task=do thing short=ab12cd hand=/x/h.md");
  });

  t.test("renderExecutorEnvelope replaces every occurrence of a key", () => {
    const tpl = "{{X}} and {{X}} again";
    assert.equal(renderExecutorEnvelope(tpl, { X: "foo" }, ""), "foo and foo again");
  });

  t.test("renderExecutorEnvelope is single-pass: user task containing {{X}} literals appears verbatim", () => {
    const tpl = "system: {{HANDOFF_PATH}} | user: {{TASK}}";
    // User task contains a literal {{HANDOFF_PATH}} string. Single-pass regex
    // substitution must NOT re-scan the substituted user text — that literal
    // appears as-is in the output.
    const out = renderExecutorEnvelope(
      tpl,
      { HANDOFF_PATH: "/real/path.md" },
      "I want to write to {{HANDOFF_PATH}} myself"
    );
    assert.equal(out, "system: /real/path.md | user: I want to write to {{HANDOFF_PATH}} myself");
  });

  t.test("renderExecutorEnvelope is single-pass: system var containing {{TASK}} does not inject user text", () => {
    // Adversarial: CWD evaluates to a path that contains the literal `{{TASK}}`.
    // Sequential replaceAll would substitute CWD first (embedding `{{TASK}}` into
    // the system section), then replace that literal with the user's task text
    // on the next pass. Single-pass regex substitution must reject this leak.
    const tpl = "cwd={{CWD}} | task={{TASK}}";
    const out = renderExecutorEnvelope(
      tpl,
      { CWD: "/path/to/{{TASK}}" },
      "real-user-task"
    );
    assert.equal(out, "cwd=/path/to/{{TASK}} | task=real-user-task");
  });

  t.test("renderExecutorEnvelope leaves unknown placeholders as literals", () => {
    // The single-pass regex matches any uppercase placeholder shape, but the
    // lookup falls back to the raw match for unknown keys.
    const out = renderExecutorEnvelope("{{UNKNOWN_KEY}} stays", {}, "");
    assert.equal(out, "{{UNKNOWN_KEY}} stays");
  });

  t.test("renderExecutorEnvelope rejects TASK in systemVars (forces correct API)", () => {
    assert.throws(
      () => renderExecutorEnvelope("x", { TASK: "no" }, ""),
      /TASK must be passed as the third argument/
    );
  });

  t.test("resolveTaskInput inline mode preserves text verbatim", () => {
    const r = resolveTaskInput("  implement closing-window helper  ");
    assert.equal(r.mode, "inline");
    assert.equal(r.planPath, null);
    assert.equal(r.taskText, "implement closing-window helper");
  });

  t.test("resolveTaskInput @path mode rewrites task to a read directive", () => {
    const r = resolveTaskInput("@docs/plan.md");
    assert.equal(r.mode, "plan-file");
    assert.equal(r.planPath, "docs/plan.md");
    assert.match(r.taskText, /Read the plan at `docs\/plan\.md`/);
    assert.match(r.taskText, /source of truth/);
  });

  t.test("resolveTaskInput @path with extra context appends it", () => {
    const r = resolveTaskInput("@docs/plan.md focus on the validation pass");
    assert.equal(r.mode, "plan-file");
    assert.equal(r.planPath, "docs/plan.md");
    assert.match(r.taskText, /focus on the validation pass/);
    assert.match(r.taskText, /Additional context from the orchestrator/);
  });

  t.test("resolveTaskInput supports read: prefix as alias for @", () => {
    const r = resolveTaskInput("read:plans/r3.md");
    assert.equal(r.mode, "plan-file");
    assert.equal(r.planPath, "plans/r3.md");
  });

  t.test("resolveTaskInput rejects empty input", () => {
    assert.throws(() => resolveTaskInput(""), /requires a task/);
    assert.throws(() => resolveTaskInput("   "), /requires a task/);
  });

  t.test("buildHandoffPath uses .claude/handoffs/ and date+short-id", () => {
    const p = buildHandoffPath({
      workspaceRoot: "/Users/me/proj",
      jobId: "execute-mn123abc-deadbe",
      date: "2026-04-29"
    });
    assert.equal(p, "/Users/me/proj/.claude/handoffs/SESSION_HANDOFF_2026-04-29_gemini_deadbe.md");
  });

  t.test("buildHandoffPath strips trailing slash from workspaceRoot", () => {
    const p = buildHandoffPath({
      workspaceRoot: "/Users/me/proj/",
      jobId: "execute-x-y-abc123",
      date: "2026-04-29"
    });
    assert.equal(p, "/Users/me/proj/.claude/handoffs/SESSION_HANDOFF_2026-04-29_gemini_abc123.md");
  });

  t.test("buildHandoffPath defaults date to today (UTC)", () => {
    const p = buildHandoffPath({
      workspaceRoot: "/Users/me/proj",
      jobId: "execute-x-y-aaaaaa"
    });
    const today = new Date().toISOString().slice(0, 10);
    assert.match(p, new RegExp(`SESSION_HANDOFF_${today}_gemini_aaaaaa\\.md$`));
  });

  t.test("buildHandoffPath requires workspaceRoot and jobId", () => {
    assert.throws(() => buildHandoffPath({ jobId: "x" }), /workspaceRoot/);
    assert.throws(() => buildHandoffPath({ workspaceRoot: "/x" }), /jobId/);
  });

  t.test("jobIdToShort takes trailing hex chunk", () => {
    assert.equal(jobIdToShort("execute-mn123abc-deadbe"), "deadbe");
    assert.equal(jobIdToShort("task-foo-bar-baz"), "baz");
    assert.equal(jobIdToShort("plain"), "plain");
  });

  t.test("extractHandoffPath finds the marker in mixed output", () => {
    const stdout = [
      "doing things",
      "more output",
      "HANDOFF: /Users/me/proj/.claude/handoffs/SESSION_HANDOFF_2026-04-29_gemini_deadbe.md",
      "trailing line"
    ].join("\n");
    assert.equal(
      extractHandoffPath(stdout),
      "/Users/me/proj/.claude/handoffs/SESSION_HANDOFF_2026-04-29_gemini_deadbe.md"
    );
  });

  t.test("extractHandoffPath returns null when marker missing", () => {
    assert.equal(extractHandoffPath("no marker here"), null);
    assert.equal(extractHandoffPath(""), null);
    assert.equal(extractHandoffPath(null), null);
  });

  t.test("extractHandoffPath trims surrounding whitespace", () => {
    const out = "HANDOFF:    /tmp/h.md   ";
    assert.equal(extractHandoffPath(out), "/tmp/h.md");
  });

  t.test("validatePlanPath accepts paths inside the workspace", () => {
    const root = "/Users/me/proj";
    assert.equal(validatePlanPath("docs/plan.md", root), "/Users/me/proj/docs/plan.md");
    assert.equal(validatePlanPath("./docs/plan.md", root), "/Users/me/proj/docs/plan.md");
  });

  t.test("validatePlanPath rejects ../ escape attempts", () => {
    assert.throws(
      () => validatePlanPath("../../etc/passwd", "/Users/me/proj"),
      /escapes workspace/
    );
  });

  t.test("validatePlanPath rejects absolute paths outside workspace", () => {
    assert.throws(
      () => validatePlanPath("/etc/passwd", "/Users/me/proj"),
      /escapes workspace/
    );
  });

  t.test("validatePlanPath rejects backtick / dollar-sign / quote characters", () => {
    const root = "/Users/me/proj";
    assert.throws(() => validatePlanPath("docs/`evil`.md", root), /unsafe characters/);
    assert.throws(() => validatePlanPath("docs/$evil.md", root), /unsafe characters/);
    assert.throws(() => validatePlanPath('docs/"evil".md', root), /unsafe characters/);
  });

  t.test("validatePlanPath requires both arguments", () => {
    assert.throws(() => validatePlanPath("", "/x"), /planPath required/);
    assert.throws(() => validatePlanPath("docs/x.md", ""), /workspaceRoot required/);
  });

  t.test("validatePlanPath rejects symlinks that escape the workspace", () => {
    // Real filesystem fixture: workspace contains `escape -> /tmp`, then the
    // user references `@escape/passwd`. Lexical containment passes (path is
    // workspace/escape/passwd) but realpath canonicalizes to /tmp/passwd which
    // is outside the workspace.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-execlink-"));
    try {
      const ws = fs.mkdtempSync(path.join(tmp, "ws-"));
      const outside = fs.mkdtempSync(path.join(tmp, "outside-"));
      fs.writeFileSync(path.join(outside, "passwd"), "secret");
      fs.symlinkSync(outside, path.join(ws, "escape"));
      assert.throws(
        () => validatePlanPath("escape/passwd", ws),
        /escapes workspace via symlink/
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t.test("validatePlanPath accepts symlinks that resolve inside workspace", () => {
    // A symlink pointing back into the workspace is fine.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-execlink-"));
    try {
      const ws = fs.mkdtempSync(path.join(tmp, "ws-"));
      const real = path.join(ws, "real-docs");
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, "plan.md"), "plan");
      fs.symlinkSync(real, path.join(ws, "docs"));
      const resolved = validatePlanPath("docs/plan.md", ws);
      assert.equal(resolved, fs.realpathSync(path.join(real, "plan.md")));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t.test("validatePlanPath tolerates non-existent paths (lexical fallback)", () => {
    // Plan path that doesn't exist yet — realpath fails, fallback to lexical
    // check. The path is still accepted because lexical containment passes.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-execlink-"));
    try {
      const ws = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "ws-")));
      const resolved = validatePlanPath("not-yet-created.md", ws);
      assert.equal(resolved, path.join(ws, "not-yet-created.md"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t.test("validateHandoffMarker accepts marker matching expected path under .claude/handoffs/", () => {
    const stdout = "HANDOFF: /Users/me/proj/.claude/handoffs/SESSION_HANDOFF_2026-04-29_gemini_abc123.md";
    const expected = "/Users/me/proj/.claude/handoffs/SESSION_HANDOFF_2026-04-29_gemini_abc123.md";
    const r = validateHandoffMarker(stdout, expected, "/Users/me/proj");
    assert.equal(r.ok, true);
    assert.equal(r.extracted, expected);
  });

  t.test("validateHandoffMarker fails when no marker present", () => {
    const r = validateHandoffMarker("nothing here", "/x/h.md", "/x");
    assert.equal(r.ok, false);
    assert.match(r.reason, /no HANDOFF marker/);
    assert.equal(r.extracted, null);
  });

  t.test("validateHandoffMarker fails when marker path does not match expected", () => {
    const stdout = "HANDOFF: /tmp/elsewhere.md";
    const r = validateHandoffMarker(stdout, "/x/.claude/handoffs/h.md", "/x");
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not match expected/);
    assert.equal(r.extracted, "/tmp/elsewhere.md");
  });

  t.test("validateHandoffMarker fails when marker escapes workspace handoffs dir", () => {
    // Marker matches expected literally, but expected itself is outside the
    // handoffs dir. Defends against a malformed handoff config or a hostile
    // workspaceRoot.
    const stdout = "HANDOFF: /tmp/elsewhere.md";
    const r = validateHandoffMarker(stdout, "/tmp/elsewhere.md", "/Users/me/proj");
    assert.equal(r.ok, false);
    assert.match(r.reason, /escapes/);
  });
}
