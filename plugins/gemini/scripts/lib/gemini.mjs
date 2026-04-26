import { execFileSync, spawn } from "node:child_process";

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

// Gemini sometimes prefixes JSON output with deprecation warnings or other
// noise that may itself contain balanced `{...}`. Walk the buffer, try every
// balanced object as JSON, and return the first one that parses cleanly.
function extractFirstJsonObject(text) {
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("{", cursor);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    let matched = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === "\"") { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { matched = i; break; }
      }
    }
    if (matched < 0) return null;
    try {
      return JSON.parse(text.slice(start, matched + 1));
    } catch {
      cursor = start + 1;
    }
  }
  return null;
}

export function parseGeminiJsonResult(stdout) {
  const parsed = extractFirstJsonObject(stdout);
  if (!parsed) return null;
  const modelEntry = parsed.stats?.models ? Object.entries(parsed.stats.models)[0] : null;
  const modelName = modelEntry?.[0] ?? null;
  const tokens = modelEntry?.[1]?.tokens ?? null;
  const api = modelEntry?.[1]?.api ?? null;
  return {
    sessionId: parsed.session_id ?? null,
    response: parsed.response ?? "",
    error: parsed.error ?? null,
    model: modelName,
    usage: tokens
      ? {
          input: tokens.input ?? null,
          output: tokens.candidates ?? null,
          thoughts: tokens.thoughts ?? null,
          total: tokens.total ?? null,
          cached: tokens.cached ?? null
        }
      : null,
    durationMs: api?.totalLatencyMs ?? null,
    raw: parsed
  };
}

// Pulls the final user-facing response out of a stream-json log/buffer.
// Prefers an event with `type === "complete"` carrying a `response` field,
// otherwise falls back to concatenated `message` content.
export function extractStreamJsonResponse(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try { events.push(JSON.parse(trimmed)); } catch { /* skip noise */ }
  }
  if (events.length === 0) return null;
  const complete = events.find((e) => e.type === "complete" && typeof e.response === "string");
  if (complete) return { response: complete.response, events };
  const messages = events
    .filter((e) => e.type === "message" && (typeof e.content === "string" || typeof e.text === "string"))
    .map((e) => e.content ?? e.text);
  if (messages.length > 0) return { response: messages.join(""), events };
  return { response: "", events };
}

// Splits a buffer into complete NDJSON lines, returning parsed events plus the
// remainder. Skips blank lines and unparseable lines (yields them as `noise`).
export function consumeStreamLines(buffer) {
  const events = [];
  const noise = [];
  let cursor = 0;
  while (true) {
    const newline = buffer.indexOf("\n", cursor);
    if (newline < 0) break;
    const line = buffer.slice(cursor, newline).trim();
    cursor = newline + 1;
    if (!line) continue;
    if (line.startsWith("{")) {
      try {
        events.push(JSON.parse(line));
        continue;
      } catch {
        // fall through to noise
      }
    }
    noise.push(line);
  }
  return { events, noise, remainder: buffer.slice(cursor) };
}

export function runGeminiHeadless(options = {}) {
  const outputFormat = options.outputFormat ?? "text";
  return new Promise((resolve, reject) => {
    const args = buildGeminiArgs({
      model: options.model ?? null,
      approvalMode: options.approvalMode ?? "auto_edit",
      sandbox: options.sandbox ?? false,
      outputFormat
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
    let streamBuffer = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (outputFormat === "stream-json" && options.onStreamEvent) {
        streamBuffer += text;
        const { events, remainder } = consumeStreamLines(streamBuffer);
        streamBuffer = remainder;
        for (const event of events) options.onStreamEvent(event);
      } else if (options.onProgress) {
        options.onProgress(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to spawn gemini: ${error.message}`));
    });

    child.on("close", (code) => {
      const result = {
        status: code === 0 ? "completed" : "failed",
        exitCode: code,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        pid: child.pid,
        outputFormat
      };
      if (outputFormat === "json") {
        result.parsed = parseGeminiJsonResult(stdout);
      }
      resolve(result);
    });
  });
}
