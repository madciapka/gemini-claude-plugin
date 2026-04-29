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

const STALL_THRESHOLD_MS = 30_000;

export function enrichJobStatus(job) {
  if ((job.status === "running" || job.status === "queued") && job.pid) {
    if (job.stateFile) {
      try {
        const state = JSON.parse(fs.readFileSync(job.stateFile, "utf8"));
        if (state.status === "completed" || state.status === "failed") {
          return {
            ...job,
            status: state.status,
            exitCode: state.exitCode,
            completedAt: state.completedAt,
            error: state.error ?? null,
            phase: state.status === "completed" ? "done" : "failed"
          };
        }
        // Still running — check heartbeat freshness.
        const last = state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).getTime() : null;
        const stalled = last && (Date.now() - last) > STALL_THRESHOLD_MS;
        return {
          ...job,
          lastHeartbeatAt: state.lastHeartbeatAt ?? null,
          phase: stalled ? `stalled (no heartbeat for ${Math.round((Date.now() - last) / 1000)}s)` : "running"
        };
      } catch {
        // State file not written yet — fall through to PID check
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
