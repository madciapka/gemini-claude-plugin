export function renderSetupReport(report) {
  const lines = [];
  lines.push("## Gemini CLI Setup\n");

  if (report.gemini.available) {
    lines.push(`- **Gemini CLI**: Installed (${report.gemini.version})`);
  } else {
    lines.push("- **Gemini CLI**: Not found");
  }

  if (report.auth.authenticated) {
    lines.push("- **Authentication**: OK");
  } else {
    lines.push("- **Authentication**: Not configured");
  }

  lines.push(`- **Ready**: ${report.ready ? "Yes" : "No"}`);

  if (report.actionsTaken.length > 0) {
    lines.push("\n**Actions taken:**");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push("\n**Next steps:**");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function renderTaskResult(result, options = {}) {
  const lines = [];
  const title = options.title ?? "Gemini Task";
  const jobId = options.jobId;

  if (result.failureMessage && !result.rawOutput) {
    lines.push(`## ${title} — Failed\n`);
    lines.push(result.failureMessage);
    if (jobId) {
      lines.push(`\nJob: ${jobId}`);
    }
    return lines.join("\n") + "\n";
  }

  if (result.rawOutput) {
    lines.push(result.rawOutput);
  }

  return lines.join("\n") + "\n";
}

export function renderReviewResult(result, options = {}) {
  const reviewLabel = options.reviewLabel ?? "Review";
  const targetLabel = options.targetLabel ?? "";
  const lines = [];

  if (result.failureMessage && !result.rawOutput) {
    lines.push(`## Gemini ${reviewLabel} — Failed\n`);
    if (targetLabel) {
      lines.push(`Target: ${targetLabel}\n`);
    }
    lines.push(result.failureMessage);
    return lines.join("\n") + "\n";
  }

  lines.push(`## Gemini ${reviewLabel}\n`);
  if (targetLabel) {
    lines.push(`Target: ${targetLabel}\n`);
  }
  if (result.rawOutput) {
    lines.push(result.rawOutput);
  }

  return lines.join("\n") + "\n";
}

export function renderStatusReport(report) {
  if (report.jobs.length === 0) {
    return "No Gemini jobs found for this session.\n";
  }

  const lines = [];
  lines.push("| Job ID | Kind | Status | Started | Summary |");
  lines.push("|--------|------|--------|---------|---------|");

  for (const job of report.jobs) {
    const started = job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "-";
    lines.push(`| ${job.id} | ${job.kind} | ${job.status} | ${started} | ${job.summary ?? "-"} |`);
  }

  return lines.join("\n") + "\n";
}

export function renderJobStatusReport(job) {
  const lines = [];
  lines.push(`## Job: ${job.id}\n`);
  lines.push(`- **Kind**: ${job.kind}`);
  lines.push(`- **Status**: ${job.status}`);
  lines.push(`- **Title**: ${job.title ?? "-"}`);
  lines.push(`- **Summary**: ${job.summary ?? "-"}`);
  if (job.startedAt) {
    lines.push(`- **Started**: ${job.startedAt}`);
  }
  if (job.completedAt) {
    lines.push(`- **Completed**: ${job.completedAt}`);
  }
  if (job.errorMessage) {
    lines.push(`- **Error**: ${job.errorMessage}`);
  }
  return lines.join("\n") + "\n";
}

export function renderStoredJobResult(job, stored) {
  const lines = [];
  lines.push(`## Result: ${job.id}\n`);
  lines.push(`- **Status**: ${job.status}`);
  lines.push(`- **Title**: ${job.title ?? "-"}`);

  if (stored?.output) {
    lines.push(`\n${stored.output}`);
  } else if (stored?.errorMessage) {
    lines.push(`\n**Error**: ${stored.errorMessage}`);
  } else {
    lines.push("\nNo output stored for this job.");
  }

  return lines.join("\n") + "\n";
}

export function renderCancelReport(job) {
  return `Cancelled job ${job.id} (${job.title ?? job.kind}).\n`;
}

export function renderQueuedLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /gemini:status ${payload.jobId} for progress.\n`;
}
