import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const GEMINI_BINARY = "gemini";

export function getGeminiAvailability(cwd) {
  try {
    const version = execFileSync(GEMINI_BINARY, ["--version"], {
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

export function getGeminiAuthStatus(cwd) {
  try {
    const result = execFileSync(GEMINI_BINARY, ["-p", "respond with exactly: ok", "-o", "text"], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { authenticated: true, output: result.trim() };
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr) : "";
    const isAuthError = stderr.includes("auth") || stderr.includes("credential") || stderr.includes("login") || stderr.includes("API key");
    return { authenticated: false, isAuthError, error: stderr || error.message };
  }
}

export function buildGeminiArgs({ model, approvalMode, sandbox, outputFormat }) {
  const args = [];
  if (outputFormat) {
    args.push("-o", outputFormat);
  }
  if (model) {
    args.push("-m", model);
  }
  if (approvalMode) {
    args.push("--approval-mode", approvalMode);
  }
  if (sandbox) {
    args.push("-s");
  }
  return args;
}

export function runGeminiHeadless(options = {}) {
  return new Promise((resolve, reject) => {
    const args = buildGeminiArgs({
      model: options.model ?? null,
      approvalMode: options.approvalMode ?? "auto_edit",
      sandbox: options.sandbox ?? false,
      outputFormat: options.outputFormat ?? "text"
    });

    const child = spawn(GEMINI_BINARY, args, {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stdin.write(options.prompt);
    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.onProgress) {
        options.onProgress(chunk.toString());
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn gemini: ${error.message}`));
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

export function spawnGeminiDetached(options = {}) {
  const args = buildGeminiArgs({
    model: options.model ?? null,
    approvalMode: options.approvalMode ?? "auto_edit",
    sandbox: options.sandbox ?? false,
    outputFormat: options.outputFormat ?? "text"
  });

  // For detached processes, write prompt to a temp file and pipe it in via shell,
  // since we can't write to stdin of a detached/unref'd process reliably.
  const tempDir = mkdtempSync(join(tmpdir(), "gemini-prompt-"));
  const promptFile = join(tempDir, "prompt.txt");
  writeFileSync(promptFile, options.prompt);

  const shellCmd = `"${GEMINI_BINARY}" ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} < "${promptFile}"; rm -rf "${tempDir}"`;

  const child = spawn("sh", ["-c", shellCmd], {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", options.stdoutFd ?? "ignore", options.stderrFd ?? "ignore"]
  });

  child.unref();
  return child;
}
