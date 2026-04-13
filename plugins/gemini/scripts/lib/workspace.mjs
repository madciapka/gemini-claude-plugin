import { execFileSync } from "node:child_process";
import path from "node:path";

export function resolveWorkspaceRoot(cwd) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    return root;
  } catch {
    return path.resolve(cwd);
  }
}
