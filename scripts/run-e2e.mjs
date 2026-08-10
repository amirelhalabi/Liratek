#!/usr/bin/env node
/**
 * LIRA-123 — direct Playwright runner that bypasses `yarn <script>` /
 * `yarn workspace <name> <script>` for the actual e2e invocation.
 *
 * On this project's Windows dev setup, running Playwright through Yarn's own
 * script-execution layer can silently return exit 0 with ZERO output: the
 * underlying `playwright test` process never produces visible output (or its
 * exit code never makes it back through Yarn's relay), so
 * `yarn workspace @liratek/frontend test:e2e -g "some pattern"` reported
 * "success" in well under a second instead of running (or correctly
 * erroring on) anything — verified against a `-g` pattern that matches no
 * spec, which Playwright itself always fails on with "Error: No tests
 * found". A direct `npx playwright test ...`, with no `yarn run` / `yarn
 * workspace` hop anywhere in the chain, does not exhibit this — confirmed
 * reliable across many runs, including that exact probe.
 *
 * This script IS that direct invocation, plus the safety net that was
 * missing: it fails loudly if the run reports fewer completed tests than a
 * sane floor, even if the underlying process's own exit code was 0 (the
 * precise "ran nothing but reported green" failure mode above).
 *
 * Usage:
 *   node scripts/run-e2e.mjs electron [--min=N] [-- <playwright args>]
 *   node scripts/run-e2e.mjs web      [--min=N] [-- <playwright args>]
 *
 * A floor is applied automatically for un-filtered (full-suite) runs. Pass
 * -g/--grep and the floor is skipped automatically — a targeted run
 * legitimately produces a low count and should not be gated by it. Either
 * behavior can be overridden explicitly with --min=N (--min=0 disables it).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

// Resolve the Playwright CLI's own JS entry point (its package.json `bin`
// points at `cli.js`) instead of shelling out to `npx`/`npx.cmd`. This is
// deliberate, not a style choice: spawning a resolved .js file with
// `process.execPath` needs no shell and no PATHEXT probing, so it sidesteps
// two Windows-only failure modes hit while building this script — `npx.cmd`
// spawned with `shell:false` throws EINVAL (Node refuses to exec .cmd/.bat
// directly), and `shell:true` joins the whole args array into one string
// that YOU must quote yourself, silently splitting multi-word args like
// `-g "some test title"` into separate positional arguments. A plain node
// + .js-file + args-array spawn has none of that ambiguity on any platform.
const playwrightRequire = createRequire(path.join(FRONTEND_DIR, "package.json"));
const PLAYWRIGHT_CLI = playwrightRequire.resolve("@playwright/test/cli");

const CONFIGS = {
  electron: "playwright.electron.config.ts",
  web: "playwright.web.config.ts",
};

// Current suite sizes (2026-08): electron ~240-252 specs, web ~35-39 specs.
// Floors sit at roughly half of that — comfortably below normal churn
// (adding or removing a handful of specs never trips this) but nowhere near
// the 0 the LIRA-123 bug silently reported as a pass.
export const DEFAULT_MIN = {
  electron: 150,
  web: 20,
};

export function hasGrepFilter(args) {
  return args.some(
    (a) => a === "-g" || a === "--grep" || a.startsWith("--grep="),
  );
}

/**
 * Pure, unit-testable core of the floor check.
 *
 * `stats` is Playwright's JSON reporter top-level `stats` object
 * ({ expected, unexpected, skipped, flaky, ... }), or null if no JSON report
 * was written at all (the LIRA-123 failure mode: the process exited 0 but
 * nothing actually ran, so there is nothing to parse).
 */
export function evaluateFloor(stats, min) {
  if (min == null) {
    return {
      ok: true,
      total: null,
      reason: "no floor requested for this run",
    };
  }
  if (!stats) {
    return {
      ok: false,
      total: 0,
      reason:
        "no JSON report was written at all — the suite almost certainly did not run",
    };
  }
  const total =
    (stats.expected ?? 0) +
    (stats.unexpected ?? 0) +
    (stats.skipped ?? 0) +
    (stats.flaky ?? 0);
  if (total < min) {
    return {
      ok: false,
      total,
      reason: `reported ${total} test(s), below the floor of ${min} — the suite likely did not run`,
    };
  }
  return {
    ok: true,
    total,
    reason: `reported ${total} test(s), meets the floor of ${min}`,
  };
}

function main() {
  const [target, ...rest] = process.argv.slice(2);
  if (!CONFIGS[target]) {
    console.error(
      `run-e2e: first argument must be "electron" or "web" (got ${JSON.stringify(target)})`,
    );
    process.exitCode = 1;
    return;
  }

  let minOverride;
  const passthrough = [];
  for (const arg of rest) {
    const m = /^--min=(\d+)$/.exec(arg);
    if (m) minOverride = Number(m[1]);
    else passthrough.push(arg);
  }

  const min =
    minOverride !== undefined
      ? minOverride
      : hasGrepFilter(passthrough)
        ? null // targeted run — a low count is expected, don't gate it
        : DEFAULT_MIN[target];

  const reportFile = path.join(FRONTEND_DIR, `.e2e-report-${target}.json`);
  if (existsSync(reportFile)) unlinkSync(reportFile);

  const args = [
    "test",
    "--config",
    CONFIGS[target],
    "--reporter=list,json",
    ...passthrough,
  ];

  console.log(`[run-e2e] cwd=${FRONTEND_DIR}`);
  console.log(`[run-e2e] ${process.execPath} ${PLAYWRIGHT_CLI} ${args.join(" ")}`);

  const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, ...args], {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
  });

  let stats = null;
  if (existsSync(reportFile)) {
    try {
      const parsed = JSON.parse(readFileSync(reportFile, "utf8"));
      stats = parsed.stats ?? null;
    } catch (e) {
      console.error(`[run-e2e] could not parse JSON report: ${e.message}`);
    } finally {
      try {
        unlinkSync(reportFile);
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  const floor = evaluateFloor(stats, min);
  console.log(`[run-e2e] ${floor.reason}`);

  if (result.error) {
    console.error(`[run-e2e] failed to launch Playwright: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.status !== 0) {
    // Playwright already reported the real failure (test failures, "No
    // tests found", a config error, ...) — propagate it as-is.
    process.exitCode = result.status ?? 1;
    return;
  }

  if (!floor.ok) {
    console.error(
      `[run-e2e] FLOOR CHECK FAILED — ${floor.reason}. Treating this run as a ` +
        `FAILURE even though the process exit code was 0 — this is the exact ` +
        `LIRA-123 failure mode (a green exit code without the suite actually running).`,
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
