import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ensureGitRepository,
  resolveReviewTarget,
  collectReviewContext,
  getChangedFiles
} from "../../scripts/lib/git.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-gitfx-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export default function (t) {
  t.test("ensureGitRepository throws outside a repo", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-nogit-"));
    assert.throws(() => ensureGitRepository(tmp), /git repository/);
  });

  t.test("resolveReviewTarget(auto) prefers working-tree when dirty", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "README.md"), "hello world\n");
    const target = resolveReviewTarget(repo, { scope: "auto" });
    assert.equal(target.mode, "working-tree");
  });

  t.test("resolveReviewTarget(auto) falls back to branch when clean", () => {
    const repo = makeRepo();
    git(repo, "checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(repo, "feat.md"), "feat\n");
    git(repo, "add", "feat.md");
    git(repo, "commit", "-q", "-m", "feat");
    const target = resolveReviewTarget(repo, { scope: "auto" });
    assert.equal(target.mode, "branch");
    assert.match(target.baseRef, /main/);
  });

  t.test("collectReviewContext picks up a working-tree diff", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "README.md"), "changed\n");
    const target = resolveReviewTarget(repo, { scope: "auto" });
    const ctx = collectReviewContext(repo, target);
    assert.match(ctx.diff, /-hello/);
    assert.match(ctx.diff, /\+changed/);
  });

  t.test("getChangedFiles returns working-tree paths", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
    fs.writeFileSync(path.join(repo, "b.txt"), "b\n");
    const files = getChangedFiles(repo, { mode: "working-tree" });
    assert.deepEqual([...files].sort(), ["a.txt", "b.txt"]);
  });
}
