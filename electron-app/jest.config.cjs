/**
 * Minimal, scoped jest config for electron-app.
 *
 * electron-app has NO test infra today (no jest.config, no "test" script in
 * package.json — see docs/plans/todo_plans/BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
 * §6bis Phase A2 Fix 3). This file exists ONLY to run
 * schemas/__tests__/FinancialServiceSchema.feePayments.test.ts (a pure Zod
 * schema test with no Electron/DB dependency) via an ad hoc
 * `npx jest --config jest.config.cjs <path>` invocation — it is NOT wired
 * into any yarn/npm script or CI job. Do not assume this covers the rest of
 * electron-app/handlers/__tests__/*.test.ts (those are pre-existing, already
 * orphaned from any runner, and out of scope here).
 *
 * Modeled on backend/jest.config.cjs's pattern for the same reason it maps
 * "@liratek/core" to the package's TS SOURCE (not node_modules/@liratek/core
 * dist): the compiled dist package.json declares `"type": "module"`, and a
 * plain CommonJS `require("@liratek/core")` of an ESM-only package throws
 * ERR_REQUIRE_ESM under ts-jest's default (non-ESM) transform. Mapping to
 * source lets ts-jest recompile @liratek/core to CommonJS in the same pass.
 */

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/schemas"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@liratek/core$": "<rootDir>/../packages/core/src/index.ts",
  },
};
