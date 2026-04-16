import fs from "node:fs";
import { listJobs, readJobFile } from "./state.mjs";
import { isProcessAlive } from "./process.mjs";

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => {
    const ta = a.startedAt ?? a.createdAt ?? "";
    const tb = b.startedAt ?? b.createdAt ?? "";
    return tb.localeCompare(ta);
  });
}

export function resolveJob(workspaceRoot, reference) {
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));

  if (reference) {
    const match = jobs.find((j) => j.id === reference);
    if (!match) {
      throw new Error(`No job found with id: ${reference}`);
    }
    return match;
  }

  if (jobs.length === 0) {
    throw new Error("No Gemini jobs found for this workspace.");
  }
  return jobs[0];
}

export function resolveCancelableJob(workspaceRoot, reference) {
  const job = resolveJob(workspaceRoot, reference);
  if (job.status !== "running" && job.status !== "queued") {
    throw new Error(`Job ${job.id} is not active (status: ${job.status}).`);
  }
  return job;
}

export function resolveResultJob(workspaceRoot, reference) {
  const job = resolveJob(workspaceRoot, reference);
  return { job, stored: readJobFile(workspaceRoot, job.id) };
}

export function enrichJobStatus(job) {
  if ((job.status === "running" || job.status === "queued") && job.pid) {
    // Check for a state file written by the background wrapper on completion
    if (job.stateFile) {
      try {
        const state = JSON.parse(fs.readFileSync(job.stateFile, "utf8"));
        const status = state.exitCode === 0 ? "completed" : "failed";
        return {
          ...job,
          status,
          exitCode: state.exitCode,
          completedAt: state.completedAt,
          phase: status === "completed" ? "done" : "failed"
        };
      } catch {
        // State file not written yet — check PID
      }
    }
    if (!isProcessAlive(job.pid)) {
      return { ...job, status: "completed", phase: "done (process exited, no state file)" };
    }
  }
  return job;
}

export function buildStatusSnapshot(workspaceRoot, options = {}) {
  const raw = sortJobsNewestFirst(listJobs(workspaceRoot));
  const jobs = options.all ? raw : raw.slice(0, 10);
  return { jobs: jobs.map(enrichJobStatus) };
}
