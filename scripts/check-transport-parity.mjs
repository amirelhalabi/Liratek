#!/usr/bin/env node
/**
 * check-transport-parity.mjs
 *
 * LIRA-297 static guard for the dual-transport (desktop IPC + web REST)
 * defect classes catalogued in
 * docs/plans/ongoing_plans/TRANSPORT_PARITY_AUDIT_PLAN.md §1–§2. Rule logic
 * lives in scripts/lib/transportParity.mjs (unit-tested by
 * scripts/__tests__/transportParity.test.mjs); this file walks the tree,
 * applies the allowlist and reports.
 *
 * Scans frontend/src/**\/*.{ts,tsx}, excluding tests, __mocks__, .d.ts files
 * and the adapter itself (api/backendApi.ts, api/ElectronApiAdapter.ts —
 * `ipcOrHttp` is the ONE place a transport may be branched on).
 *
 *   A1  A `window.api` / `isElectron()` ternary or if/else whose BOTH branches
 *       build object literals — one payload per transport (CLAUDE.md rule
 *       22). This is the exact shape of the Settle Debt bug (camelCase on
 *       desktop, snake_case on web, one camelCase schema). No allowlist: a
 *       genuine exception carries `// transport-parity-exempt: <reason>`.
 *
 *   C1  Any `window.api` access (truthiness check, optional chain, raw call)
 *       — the "silently does nothing on the web" class. Allowed only by an
 *       entry in scripts/transport-parity-allowlist.json naming the file, the
 *       `window.api.<namespace>`s it may touch (`(bare)` = a truthiness
 *       check), and a reason. An entry marked `"temporary": true` is a KNOWN
 *       web defect kept visible rather than fixed today. An entry or
 *       namespace that no longer matches anything is STALE and fails the
 *       check, so fixing a defect forces its entry out.
 *
 *   B1  (plan §2: REST route passing bare req.body where the IPC twin injects
 *       an actor) is NOT implemented — it needs each route paired with its
 *       IPC handler by channel name, which is a project of its own.
 *
 * Modes (same shape as check-tenant-scoping.mjs):
 *   node scripts/check-transport-parity.mjs                full report; exit 1 on any violation/stale entry
 *   node scripts/check-transport-parity.mjs --stats         summary only; always exit 0
 *   node scripts/check-transport-parity.mjs --json          machine-readable JSON to stdout only
 *   node scripts/check-transport-parity.mjs --dir <path>    override the scan root (tests / validating old trees)
 *   node scripts/check-transport-parity.mjs --no-allowlist  report every C1 hit (validation against old commits)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SCAN_ROOT = path.join(REPO_ROOT, "frontend", "src");
const ALLOWLIST_PATH = path.join(__dirname, "transport-parity-allowlist.json");

// LIRA-123: "0 violations" and "scanned 0 files because the root moved" print
// identically unless the file count is checked. ~350 files in scope as of
// 2026-10; the floor only trips on a renamed/moved root.
const MIN_FILES_SCANNED = 200;

function parseArgs(argv) {
  const opts = {
    stats: false,
    json: false,
    dir: null,
    allowlist: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stats") opts.stats = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--dir") opts.dir = argv[++i];
    else if (a === "--no-allowlist") opts.allowlist = false;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`check-transport-parity.mjs — desktop/web transport-parity linter (rules A1, C1)

Usage:
  node scripts/check-transport-parity.mjs                full report; exit 1 on any violation/stale entry
  node scripts/check-transport-parity.mjs --stats         summary only; always exit 0
  node scripts/check-transport-parity.mjs --json          machine-readable JSON to stdout only
  node scripts/check-transport-parity.mjs --dir <path>    override the scan root
  node scripts/check-transport-parity.mjs --no-allowlist  report every C1 hit
`);
}

function walk(dir, root, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, root, acc);
    } else {
      acc.push(path.relative(root, p).split(path.sep).join("/"));
    }
  }
  return acc;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  let lib;
  try {
    lib = await import("./lib/transportParity.mjs");
  } catch (err) {
    // Rule 28a: a guard that cannot load its parser must fail, not pass.
    console.error(
      `check-transport-parity: could not load the rule module (is \`typescript\` installed? run yarn install): ${err.message}`,
    );
    process.exitCode = 1;
    return;
  }
  const { analyzeSource, applyAllowlist, isScannedPath, validateAllowlist } =
    lib;

  const root = opts.dir
    ? path.resolve(process.cwd(), opts.dir)
    : DEFAULT_SCAN_ROOT;
  const files = walk(root, root).filter(isScannedPath).sort();

  if (!opts.dir && files.length < MIN_FILES_SCANNED) {
    console.error(
      `check-transport-parity: only scanned ${files.length} file(s) (expected at least ` +
        `${MIN_FILES_SCANNED}) — the scan root is probably wrong: ${root}`,
    );
    process.exitCode = 1;
    return;
  }

  let allowlist = [];
  if (opts.allowlist) {
    try {
      allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    } catch (err) {
      console.error(
        `check-transport-parity: cannot read ${ALLOWLIST_PATH}: ${err.message}`,
      );
      process.exitCode = 1;
      return;
    }
    const errors = validateAllowlist(allowlist);
    if (errors.length) {
      console.error("check-transport-parity: invalid allowlist:");
      for (const e of errors) console.error(`  - ${e}`);
      process.exitCode = 1;
      return;
    }
  }

  const a1 = [];
  const a1Exempt = [];
  const c1ByFile = new Map();
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const r = analyzeSource(rel, text);
    for (const h of r.a1) a1.push({ file: rel, ...h });
    for (const h of r.a1Exempt) a1Exempt.push({ file: rel, ...h });
    if (r.c1.length) c1ByFile.set(rel, r.c1);
  }
  const c1 = applyAllowlist(c1ByFile, allowlist);
  // Without an allowlist, entries are not "stale" — there are none.
  const stale = opts.allowlist ? c1.stale : [];
  const c1Total = [...c1ByFile.values()].reduce((s, h) => s + h.length, 0);
  const temporary = allowlist.filter((e) => e.temporary);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          filesScanned: files.length,
          a1,
          a1Exempt,
          c1: {
            total: c1Total,
            allowed: c1.allowed,
            violations: c1.violations,
            stale,
          },
          allowlist: {
            entries: allowlist.length,
            desktopOnly: allowlist.length - temporary.length,
            temporaryWebDefects: temporary.length,
          },
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    if (!opts.stats) {
      for (const h of a1)
        console.log(
          `A1 ${h.file}:${h.line}  payload built per transport (${h.kind})  ${h.snippet}`,
        );
      for (const v of c1.violations)
        console.log(
          `C1 ${v.file}:${v.line}  window.api.${v.namespace === "(bare)" ? "(truthiness)" : v.namespace}` +
            `${v.listed ? " — namespace not in this file's allowlist entry" : " — file not allowlisted"}  ${v.snippet}`,
        );
      for (const s of stale)
        console.log(
          `STALE allowlist ${s.file} namespace "${s.namespace}" — no longer used; remove it from scripts/transport-parity-allowlist.json`,
        );
      if (a1.length || c1.violations.length || stale.length) console.log("");
    }
    console.log(
      `TOTAL — files scanned: ${files.length}, A1 payload-per-transport: ${a1.length} ` +
        `(exempt: ${a1Exempt.length}), C1 window.api accesses: ${c1Total} ` +
        `(allowlisted: ${c1.allowed}, violations: ${c1.violations.length}), stale allowlist: ${stale.length}`,
    );
    if (opts.allowlist)
      console.log(
        `Allowlist — ${allowlist.length} file(s): ${allowlist.length - temporary.length} desktop-only, ` +
          `${temporary.length} temporary (known web defects: ${temporary.map((e) => e.file).join(", ") || "none"})`,
      );
    if (!opts.stats && (a1.length || c1.violations.length || stale.length)) {
      console.log(
        "\nA1: build the payload ONCE and hand it to useApi() — ipcOrHttp is the only place a transport may be\n" +
          "branched on (CLAUDE.md rule 22). C1: route the call through useApi(); if it is genuinely desktop-only\n" +
          "(no web equivalent), add the file + namespace + reason to scripts/transport-parity-allowlist.json.",
      );
    }
  }

  // process.exitCode, not process.exit(): exit() can truncate piped stdout.
  const failed = a1.length > 0 || c1.violations.length > 0 || stale.length > 0;
  process.exitCode = !opts.stats && failed ? 1 : 0;
}

main();
