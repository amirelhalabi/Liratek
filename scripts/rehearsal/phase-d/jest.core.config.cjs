/**
 * Phase D rehearsal, Part A — standalone jest config, core-flavored (real
 * better-sqlite3). Reuses `packages/core/jest.config.cjs` VERBATIM (same
 * transform/tsconfig/moduleNameMapper/setup file — nothing here is a second,
 * hand-maintained copy of those settings, rule 14) and only overrides
 * `rootDir`/`roots` so jest scans THIS folder instead of `packages/core/src`.
 *
 * Deliberately NOT discoverable by `packages/core/jest.config.cjs` itself
 * (its `roots: ["<rootDir>/src"]` never reaches `scripts/`) or by
 * `backend/jest.config.cjs` — this file, and the test it runs, are never
 * picked up by `yarn test` or CI. See `README.md` in this folder for the
 * command and what the test does.
 */
const path = require("node:path");

const coreConfig = require("../../../packages/core/jest.config.cjs");

/** @type {import('jest').Config} */
const config = {
  ...coreConfig,
  rootDir: path.join(__dirname, "../../../packages/core"),
  roots: [__dirname],
  displayName: "phase-d-rehearsal-core",
  // Exactly this ONE file — `roots: [__dirname]` also contains
  // `runbook.phaseD.rehearsal.test.ts` (Part B, backend-flavored), which
  // must run only under `jest.backend.config.cjs` (it needs the
  // `@liratek/core` -> source moduleNameMapper that only backend's config
  // has; under this config it resolves the built package instead, which is
  // ESM and fails to parse). testMatch/testRegex are mutually exclusive in
  // Jest, so testRegex (inherited from coreConfig) is deleted below.
  testMatch: [path.join(__dirname, "split.phaseD.rehearsal.test.ts")],
};
delete config.testRegex;

module.exports = config;
