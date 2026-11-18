#!/usr/bin/env node
/**
 * Guard: the compiled core must be importable as ESM, from every entry the
 * backend actually uses, in a FRESH process each.
 *
 * Why: `packages/core` is a circular-import graph. Under ESM a module-scope
 * expression that reads a `const` exported by a module still being evaluated
 * throws `ReferenceError: Cannot access 'X' before initialization`. Jest runs
 * core as CommonJS, where the same cycle yields `undefined` and tests pass;
 * `tsc` does not evaluate anything. The first thing that failed on
 * 2026-11-18 was the Fly boot (`ProfitRepository` ↔ `TransactionRepository`,
 * `CREDIT_RETURN_LEG_METHOD`), after CI was green. Run after `yarn build:core`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "packages/core/dist");

// One entry per *distinct evaluation order*: the public entry plus the two
// repositories that form the cycle, each as the first module loaded.
const entries = [
  "index.js",
  "browser.js",
  "repositories/TransactionRepository.js",
  "repositories/ProfitRepository.js",
];

if (!existsSync(path.join(dist, "index.js"))) {
  console.error(`check-core-esm-import: ${dist}/index.js missing — run \`yarn build:core\` first`);
  process.exit(2);
}

let failed = 0;
for (const entry of entries) {
  const file = path.join(dist, entry);
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(file)});`],
    { encoding: "utf8", cwd: root, timeout: 120_000 },
  );
  if (r.status === 0) {
    console.log(`ok   ${entry}`);
  } else {
    failed++;
    const tail = (r.stderr || r.stdout || "").split("\n").filter(Boolean).slice(0, 8).join("\n");
    console.error(`FAIL ${entry}\n${tail}`);
  }
}
if (failed) {
  console.error(`check-core-esm-import: ${failed} entr${failed === 1 ? "y" : "ies"} failed to import as ESM`);
  process.exit(1);
}
console.log(`check-core-esm-import: ${entries.length} entries import cleanly`);
