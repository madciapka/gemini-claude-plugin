#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { getGeminiAvailability, getGeminiAuthStatus, buildGeminiArgs, runGeminiHeadless, spawnGeminiDetached } from "./lib/gemini.mjs";
import { ensureGitRepository, resolveReviewTarget, collectReviewContext } from "./lib/git.mjs";
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
import { generateJobId, writeJobFile, readJobFile, upsertJob, listJobs } from "./lib/state.mjs";
import { sortJobsNewestFirst, resolveCancelableJob, resolveResultJob, buildStatusSnapshot, enrichJobStatus } from "./lib/job-control.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function printUsage() {
  console.log([
    "Usage:",
    "  gemini-companion.mjs setup [--json]",
    "  gemini-companion.mjs task [--background] [--model <model>] [--yolo] [--sandbox] [prompt]",
    "  gemini-companion.mjs review [--base <ref>] [--scope auto|working-tree|branch]",
    "  gemini-companion.mjs adversarial-review [--base <ref>] [--scope auto|working-tree|branch] [focus ...]",
    "  gemini-companion.mjs status [job-id] [--all]",
    "  gemini-companion.mjs result [job-id]",
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
    booleanOptions: ["json", "yolo", "sandbox", "background"],
    aliasMap: { m: "model", y: "yolo", s: "sandbox" }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const prompt = positionals.join(" ").trim();

  if (!prompt) {
    throw new Error("Provide a prompt for the task.");
  }

  const model = options.model ?? null;
  const approvalMode = options.yolo ? "yolo" : "auto_edit";
  const sandbox = Boolean(options.sandbox);
  const title = "Gemini Task";
  const summary = shorten(prompt);

  if (options.background) {
    const jobId = generateJobId("task");
    const logFile = path.join(workspaceRoot, ".gemini-companion", "logs", `${jobId}.log`);
    const stateFile = path.join(workspaceRoot, ".gemini-companion", "logs", `${jobId}.state.json`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    // Spawn a wrapper script that runs gemini and writes final state
    const wrapperScript = `
      const { spawn } = require("child_process");
      const fs = require("fs");
      const args = ${JSON.stringify(buildGeminiArgs({ prompt, model, approvalMode, sandbox, outputFormat: "text" }))};
      const logFd = fs.openSync(${JSON.stringify(logFile)}, "w");
      const child = spawn("gemini", args, { cwd: ${JSON.stringify(cwd)}, stdio: ["ignore", logFd, logFd] });
      child.on("close", (code) => {
        fs.closeSync(logFd);
        fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({ exitCode: code, completedAt: new Date().toISOString() }));
      });
    `;
    const child = spawn(process.execPath, ["-e", wrapperScript], {
      cwd,
      env: process.env,
      detached: true,
      stdio: "ignore"
    });
    child.unref();

    const job = {
      id: jobId,
      kind: "task",
      title,
      summary,
      status: "running",
      pid: child.pid,
      startedAt: nowIso(),
      logFile,
      stateFile
    };

    writeJobFile(workspaceRoot, jobId, job);
    upsertJob(workspaceRoot, job);

    const payload = { jobId, status: "running", title, summary, logFile };
    outputResult(options.json ? payload : renderQueuedLaunch(payload), options.json);
    return;
  }

  const result = await runGeminiHeadless({ prompt, model, approvalMode, sandbox, cwd });

  const rendered = renderTaskResult(
    { rawOutput: result.stdout, failureMessage: result.stderr },
    { title }
  );

  outputResult(options.json ? result : rendered, options.json);

  if (result.exitCode !== 0) {
    process.exitCode = 1;
  }
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

  const template = loadPromptTemplate(config.templateName);
  const prompt = interpolateTemplate(template, {
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: context.diff,
    BRANCH: context.branch ?? "unknown"
  });

  const model = options.model ?? null;
  const result = await runGeminiHeadless({
    prompt,
    model,
    approvalMode: "plan",
    sandbox: true,
    cwd,
    outputFormat: "text"
  });

  const rendered = renderReviewResult(
    { rawOutput: result.stdout, failureMessage: result.stderr },
    { reviewLabel: config.reviewName, targetLabel: target.label }
  );

  outputResult(options.json ? { review: config.reviewName, target, result } : rendered, options.json);

  if (result.exitCode !== 0) {
    process.exitCode = 1;
  }
}

// ─── Status ───

function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "all"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0];

  if (reference) {
    const { job, stored } = resolveResultJob(workspaceRoot, reference);
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

  // Try reading the log file for output
  let output = stored?.output ?? null;
  if (!output && (stored?.logFile || job.logFile)) {
    try {
      output = fs.readFileSync(stored?.logFile ?? job.logFile, "utf8");
    } catch { /* ignore */ }
  }

  const enriched = { ...stored, output };
  outputResult(options.json ? { job, stored: enriched } : renderStoredJobResult(job, enriched), options.json);
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
