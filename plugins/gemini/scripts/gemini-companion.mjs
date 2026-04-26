#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getGeminiAvailability,
  getGeminiAuthStatus,
  buildGeminiArgs,
  runGeminiHeadless,
  parseGeminiJsonResult
} from "./lib/gemini.mjs";
import {
  ensureGitRepository,
  resolveReviewTarget,
  collectReviewContext,
  getChangedFiles,
  collectFileDiff
} from "./lib/git.mjs";
import { terminateProcessTree } from "./lib/process.mjs";
import {
  renderSetupReport,
  renderTaskResult,
  renderReviewResult,
  renderStatusReport,
  renderJobStatusReport,
  renderStoredJobResult,
  renderCancelReport,
  renderQueuedLaunch
} from "./lib/render.mjs";
import {
  generateJobId,
  writeJobFile,
  upsertJob,
  pruneJobs
} from "./lib/state.mjs";
import {
  resolveCancelableJob,
  resolveResultJob,
  buildStatusSnapshot,
  enrichJobStatus
} from "./lib/job-control.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { resolveApprovalMode } from "./lib/approval.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// Soft cap on prompt size sent to Gemini. Gemini accepts ~1M tokens of
// context, but oversized diffs still produce muddled reviews; chunk per file
// once we cross this threshold.
const MAX_REVIEW_DIFF_BYTES = 600_000;
const PER_FILE_DIFF_BYTES = 200_000;

function printUsage() {
  console.log([
    "Usage:",
    "  gemini-companion.mjs setup [--json]",
    "  gemini-companion.mjs task [--background|--stream] [--model <model>] [--read-only|--yolo|--sandbox] [prompt]",
    "  gemini-companion.mjs review [--base <ref>] [--scope auto|working-tree|branch]",
    "  gemini-companion.mjs adversarial-review [--base <ref>] [--scope auto|working-tree|branch] [focus ...]",
    "  gemini-companion.mjs status [job-id] [--all] [--prune]",
    "  gemini-companion.mjs result [job-id]",
    "  gemini-companion.mjs tail [job-id]",
    "  gemini-companion.mjs cancel [job-id]"
  ].join("\n"));
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: { C: "cwd", ...(config.aliasMap ?? {}) }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function nowIso() {
  return new Date().toISOString();
}

function loadPromptTemplate(name) {
  const templatePath = path.join(ROOT_DIR, "prompts", `${name}.md`);
  return fs.readFileSync(templatePath, "utf8");
}

function interpolateTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── Setup ───

function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const gemini = getGeminiAvailability(cwd);
  const auth = gemini.available ? getGeminiAuthStatus(cwd) : { authenticated: false };

  const nextSteps = [];
  if (!gemini.available) {
    nextSteps.push("Install Gemini CLI: `npm install -g @google/gemini-cli` or `brew install gemini-cli` — see https://github.com/google-gemini/gemini-cli for details.");
  }
  if (gemini.available && !auth.authenticated) {
    nextSteps.push("Run `! gemini` interactively to set up authentication.");
  }

  const report = {
    ready: gemini.available && auth.authenticated,
    gemini,
    auth,
    actionsTaken: [],
    nextSteps
  };

  outputResult(options.json ? report : renderSetupReport(report), options.json);
}

// ─── Task ───

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd"],
    booleanOptions: ["json", "yolo", "sandbox", "background", "stream", "read-only"],
    aliasMap: { m: "model", y: "yolo", s: "sandbox" }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const prompt = positionals.join(" ").trim();

  if (!prompt) {
    throw new Error("Provide a prompt for the task.");
  }

  const model = options.model ?? null;
  const { approvalMode, sandbox, label: approvalLabel } = resolveApprovalMode(options);
  const title = "Gemini Task";
  const summary = shorten(prompt);

  if (options.background || options.stream) {
    const launched = launchBackgroundJob({
      workspaceRoot,
      cwd,
      kind: "task",
      title,
      summary,
      prompt,
      model,
      approvalMode,
      sandbox,
      stream: Boolean(options.stream),
      approvalLabel
    });
    outputResult(options.json ? launched.payload : renderQueuedLaunch(launched.payload), options.json);
    return;
  }

  const onProgress = process.stdout.isTTY ? (chunk) => process.stdout.write(chunk) : null;
  const result = await runGeminiHeadless({
    prompt,
    model,
    approvalMode,
    sandbox,
    cwd,
    outputFormat: "json",
    onProgress
  });

  // If we already streamed to the TTY, leave a separator before the structured render
  if (onProgress && result.stdout) {
    process.stdout.write("\n");
  }

  const isSuccess = result.exitCode === 0;
  const parsed = result.parsed ?? null;
  const rawOutput = parsed?.response
    || (isSuccess ? (result.stdout || result.stderr) : result.stdout);
  const failureMessage = isSuccess
    ? (parsed?.error?.message ?? (result.stdout && !parsed?.response ? result.stderr : ""))
    : (parsed?.error?.message ?? result.stderr);

  const rendered = renderTaskResult(
    { rawOutput, failureMessage },
    { title }
  );

  outputResult(options.json ? { ...result, parsed } : rendered, options.json);

  if (result.exitCode !== 0) {
    process.exitCode = 1;
  }
}

