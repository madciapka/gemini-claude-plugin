import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isProcessAlive } from "./process.mjs";

function stateDir(workspaceRoot) {
  return path.join(workspaceRoot, ".gemini-companion");
}

function jobsDir(workspaceRoot) {
  return path.join(stateDir(workspaceRoot), "jobs");
}

function jobFilePath(workspaceRoot, jobId) {
  return path.join(jobsDir(workspaceRoot), `${jobId}.json`);
}

function indexFilePath(workspaceRoot) {
  return path.join(stateDir(workspaceRoot), "jobs-index.json");
}

export function logsDir(workspaceRoot) {
  return path.join(stateDir(workspaceRoot), "logs");
}

export function deleteJobArtifacts(workspaceRoot, jobId) {
  for (const file of [
    jobFilePath(workspaceRoot, jobId),
    path.join(logsDir(workspaceRoot), `${jobId}.log`),
    path.join(logsDir(workspaceRoot), `${jobId}.state.json`),
    path.join(logsDir(workspaceRoot), `${jobId}.events.jsonl`)
  ]) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

export function pruneJobs(workspaceRoot, { maxAgeMs = 7 * 24 * 60 * 60 * 1000, maxJobs = 50 } = {}) {
  const index = loadJobIndex(workspaceRoot);
  const now = Date.now();
  const sorted = [...index.jobs].sort((a, b) => {
    const ta = new Date(a.startedAt ?? a.completedAt ?? 0).getTime();
    const tb = new Date(b.startedAt ?? b.completedAt ?? 0).getTime();
    return tb - ta;
  });
  const kept = [];
  const removed = [];
  let liveCount = 0;
  for (const job of sorted) {
    const age = now - new Date(job.startedAt ?? job.completedAt ?? 0).getTime();
    // Treat status as a hint, not truth. A job whose PID is gone has crashed
    // or been killed — verify before exempting it from pruning, otherwise
    // zombie "running" rows leak forever and starve genuine completed jobs out
    // of the index once they push past `maxJobs`.
    const liveByPid = (job.status === "running" || job.status === "queued") && job.pid && isProcessAlive(job.pid);
    if (liveByPid) {
      kept.push(job);
      liveCount += 1;
      continue;
    }
    if (liveCount + kept.length >= maxJobs || age > maxAgeMs) {
      removed.push(job.id);
      deleteJobArtifacts(workspaceRoot, job.id);
      continue;
    }
    kept.push(job);
  }
  saveJobIndex(workspaceRoot, { jobs: kept });
  return { kept: kept.length, removed };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function generateJobId(prefix = "job") {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString("hex");
  return `${prefix}-${ts}-${rand}`;
}

export function writeJobFile(workspaceRoot, jobId, data) {
  ensureDir(jobsDir(workspaceRoot));
  fs.writeFileSync(jobFilePath(workspaceRoot, jobId), JSON.stringify(data, null, 2), "utf8");
}

export function readJobFile(workspaceRoot, jobId) {
  try {
    return JSON.parse(fs.readFileSync(jobFilePath(workspaceRoot, jobId), "utf8"));
  } catch {
    return null;
  }
}

export function loadJobIndex(workspaceRoot) {
  try {
    return JSON.parse(fs.readFileSync(indexFilePath(workspaceRoot), "utf8"));
  } catch {
    return { jobs: [] };
  }
}

function saveJobIndex(workspaceRoot, index) {
  ensureDir(stateDir(workspaceRoot));
  fs.writeFileSync(indexFilePath(workspaceRoot), JSON.stringify(index, null, 2), "utf8");
}

export function upsertJob(workspaceRoot, job) {
  const index = loadJobIndex(workspaceRoot);
  const existing = index.jobs.findIndex((j) => j.id === job.id);
  if (existing >= 0) {
    index.jobs[existing] = { ...index.jobs[existing], ...job };
  } else {
    index.jobs.push(job);
  }
  saveJobIndex(workspaceRoot, index);
}

export function listJobs(workspaceRoot) {
  return loadJobIndex(workspaceRoot).jobs;
}
