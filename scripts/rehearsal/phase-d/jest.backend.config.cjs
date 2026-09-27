/**
 * Phase D rehearsal, Part B — standalone jest config, backend-flavored.
 * Reuses `backend/jest.config.cjs` VERBATIM (same transform/tsconfig/
 * moduleNameMapper/setup file — nothing here is a second, hand-maintained
 * copy of those settings, rule 14) and only overrides `rootDir`/`roots` so
 * jest scans THIS folder instead of `backend/src`.
 *
 * Deliberately NOT discoverable by `backend/jest.config.cjs` itself (its
 * `roots: ["<rootDir>/src"]` never reaches `scripts/`) or by
 * `packages/core/jest.config.cjs` — this file, and the test it runs, are
 * never picked up by `yarn test` or CI. See `README.md` in this folder for
 * the command and what the test does.
 */
const path = require("node:path");

const backendConfig = require("../../../backend/jest.config.cjs");

/** @type {import('jest').Config} */
const config = {
  ...backendConfig,
  rootDir: path.join(__dirname, "../../../backend"),
  roots: [__dirname],
  displayName: "phase-d-rehearsal-backend",
  // Exactly this ONE file — `roots: [__dirname]` also contains
  // `split.phaseD.rehearsal.test.ts` (Part A, core-flavored), which must run
  // only under `jest.core.config.cjs` (this config's `better-sqlite3` ->
  // mock moduleNameMapper would silently turn `splitTenantDatabase()` into a
  // no-op if Part A ran here instead). testMatch/testRegex are mutually
  // exclusive in Jest, so testRegex (inherited from backendConfig) is
  // deleted below.
  testMatch: [path.join(__dirname, "runbook.phaseD.rehearsal.test.ts")],
};
delete config.testRegex;

module.exports = config;
