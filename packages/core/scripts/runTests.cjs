#!/usr/bin/env node
/**
 * LIRA-168 — platform-aware launcher for `packages/core`'s jest suite.
 *
 * `TZ=Asia/Beirut` pinned at process launch is required so the suite runs
 * against a deterministic non-UTC business day (CLOSINGRepository/
 * ProfitRepository's `*.localBusinessDay.test.ts` files need a non-UTC
 * runner — see their own doc comments). On Linux (CI, and most dev/CI
 * environments) this is harmless: glibc's `localtime()` and Node's ICU both
 * correctly resolve the IANA zone name `Asia/Beirut`, so SQLite (via
 * better-sqlite3) and Node's own `Date` getters agree.
 *
 * On WINDOWS this pin is actively harmful. Measured 2026-09-04 (LIRA-168) and
 * re-verified here: better-sqlite3's bundled SQLite resolves `'localtime'`
 * through the Windows C runtime's `localtime()`, which cannot parse an IANA
 * zone name (`Asia/Beirut`) — it silently falls back to UTC+0 plus the
 * CRT's baked-in US DST default rule. Node's `Date` getters, by contrast,
 * correctly resolve `Asia/Beirut` via ICU regardless of platform. Pinning
 * `TZ=Asia/Beirut` on Windows therefore makes Node and SQLite DISAGREE on the
 * current offset by ~1-2h, every run — not just during a narrow midnight
 * window — which can silently flip which calendar day a SQL-bucketed query
 * and a JS-bucketed comparison land on for timestamps near a day boundary.
 *
 * No single TZ environment-variable VALUE fixes both sides at once on
 * Windows: the Windows CRT only understands the POSIX
 * `std offset[dst offset,rule]` syntax (confirmed working, e.g.
 * `EET-2EEST,M3.5.0/0,M10.5.0/0` correctly produces Beirut's real +3h/+2h
 * DST/STD offsets in SQLite), while Node's ICU-backed `Date` getters only
 * understand real IANA zone identifiers and silently resolve ANY POSIX-style
 * string to UTC+0 (verified: `EET-2EEST,...`, `XXX-3`, `<+03>-3`, `UTC+3` all
 * produced `getTimezoneOffset() === 0` under Node on this platform). The two
 * runtimes require mutually exclusive TZ syntaxes — there is no overlap to
 * exploit.
 *
 * Fix: on Windows, do NOT pin TZ at all — leave it unset so BOTH runtimes
 * fall back to their own (correct, OS-API-based) resolution of the machine's
 * configured Windows timezone, which agree with each other by construction
 * (verified: TZ unset, both sides report the SAME offset). This relies on
 * the Windows dev machine's OS timezone actually being non-UTC (true for
 * every machine this has shipped on) — `src/jest.setup.ts`'s own
 * `assertSqlJsTimezoneOffsetsAgree()` probe (added alongside this file) is
 * the fail-fast guard for the case that assumption breaks, on EITHER
 * platform: it throws a clear, actionable error before any test body runs
 * if SQLite's and Node's offsets disagree for any reason, instead of
 * leaving individual date-boundary assertions to fail mysteriously (or, if
 * no fixture happens to straddle midnight, to pass despite being wrong).
 *
 * CI (Ubuntu) is completely unaffected by this file: `process.platform` is
 * `'linux'` there, so the TZ pin is applied exactly as before.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const coreRoot = path.join(__dirname, "..");
const repoRoot = path.join(coreRoot, "..", "..");
const jestBin = path.join(repoRoot, "node_modules", "jest", "bin", "jest.js");

const env = { ...process.env };
if (process.platform !== "win32") {
  env.TZ = "Asia/Beirut";
}

const result = spawnSync(
  process.execPath,
  [jestBin, "--config", "jest.config.cjs", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: coreRoot, env },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status === null ? 1 : result.status);
