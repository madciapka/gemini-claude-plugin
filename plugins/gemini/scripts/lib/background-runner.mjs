#!/usr/bin/env node
// Detached wrapper used by `gemini-companion.mjs` for background jobs.
// Spawns gemini, captures stdout to a log (and stream-json events to .jsonl),
// writes a heartbeat into the state file every few seconds, and writes a
// final state record on exit so `status` and `tail` can detect completion.

import fs from "node:fs";
import { spawn } from "node:child_process";

const config = JSON.parse(process.argv[2] ?? "{}");
const {
  args = [],
  cwd,
  logFile,
  stateFile,
  eventsFile,
  promptFile,
  outputFormat = "json",
  heartbeatMs = 5000
} = config;

const startedAt = new Date().toISOString();

function writeState(extra) {
  const payload = {
    pid: process.pid,
    startedAt,
    lastHeartbeatAt: new Date().toISOString(),
    outputFormat,
    ...extra
  };
  try {
    fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2));
  } catch { /* best-effort */ }
}

writeState({ status: "running" });

const logFd = fs.openSync(logFile, "w");
const eventsFd = eventsFile ? fs.openSync(eventsFile, "w") : null;

const child = spawn("gemini", args, {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"]
});

const promptStream = fs.createReadStream(promptFile);
promptStream.on("end", () => child.stdin.end());
promptStream.on("error", () => child.stdin.end());
promptStream.pipe(child.stdin);

let streamBuffer = "";
child.stdout.on("data", (chunk) => {
  fs.writeSync(logFd, chunk);
  if (outputFormat === "stream-json" && eventsFd) {
    streamBuffer += chunk.toString();
    let nl;
    while ((nl = streamBuffer.indexOf("\n")) >= 0) {
      const line = streamBuffer.slice(0, nl);
      streamBuffer = streamBuffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Pass through any line; consumers parse JSON or treat as raw.
      fs.writeSync(eventsFd, line + "\n");
    }
  }
});
child.stderr.on("data", (chunk) => {
  fs.writeSync(logFd, chunk);
});

const heartbeat = setInterval(() => writeState({ status: "running" }), heartbeatMs);

child.on("close", (code) => {
  clearInterval(heartbeat);
  if (eventsFd) {
    if (streamBuffer.trim()) fs.writeSync(eventsFd, streamBuffer);
    fs.closeSync(eventsFd);
  }
  fs.closeSync(logFd);
  try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
  writeState({
    status: code === 0 ? "completed" : "failed",
    exitCode: code,
    completedAt: new Date().toISOString()
  });
});

child.on("error", (error) => {
  clearInterval(heartbeat);
  if (eventsFd) {
    try { fs.closeSync(eventsFd); } catch { /* ignore */ }
  }
  try { fs.closeSync(logFd); } catch { /* ignore */ }
  writeState({
    status: "failed",
    error: String(error?.message ?? error),
    completedAt: new Date().toISOString()
  });
  process.exit(1);
});
