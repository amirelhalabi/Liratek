#!/usr/bin/env node
/**
 * LIRA-170 — sequential, no-bail, all-workspaces test runner.
 *
 * Root `package.json`'s `test` script used to be
 *   "npm run rebuild:node && yarn workspaces foreach -A --exclude liratek run test"
 * `-A` (all workspaces) with no `-t`/`--topological` and no `-p`/`--parallel`
 * runs `foreach` sequentially in workspace-list order and STOPS at the first
 * workspace whose `test` script exits non-zero. Observed 2026-09-04: a
 * frontend test timed out, the run ended there, and `packages/core`'s ~2700
 * money-logic tests never ran — the output said only "Failed with errors in
 * 1m 42s", with nothing indicating an entire workspace was skipped. Adding
 * `-t` alone only moves the blind spot (core would then run first and a core
 * failure would bail before backend/frontend ran) — `foreach` has no
 * no-bail option, so ordering alone can't give "run everything, report
 * everything".
 *
 * This script IS that "run everything, report everything" replacement. In
 * the same spirit as scripts/run-e2e.mjs (written for the identical class of
 * bug — a step that runs nothing and exits 0 being indistinguishable from a
 * pass): it runs each testable workspace as its own child process (so one
 * workspace's exit code can never suppress another's), captures the REAL
 * exit code of each (never a piped/relayed status — see LIRA-123's
 * `cmd | tail` lesson referenced throughout this repo), parses jest's own
 * "Test Suites:" / "Tests:" summary lines out of the captured output, and
 * refuses to call a workspace green unless it exited 0 AND reported at
 * least one test — the same floor idea as run-e2e.mjs's DEFAULT_MIN, applied
 * per-workspace instead of via a JSON reporter (jest's text summary is the
 * only output every workspace's `test` script is guaranteed to produce).
 *
 * The workspace list itself comes from `yarn workspaces list --json` (the
 * live workspace graph), not a hardcoded array — so it can't rot as
 * workspaces are added/removed. Root is excluded by location ("."), and any
 * workspace with no `test` script in its own package.json is skipped
 * (currently: @liratek/ui, @liratek/electron-app). Workspaces under
 * `packages/*` run before everything else, since core is a dependency of
 * the others and its regressions are the ones most worth surfacing first.
 *
 * Usage: node scripts/run-tests.mjs
 * (invoked by the root "test" script, after `npm run rebuild:node`)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/**
 * Ask yarn itself for the workspace graph rather than hardcoding a list or
 * re-implementing the `packages/*` glob — this is the "derive from actual
 * workspace config" requirement. `yarn workspaces list --json` prints one
 * JSON object per line: { location, name }.
 */
