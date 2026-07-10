import { jest } from "@jest/globals";
import { mockDatabase } from "./__mocks__/better-sqlite3";

// Provide a global hook consumed by @liratek/core db/connection
// so repositories/services can run in Jest without initializing a real DB.
(globalThis as any).__LIRATEK_TEST_DB__ = mockDatabase;

// Multi-tenant retrofit (WP1b/WP2b): BaseRepository's generic CRUD methods
// now resolve tenant_id via getCurrentTenantId(), which throws fail-closed
// if no tenant context is set. Backend jest suites predate multi-tenancy and
// don't wrap calls in runWithTenant(), so fix a single fallback tenant (1)
// for the whole process — mirrors Electron's single-tenant desktop mode.
//
// The require() is deferred into beforeEach (NOT a top-level import) for two
// independent reasons:
//  1. Runtime: requiring "@liratek/core" (or any submodule reaching into
//     packages/core/src) at THIS file's top level would force-evaluate the
//     whole core module graph (AuthService, crypto, RateRepository, ...)
//     before each test file's own hoisted `jest.mock("@liratek/core", ...)` /
//     `jest.mock(".../crypto.ts")` calls take effect, silently defeating
//     those mocks (observed firsthand: AuthService/ExchangeService started
//     exercising the REAL crypto/rate modules once this file eagerly
//     imported "@liratek/core" at the top level). Deferring to beforeEach
//     runs it after the test file's own module — and its jest.mock() calls —
//     have already been evaluated.
//  2. Typecheck: a static `import` reaching into packages/core/src from this
//     file trips tsconfig.typecheck.json's rootDir check (TS6059), since
//     that file lives outside backend/src. A plain runtime `require()`
//     isn't statically resolved by tsc, so it never enters the
//     rootDir-constrained program.
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { initFixedTenantContext } = require("../../packages/core/src/db/tenantContext");
  initFixedTenantContext(1);
});

// Silence noisy logs from services; tests should assert return values.
jest.spyOn(console, "log").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});
