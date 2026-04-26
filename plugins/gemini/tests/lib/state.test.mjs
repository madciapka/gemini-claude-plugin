import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateJobId,
  writeJobFile,
  upsertJob,
  loadJobIndex,
  pruneJobs,
  logsDir,
  deleteJobArtifacts
} from "../../scripts/lib/state.mjs";

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-state-"));
}

export default function (t) {
  t.test("generateJobId returns prefixed unique ids", () => {
    const a = generateJobId("task");
    const b = generateJobId("task");
    assert.match(a, /^task-[a-z0-9]+-[a-f0-9]{6}$/);
    assert.notEqual(a, b);
  });

  t.test("upsertJob round-trips through index", () => {
    const root = tempWorkspace();
    upsertJob(root, { id: "task-1", status: "running", startedAt: new Date().toISOString() });
    upsertJob(root, { id: "task-1", status: "completed" });
    const index = loadJobIndex(root);
    assert.equal(index.jobs.length, 1);
    assert.equal(index.jobs[0].status, "completed");
  });

  t.test("pruneJobs keeps active jobs and trims completed by age", () => {
    const root = tempWorkspace();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    upsertJob(root, { id: "old-completed", status: "completed", startedAt: old, completedAt: old });
    upsertJob(root, { id: "running", status: "running", startedAt: old, pid: 1 });
    upsertJob(root, { id: "fresh-completed", status: "completed", startedAt: fresh, completedAt: fresh });

    const result = pruneJobs(root);
    assert.deepEqual(result.removed, ["old-completed"]);
    assert.equal(result.kept, 2);
    const index = loadJobIndex(root);
    assert.deepEqual(index.jobs.map((j) => j.id).sort(), ["fresh-completed", "running"]);
  });

  t.test("pruneJobs caps total count to maxJobs", () => {
    const root = tempWorkspace();
    for (let i = 0; i < 5; i += 1) {
      const ts = new Date(Date.now() - i * 1000).toISOString();
      upsertJob(root, { id: `job-${i}`, status: "completed", startedAt: ts, completedAt: ts });
    }
    pruneJobs(root, { maxJobs: 2, maxAgeMs: Infinity });
    const index = loadJobIndex(root);
    assert.equal(index.jobs.length, 2);
    assert.deepEqual(index.jobs.map((j) => j.id), ["job-0", "job-1"]);
  });

  t.test("deleteJobArtifacts cleans log/state/event/job files", () => {
    const root = tempWorkspace();
    const logs = logsDir(root);
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "task-x.log"), "data");
    fs.writeFileSync(path.join(logs, "task-x.state.json"), "{}");
    fs.writeFileSync(path.join(logs, "task-x.events.jsonl"), "{}");
    writeJobFile(root, "task-x", { id: "task-x" });

    deleteJobArtifacts(root, "task-x");
    assert.equal(fs.existsSync(path.join(logs, "task-x.log")), false);
    assert.equal(fs.existsSync(path.join(logs, "task-x.state.json")), false);
    assert.equal(fs.existsSync(path.join(logs, "task-x.events.jsonl")), false);
  });
}
