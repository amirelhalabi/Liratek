/**
 * Jest config for electron-app.
 *
 * Runs two suites: `schemas/__tests__/` (pure Zod schema tests, no
 * Electron/DB dependency) and `handlers/__tests__/` (IPC handler suites —
 * every one mocks `@liratek/core` and/or `../../db` wholesale, so none of
 * them touch a real better-sqlite3 binding or need a native rebuild). Wired
 * into `yarn workspace @liratek/electron-app test` and the "Electron Handler
 * Tests" CI job (`.github/workflows/ci.yml`). As of 2026-09-13 (the revival
 * pass that wired this up): 30 passing suites / 155 tests (29 handler
 * suites + the pre-existing schema suite this config already ran).
 *
 * REVIVAL HISTORY: until 2026-09-13, `roots` only listed `schemas`, so the
 * 31 suites under `handlers/__tests__/` were orphaned from any runner — 15
 * had rotted unnoticed. They were repaired and this config was extended to
 * run them for real; see docs/plans/todo_plans/BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
 * §6bis Phase A2 Fix 3 for the prior state.
 *
 * EXCLUDED, PERMANENTLY (until one of the two fixes below lands):
 * `handlers/__tests__/updaterHandlers.test.ts` and
 * `updaterHandlers_registration.test.ts`. Root cause (verified by direct
 * execution against the unmodified files, not inferred): `updaterHandlers.ts`
 * computes `__filename`/`__dirname` via `fileURLToPath(import.meta.url)` —
 * valid real ESM, matching how the app actually ships
 * (`tsconfig.json`: `"module": "ES2022"`; `dist/package.json`:
 * `"type": "module"`). ts-jest without `useESM` unconditionally forces
 * `module: CommonJS` regardless of tsconfig, and `diagnostics: false` lets it
 * swallow the resulting `import.meta` error and emit the line anyway. Jest
 * then wraps the compiled module in its usual
 * `function(module, exports, require, __dirname, __filename) {...}` closure,
 * and the module body's own `const __filename = ...` collides with the
 * wrapper's `__filename` PARAMETER — `SyntaxError: Identifier '__filename'
 * has already been declared`, thrown while Jest is still PARSING the file,
 * before any `jest.mock()` factory or test body runs. No test-file edit and
 * no amount of mocking can fix this.
 *
 * A second, independent, currently-unreachable problem in the same files:
 * `updaterHandlers.ts` calls `createRequire(import.meta.url)("electron-updater")`,
 * which bypasses Jest's sandboxed per-module `require` — so even with the
 * parse issue fixed, `jest.mock("electron-updater")` would not be observed
 * in packaged-mode tests.
 *
 * Real fixes (either lifts the quarantine — do not attempt without one):
 *   (a) turn on ts-jest's `useESM: true` + `extensionsToTreatAsEsm: [".ts"]`
 *       and invoke Jest with `--experimental-vm-modules`; or
 *   (b) stop deriving `__dirname`/`__filename` from `import.meta.url` in
 *       `updaterHandlers.ts`/`main.ts` (production code change, out of scope
 *       for a test-runner fix).
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
  roots: ["<rootDir>/schemas", "<rootDir>/handlers"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  testPathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/handlers/__tests__/updaterHandlers.test.ts$",
    "<rootDir>/handlers/__tests__/updaterHandlers_registration.test.ts$",
  ],
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
