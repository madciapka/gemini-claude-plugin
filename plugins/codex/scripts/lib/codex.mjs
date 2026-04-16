import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CODEX_BINARY = "codex";

export function getCodexAvailability(cwd) {
  try {
    const version = execFileSync(CODEX_BINARY, ["--version"], {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

export function getCodexAuthStatus(cwd) {
  // Assuming codex has a similar check or we can just try a minimal command
  try {
    const result = execFileSync(CODEX_BINARY, ["review", "--help"], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { authenticated: true };
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr) : "";
    const isAuthError = stderr.includes("auth") || stderr.includes("credential") || stderr.includes("login") || stderr.includes("API key");
    return { authenticated: false, isAuthError, error: stderr || error.message };
  }
}

export function buildCodexArgs({ model, sandbox, outputFormat }) {
  const args = [];
  // Adapt this based on actual codex CLI arguments
  if (model) {
    args.push("--model", model);
  }
  if (sandbox) {
    args.push("--sandbox");
  }
  return args;
}

export function runCodexHeadless(options = {}) {
  return new Promise((resolve, reject) => {
    // Basic mapping: task/review commands
    const command = options.command || "task";
    const args = [command, ...buildCodexArgs(options)];

    const child = spawn(CODEX_BINARY, args, {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    if (options.prompt) {
      child.stdin.write(options.prompt);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn codex: ${error.message}`));
    });

    child.on("close", (code) => {
      resolve({
        status: code === 0 ? "completed" : "failed",
        exitCode: code,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        pid: child.pid
      });
    });
  });
}
