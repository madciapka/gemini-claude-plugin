import { execFileSync } from "node:child_process";

export function ensureGitRepository(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    throw new Error("Not inside a git repository. Reviews require a git working tree.");
  }
}

export function getCurrentBranch(cwd) {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return null;
  }
}

export function getDefaultBase(cwd) {
  // Check local branches first, then remote tracking branches
  for (const candidate of ["main", "master", "origin/main", "origin/master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", candidate], {
        cwd,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"]
      });
      return candidate;
    } catch {
      // try next
    }
  }
  return "HEAD~1";
}

export function resolveReviewTarget(cwd, options = {}) {
  const scope = options.scope ?? "auto";
  const base = options.base;

  if (scope === "branch" || base) {
    const baseRef = base ?? getDefaultBase(cwd);
    return { mode: "branch", baseRef, label: `branch changes vs ${baseRef}` };
  }

  if (scope === "working-tree") {
    return { mode: "working-tree", label: "working tree changes" };
  }

  // auto: prefer working tree if there are changes, otherwise branch
  try {
    const status = execFileSync("git", ["status", "--short"], {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();

    if (status) {
      return { mode: "working-tree", label: "working tree changes" };
    }
  } catch {
    // fall through
  }

  const baseRef = getDefaultBase(cwd);
  return { mode: "branch", baseRef, label: `branch changes vs ${baseRef}` };
}

export function collectReviewDiff(cwd, target) {
  try {
    let diff;
    if (target.mode === "working-tree") {
      const staged = execFileSync("git", ["diff", "--cached"], {
        cwd, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"]
      });
      const unstaged = execFileSync("git", ["diff"], {
        cwd, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"]
      });
      const untracked = getUntrackedContent(cwd);
      diff = [staged, unstaged, untracked].filter(Boolean).join("\n");
    } else {
      diff = execFileSync("git", ["diff", `${target.baseRef}...HEAD`], {
        cwd, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"]
      });
    }
    return diff.trim();
  } catch (error) {
    throw new Error(`Failed to collect review diff: ${error.message}`);
  }
}

function getUntrackedContent(cwd) {
  try {
    const files = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"]
    }).trim();

    if (!files) return "";

    const parts = [];
    for (const file of files.split("\n").slice(0, 50)) {
      try {
        const content = execFileSync("git", ["diff", "--no-index", "/dev/null", file], {
          cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"]
        });
        parts.push(content);
      } catch (error) {
        // git diff --no-index exits with 1 when there are differences (which is always)
        if (error.stdout) {
          parts.push(error.stdout);
        }
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

export function collectReviewContext(cwd, target) {
  const branch = getCurrentBranch(cwd);
  const diff = collectReviewDiff(cwd, target);
  return { branch, target, diff };
}

export function getChangedFiles(cwd, target) {
  try {
    const args = target.mode === "working-tree"
      ? ["status", "--porcelain=1", "--untracked-files=all"]
      : ["diff", "--name-only", `${target.baseRef}...HEAD`];
    const out = execFileSync("git", args, {
      cwd, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    if (!out) return [];
    if (target.mode === "working-tree") {
      return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    }
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function collectFileDiff(cwd, target, file) {
  try {
    if (target.mode === "working-tree") {
      const staged = execFileSync("git", ["diff", "--cached", "--", file], {
        cwd, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"]
      });
      const unstaged = execFileSync("git", ["diff", "--", file], {
        cwd, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"]
      });
      let untracked = "";
      try {
        untracked = execFileSync("git", ["diff", "--no-index", "/dev/null", file], {
          cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        if (error.stdout) untracked = error.stdout;
      }
      return [staged, unstaged, untracked].filter(Boolean).join("\n").trim();
    }
    return execFileSync("git", ["diff", `${target.baseRef}...HEAD`, "--", file], {
      cwd, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}
