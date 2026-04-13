import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