function listWorkspaces() {
  const result = spawnSync("yarn", ["workspaces", "list", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
  });
  if (result.error) {
    console.error(
      `[run-tests] failed to launch "yarn workspaces list --json": ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `[run-tests] "yarn workspaces list --json" exited ${result.status}:\n${result.stderr}`,
    );
    process.exit(1);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Reads the workspace's own package.json and reports whether it declares a `test` script. */
function hasTestScript(location) {
  const pkgPath = path.join(ROOT, location, "package.json");
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return (
    typeof pkg.scripts?.test === "string" && pkg.scripts.test.trim().length > 0
  );
}

/**
 * `packages/*` (currently just @liratek/core, since @liratek/ui has no test
 * script) runs before everything else — it's the dependency the other
 * workspaces build on, so its regressions are the most valuable to see
 * first in the summary. Stable sort: relative order within each group is
 * whatever `yarn workspaces list` returned.
 */
function priority(ws) {
  return ws.location.startsWith("packages/") ? 0 : 1;
}

/** Pulls the trailing "N total" (or 0 if absent) out of a jest summary line's tail. */
function extractTotal(tail) {
  const m = /(\d+)\s+total/.exec(tail);
  return m ? Number(m[1]) : null;
}

/** Pulls the "N <label>" count (e.g. "2 failed") out of a jest summary line's tail, defaulting to 0. */
function extractCount(tail, label) {
  const m = new RegExp(`(\\d+)\\s+${label}`).exec(tail);
  return m ? Number(m[1]) : 0;
}

/**
 * Parses jest's own textual summary — the one block every jest run prints
 * regardless of reporter config, so it's the one thing we can rely on across
 * all three workspaces without touching their jest configs:
 *   Test Suites: 2 failed, 260 passed, 262 total
 *   Tests:       5 failed, 2768 passed, 2773 total
 * Returns nulls when the lines are absent — e.g. the process crashed before
 * jest ever printed a summary, which is itself a "produced no counts" case.
 */
function parseJestSummary(output) {
  const suitesLine = /Test Suites:\s*(.+)/.exec(output);
  const testsLine = /Tests:\s*(.+)/.exec(output);
  return {
    suitesTotal: suitesLine ? extractTotal(suitesLine[1]) : null,
    suitesFailed: suitesLine ? extractCount(suitesLine[1], "failed") : null,
    testsTotal: testsLine ? extractTotal(testsLine[1]) : null,
    testsFailed: testsLine ? extractCount(testsLine[1], "failed") : null,
  };
}

/**
 * Runs one workspace's `test` script to completion and resolves with its
 * REAL exit code from the child process's own `close` event — never a
 * status relayed through a shell pipe (this repo has been burned repeatedly
 * by `cmd | tail` masking a real failure as the pipe's own exit 0; nothing
 * here pipes a status-bearing command). `shell: true` is only to resolve the
 * `yarn` executable itself (a corepack .cmd shim on Windows) — none of the
 * arguments contain spaces or need shell quoting, so it introduces no
 * quoting ambiguity.
 *
 * Output is streamed live to this process's own stdout/stderr (so a long
 * core run isn't silent) AND accumulated so the jest summary can be parsed
 * afterward.
 */
function runWorkspaceTest(ws) {
  return new Promise((resolve) => {
    const start = Date.now();
    const args = ["workspace", ws.name, "run", "test"];
    console.log(`\n[run-tests] ==== ${ws.name} (${ws.location}) ====`);
    console.log(`[run-tests] yarn ${args.join(" ")}`);

    const child = spawn("yarn", args, { cwd: ROOT, shell: true });
    let output = "";

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += chunk;
    });

    child.on("error", (err) => {
      resolve({
        ws,
        code: null,
        elapsedMs: Date.now() - start,
        launchError: err.message,
        summary: { suitesTotal: null, suitesFailed: null, testsTotal: null, testsFailed: null },
      });
    });

    child.on("close", (code) => {
      resolve({
        ws,
        code,
        elapsedMs: Date.now() - start,
        launchError: null,
        summary: parseJestSummary(output),
      });
    });
  });
}

function fmtElapsed(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * A workspace only counts as a pass if it (a) exited 0 AND (b) reported at
 * least one test. (b) is the run-e2e.mjs floor lesson applied here: a
 * workspace that runs nothing and exits 0 must not read as a pass. A
 * workspace whose summary couldn't be parsed at all (crash before jest ever
 * printed one) fails (a)/(b) automatically since testsTotal stays null.
 */
function isOk(result) {
  return (
    result.code === 0 &&
    result.summary.testsTotal !== null &&
    result.summary.testsTotal > 0
  );
}

function printSummary(results) {
  const rows = results.map((r) => {
    const { summary } = r;
    const suites =
      summary.suitesTotal === null ? "—" : `${summary.suitesTotal}`;
    const tests = summary.testsTotal === null ? "—" : `${summary.testsTotal}`;
    const status = r.launchError
      ? "LAUNCH ERROR"
      : isOk(r)
        ? "passed"
        : summary.testsTotal === null
          ? "FAILED (no counts)"
          : "FAILED";
    return {
      workspace: r.ws.name,
      exit: r.code === null ? "—" : String(r.code),
      suites,
      tests,
      elapsed: fmtElapsed(r.elapsedMs),
      status,
    };
  });

  const headers = ["workspace", "exit", "suites", "tests", "elapsed", "status"];
  const widths = headers.map((h) =>
    Math.max(h.length, ...rows.map((r) => String(r[h]).length)),
  );

  const line = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");

  console.log("\n[run-tests] ==== summary ====");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(
      line([r.workspace, r.exit, r.suites, r.tests, r.elapsed, r.status]),
    );
  }

  const failed = results.filter((r) => !isOk(r));
  if (failed.length > 0) {
    console.log(
      `\n[run-tests] FAILED: ${failed.map((r) => r.ws.name).join(", ")}`,
    );
  } else {
    console.log("\n[run-tests] all workspaces passed");
  }
}

async function main() {
  const all = listWorkspaces().filter((ws) => ws.location !== ".");
  const testable = all.filter((ws) => hasTestScript(ws.location));

  if (testable.length === 0) {
    console.error(
      "[run-tests] no workspace declares a `test` script — nothing to run",
    );
    process.exitCode = 1;
    return;
  }

  const ordered = [...testable].sort((a, b) => priority(a) - priority(b));

  console.log(
    `[run-tests] running ${ordered.length} workspace(s) serially: ${ordered
      .map((w) => w.name)
      .join(" -> ")}`,
  );

  const results = [];
  for (const ws of ordered) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential: every workspace must run regardless of earlier failures
    const result = await runWorkspaceTest(ws);
    if (result.launchError) {
      console.error(
        `[run-tests] failed to launch tests for ${ws.name}: ${result.launchError}`,
      );
    }
    results.push(result);
  }

  printSummary(results);

  process.exitCode = results.every(isOk) ? 0 : 1;
}

main();