// Spawns a detached wrapper that runs Gemini and writes structured progress.
// stream=true uses -o stream-json and parses NDJSON events into events.jsonl;
// stream=false uses -o json and writes raw output to <jobId>.log.
function launchBackgroundJob(opts) {
  const {
    workspaceRoot, cwd, kind, title, summary,
    prompt, model, approvalMode, sandbox, stream, approvalLabel,
    target = null, reviewName = null
  } = opts;

  const jobId = generateJobId(kind);
  const logsRoot = path.join(workspaceRoot, ".gemini-companion", "logs");
  fs.mkdirSync(logsRoot, { recursive: true });
  const logFile = path.join(logsRoot, `${jobId}.log`);
  const stateFile = path.join(logsRoot, `${jobId}.state.json`);
  const eventsFile = stream ? path.join(logsRoot, `${jobId}.events.jsonl`) : null;
  const promptFile = path.join(logsRoot, `${jobId}.prompt.txt`);
  fs.writeFileSync(promptFile, prompt);

  const outputFormat = stream ? "stream-json" : "json";
  const args = buildGeminiArgs({ model, approvalMode, sandbox, outputFormat });

  const wrapperConfig = {
    args,
    cwd,
    logFile,
    stateFile,
    eventsFile,
    promptFile,
    outputFormat,
    heartbeatMs: 5000
  };

  const wrapperPath = path.join(ROOT_DIR, "scripts", "lib", "background-runner.mjs");
  const child = spawn(process.execPath, [wrapperPath, JSON.stringify(wrapperConfig)], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  const job = {
    id: jobId,
    kind,
    title,
    summary,
    status: "running",
    pid: child.pid,
    startedAt: nowIso(),
    logFile,
    stateFile,
    eventsFile,
    outputFormat,
    approvalMode: approvalLabel,
    model,
    target,
    reviewName
  };

  writeJobFile(workspaceRoot, jobId, job);
  upsertJob(workspaceRoot, job);

  return {
    job,
    payload: { jobId, status: "running", title, summary, logFile, eventsFile, stream }
  };
}

// ─── Review ───

async function handleReview(argv) {
  return handleReviewCommand(argv, { reviewName: "Review", templateName: "review" });
}

async function handleAdversarialReview(argv) {
  return handleReviewCommand(argv, { reviewName: "Adversarial Review", templateName: "adversarial-review" });
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "wait", "background"],
    aliasMap: { m: "model" }
  });

  const cwd = resolveCommandCwd(options);
  ensureGitRepository(cwd);

  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const context = collectReviewContext(cwd, target);
  const focusText = positionals.join(" ").trim();

  if (!context.diff) {
    outputResult(`No changes found for ${target.label}. Nothing to review.\n`, false);
    return;
  }

  const oversize = Buffer.byteLength(context.diff, "utf8") > MAX_REVIEW_DIFF_BYTES;
  const model = options.model ?? null;
  const onProgress = process.stdout.isTTY ? (chunk) => process.stdout.write(chunk) : null;

  if (oversize) {
    const aggregated = await runChunkedReview({
      cwd, target, context, focusText, templateName: config.templateName,
      reviewName: config.reviewName, model, onProgress
    });
    outputResult(options.json ? aggregated.json : aggregated.text, options.json);
    if (aggregated.failed) process.exitCode = 1;
    return;
  }

  const template = loadPromptTemplate(config.templateName);
  const prompt = interpolateTemplate(template, {
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: context.diff,
    BRANCH: context.branch ?? "unknown"
  });

  const result = await runGeminiHeadless({
    prompt,
    model,
    approvalMode: "plan",
    sandbox: true,
    cwd,
    outputFormat: "json",
    onProgress
  });

  if (onProgress && result.stdout) process.stdout.write("\n");

  const isSuccess = result.exitCode === 0;
  const parsed = result.parsed ?? null;
  const rawOutput = parsed?.response
    || (isSuccess ? (result.stdout || result.stderr) : result.stdout);
  const failureMessage = isSuccess
    ? (parsed?.error?.message ?? (result.stdout && !parsed?.response ? result.stderr : ""))
    : (parsed?.error?.message ?? result.stderr);

  const rendered = renderReviewResult(
    { rawOutput, failureMessage },
    { reviewLabel: config.reviewName, targetLabel: target.label }
  );

  outputResult(options.json ? { review: config.reviewName, target, result, parsed } : rendered, options.json);

  if (result.exitCode !== 0) process.exitCode = 1;
}

