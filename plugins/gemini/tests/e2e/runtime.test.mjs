// End-to-end tests against the *real* Gemini CLI.
//
// Cost note: every test case here makes one or more real Gemini API calls.
// Prompts are kept under ~50 tokens of response and use --read-only by default
// so nothing is written to disk. Skip by default; opt in with `--tag=live` or
// `GEMINI_E2E=1`.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..", "..");
const COMPANION = path.join(PLUGIN_ROOT, "scripts", "gemini-companion.mjs");

function runCompanion(args, { cwd, timeoutMs = 120_000 } = {}) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    cwd: cwd ?? process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "calc.js"), "function add(a, b) {\n  return a + b;\n}\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function waitFor(predicate, { timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try { if (predicate()) return resolve(); } catch { /* swallow */ }
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const LIVE = { tags: ["live"] };

export default function (t) {
  // ─── Setup probe ───
  t.test("setup reports gemini installed and authenticated", () => {
    const result = runCompanion(["setup", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.gemini.available, true, "gemini binary missing — install before running e2e");
    assert.equal(report.auth.authenticated, true, "gemini not authenticated — run `gemini` interactively first");
  }, LIVE);

  // ─── Foreground task ───
  t.test("foreground task --read-only returns Gemini's response and parses JSON usage", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-fg-"));
    const result = runCompanion(["task", "--read-only", "--json", "Reply with exactly the word: pong"], { cwd });
    assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.parsed, "expected parsed JSON envelope from Gemini");
    assert.match(payload.parsed.response.toLowerCase(), /pong/);
    assert.ok(payload.parsed.usage, "expected token usage in parsed envelope");
    assert.ok(payload.parsed.usage.total > 0, "expected usage.total > 0");
    assert.ok(payload.parsed.model, "expected model name");
  }, LIVE);

  // ─── Background task ───
  t.test("background task — runner produces log + state, status reaches completed", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-bg-"));
    const launch = runCompanion(["task", "--background", "--read-only", "Reply with exactly: ready"], { cwd });
    assert.equal(launch.status, 0, launch.stderr);
    const jobId = (launch.stdout.match(/task-[a-z0-9-]+/) ?? [])[0];
    assert.ok(jobId, `no jobId in: ${launch.stdout}`);

    const stateFile = path.join(cwd, ".gemini-companion", "logs", `${jobId}.state.json`);
    await waitFor(() => {
      if (!fs.existsSync(stateFile)) return false;
      const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return s.status === "completed" || s.status === "failed";
    });

    const status = runCompanion(["status", jobId], { cwd });
    assert.match(status.stdout, /Status.*(completed|failed)/);

    const stateRaw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.ok(stateRaw.lastHeartbeatAt, "heartbeat should have been written at least once");
    assert.ok(stateRaw.completedAt, "completion timestamp expected");

    const result = runCompanion(["result", jobId], { cwd });
    assert.match(result.stdout.toLowerCase(), /ready/);
  }, LIVE);

  // ─── Streaming background ───
  t.test("background --stream — events.jsonl receives stream-json events with type field", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-stream-"));
    const launch = runCompanion(["task", "--stream", "--read-only", "Reply with: streaming ok"], { cwd });
    assert.equal(launch.status, 0, launch.stderr);
    const jobId = (launch.stdout.match(/task-[a-z0-9-]+/) ?? [])[0];
    assert.ok(jobId, launch.stdout);

    const eventsFile = path.join(cwd, ".gemini-companion", "logs", `${jobId}.events.jsonl`);
    const stateFile = path.join(cwd, ".gemini-companion", "logs", `${jobId}.state.json`);

    await waitFor(() => {
      if (!fs.existsSync(stateFile)) return false;
      const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return s.status === "completed" || s.status === "failed";
    }, { timeoutMs: 180_000 });

    assert.ok(fs.existsSync(eventsFile), "events.jsonl was not produced");
    const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
    assert.ok(lines.length > 0, "events file is empty");
    const events = lines.map((l) => {
      try { return JSON.parse(l); } catch { return { type: "unparsed", raw: l }; }
    });
    const types = new Set(events.map((e) => e.type));
    assert.ok(types.has("init") || types.has("message"), `expected init or message events, got: ${[...types].join(",")}`);
  }, LIVE);

  // ─── Review on a real diff ───
  t.test("review picks up a working-tree diff and returns Gemini findings", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "calc.js"),
      "function add(a, b) {\n  // returns sum\n  return a + b\n}\n"); // missing semicolon
    const result = runCompanion(["review"], { cwd: repo });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /## Gemini Review/);
    assert.ok(result.stdout.length > 100, `review output suspiciously short: ${result.stdout}`);
  }, LIVE);

  t.test("review on a clean repo says there is nothing to review", () => {
    const repo = makeRepo();
    const result = runCompanion(["review"], { cwd: repo });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Nothing to review|No changes/);
  }, LIVE);

  // ─── Tail respects terminal status, not file existence ───
  t.test("tail waits for terminal status before exiting (regression)", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-tail-"));
    const launch = runCompanion(["task", "--background", "--read-only", "Reply with: tailed"], { cwd });
    assert.equal(launch.status, 0, launch.stderr);
    const jobId = (launch.stdout.match(/task-[a-z0-9-]+/) ?? [])[0];

    // Spawn tail and capture its full output. It should NOT exit immediately
    // (the wrapper writes the state file at startup with status:"running").
    const start = Date.now();
    const tail = spawnSync(process.execPath, [COMPANION, "tail", jobId], {
      cwd, env: process.env, encoding: "utf8", timeout: 180_000
    });
    const elapsed = Date.now() - start;
    assert.equal(tail.status, 0, tail.stderr);
    assert.ok(elapsed > 1500, `tail returned in ${elapsed}ms — too fast, likely the early-exit bug`);
    assert.match(tail.stdout, /\[job (completed|failed)\]/);
  }, LIVE);

  // ─── Result for streamed jobs ───
  t.test("result on a stream-json job returns the final response (regression)", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-streamres-"));
    const launch = runCompanion(["task", "--stream", "--read-only", "Reply with exactly: streamresult"], { cwd });
    const jobId = (launch.stdout.match(/task-[a-z0-9-]+/) ?? [])[0];
    const stateFile = path.join(cwd, ".gemini-companion", "logs", `${jobId}.state.json`);
    await waitFor(() => {
      if (!fs.existsSync(stateFile)) return false;
      const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return s.status === "completed" || s.status === "failed";
    }, { timeoutMs: 180_000 });

    const result = runCompanion(["result", jobId], { cwd });
    assert.equal(result.status, 0, result.stderr);
    // Must NOT be empty (the regression Gemini flagged: parser was returning "").
    const idx = result.stdout.indexOf("\n\n");
    const body = idx >= 0 ? result.stdout.slice(idx + 2) : result.stdout;
    assert.ok(body.trim().length > 0, `result body empty: ${result.stdout}`);
    assert.match(result.stdout.toLowerCase(), /streamresult/);
  }, LIVE);

  // ─── Cancel ───
  t.test("cancel terminates a running background job", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-e2e-cancel-"));
    const launch = runCompanion(["task", "--background", "--read-only",
      "Take a moment then reply with a single sentence about the colour blue."], { cwd });
    assert.equal(launch.status, 0, launch.stderr);
    const jobId = (launch.stdout.match(/task-[a-z0-9-]+/) ?? [])[0];

    // Give the wrapper a moment to spawn its child.
    await new Promise((r) => setTimeout(r, 1500));
    const cancel = runCompanion(["cancel", jobId], { cwd });
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.match(cancel.stdout, /Cancelled/);
  }, LIVE);
}
