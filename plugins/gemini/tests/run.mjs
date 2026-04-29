#!/usr/bin/env node
// Tiny test runner so we don't pull in a framework. Each *.test.mjs file
// exports default async (t) where t.test(name, fn) registers cases.
//
// Usage:
//   node tests/run.mjs                # unit + integration (no live calls)
//   node tests/run.mjs --tag=live     # opt-in live tests (requires gemini auth)
//   GEMINI_E2E=1 node tests/run.mjs --tag=live

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argTags = new Set();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--tag=(.+)$/);
  if (match) argTags.add(match[1]);
}
if (process.env.GEMINI_E2E === "1") argTags.add("live");

function listTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestFiles(full));
    else if (entry.name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

function colour(text, code) { return `[${code}m${text}[0m`; }

const files = listTestFiles(ROOT).sort();
const results = { passed: 0, failed: 0, skipped: 0 };
const failures = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const mod = await import(file);
  const cases = [];
  const t = {
    test(name, fn, opts = {}) { cases.push({ name, fn, opts }); }
  };
  await mod.default(t);
  for (const { name, fn, opts } of cases) {
    const tags = new Set(opts.tags ?? []);
    if (tags.has("live") && !argTags.has("live")) {
      console.log(`${colour("·", 90)} ${rel} > ${name} ${colour("(skipped: live)", 90)}`);
      results.skipped += 1;
      continue;
    }
    try {
      await fn();
      console.log(`${colour("✓", 32)} ${rel} > ${name}`);
      results.passed += 1;
    } catch (error) {
      console.log(`${colour("✗", 31)} ${rel} > ${name}`);
      console.log(error.stack ?? error.message);
      results.failed += 1;
      failures.push({ file: rel, name, error });
    }
  }
}

console.log(`\n${results.passed} passed · ${results.failed} failed · ${results.skipped} skipped`);
if (results.failed > 0) process.exit(1);