async function runChunkedReview({ cwd, target, context, focusText, templateName, reviewName, model, onProgress }) {
  const files = getChangedFiles(cwd, target);
  if (files.length === 0) {
    return { text: `Diff exceeded ${MAX_REVIEW_DIFF_BYTES} bytes but no per-file changes detected.\n`, failed: true, json: { error: "no-files" } };
  }

  const template = loadPromptTemplate(templateName);
  const sections = [];
  let failed = false;
  for (const [i, file] of files.entries()) {
    const fileDiff = collectFileDiff(cwd, target, file);
    if (!fileDiff) continue;
    const trimmed = Buffer.byteLength(fileDiff, "utf8") > PER_FILE_DIFF_BYTES
      ? `${fileDiff.slice(0, PER_FILE_DIFF_BYTES)}\n\n[diff truncated at ${PER_FILE_DIFF_BYTES} bytes]`
      : fileDiff;
    const prompt = interpolateTemplate(template, {
      TARGET_LABEL: `${target.label} — file ${i + 1}/${files.length}: ${file}`,
      USER_FOCUS: focusText || "No extra focus provided.",
      REVIEW_INPUT: trimmed,
      BRANCH: context.branch ?? "unknown"
    });

    if (onProgress) onProgress(`\n[chunk ${i + 1}/${files.length}] ${file}\n`);
    const result = await runGeminiHeadless({
      prompt, model, approvalMode: "plan", sandbox: true, cwd,
      outputFormat: "json", onProgress
    });
    if (result.exitCode !== 0) failed = true;
    const parsed = result.parsed ?? null;
    sections.push({
      file,
      response: parsed?.response ?? result.stdout,
      error: parsed?.error?.message ?? (result.exitCode !== 0 ? result.stderr : null),
      usage: parsed?.usage ?? null
    });
  }

  const text = [
    `## Gemini ${reviewName} — chunked (${sections.length} files)\n`,
    `Diff exceeded ${MAX_REVIEW_DIFF_BYTES} bytes; reviewed file-by-file.\n`,
    ...sections.map((s) => [
      `### ${s.file}`,
      s.error ? `_Error: ${s.error}_` : s.response || "_No findings._",
      ""
    ].join("\n"))
  ].join("\n");

  return { text, failed, json: { reviewName, target, sections } };
}

// ─── Status ───

function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "all", "prune"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  if (options.prune) {
    const result = pruneJobs(workspaceRoot);
    const message = `Pruned ${result.removed.length} job(s); ${result.kept} retained.\n`;
    outputResult(options.json ? result : message, options.json);
    return;
  }

  const reference = positionals[0];

  if (reference) {
    const { job } = resolveResultJob(workspaceRoot, reference);
    const enriched = enrichJobStatus(job);
    outputResult(options.json ? enriched : renderJobStatusReport(enriched), options.json);
    return;
  }

  const report = buildStatusSnapshot(workspaceRoot, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

// ─── Result ───

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0];
  const { job, stored } = resolveResultJob(workspaceRoot, reference);

  let output = stored?.output ?? null;
  if (!output && (stored?.logFile || job.logFile)) {
    try {
      const raw = fs.readFileSync(stored?.logFile ?? job.logFile, "utf8");
      const parsed = parseGeminiJsonResult(raw);
      output = parsed?.response ?? raw;
    } catch { /* ignore */ }
  }

  const enriched = { ...stored, output };
  outputResult(options.json ? { job, stored: enriched } : renderStoredJobResult(job, enriched), options.json);
}

// ─── Tail ───
// Streams the events.jsonl (preferred) or .log (fallback) of a job until the
// state file appears. Designed for an outer process to pipe into Monitor.
function handleTail(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0];
  const { job } = resolveResultJob(workspaceRoot, reference);

  const file = job.eventsFile && fs.existsSync(job.eventsFile) ? job.eventsFile : job.logFile;
  if (!file) {
    throw new Error(`No log file recorded for job ${job.id}.`);
  }

  let position = 0;
  let stopped = false;
  const interval = setInterval(() => {
    try {
      const stat = fs.statSync(file);
      if (stat.size > position) {
        const fd = fs.openSync(file, "r");
        const buffer = Buffer.alloc(stat.size - position);
        fs.readSync(fd, buffer, 0, buffer.length, position);
        fs.closeSync(fd);
        position = stat.size;
        process.stdout.write(buffer.toString("utf8"));
      }
    } catch { /* file may not exist yet */ }

    if (fs.existsSync(job.stateFile) && !stopped) {
      stopped = true;
      clearInterval(interval);
      process.stdout.write("\n[job complete]\n");
    }
  }, 250);
}

// ─── Cancel ───

function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0];
  const job = resolveCancelableJob(workspaceRoot, reference);

  terminateProcessTree(job.pid);

  const completedAt = nowIso();
  const updated = {
    ...job,
    status: "cancelled",
    completedAt,
    errorMessage: "Cancelled by user."
  };

  writeJobFile(workspaceRoot, job.id, updated);
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", completedAt, errorMessage: "Cancelled by user." });

  outputResult(options.json ? { jobId: job.id, status: "cancelled" } : renderCancelReport(updated), options.json);
}

// ─── Main ───

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      handleSetup(argv);
      break;
    case "task":
      await handleTask(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleAdversarialReview(argv);
      break;
    case "status":
      handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "tail":
      handleTail(argv);
      break;
    case "cancel":
      handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
