/**
 * FinancialServiceRepository.assertValidProvider —
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 3.
 *
 * Once `createFinancialServiceSchema.provider` (packages/core/src/
 * validators/financial.ts) stopped being a closed 9-value Zod enum
 * (migration v154 relaxed the matching DB CHECK to a composite FK), a
 * typo'd/unconfigured provider can reach the repository. `assertValidProvider`
 * is the repository-boundary membership check that catches it BEFORE any
 * write, so the failure is a clear message instead of either a silent
 * fall-through (`mapDrawerName`'s own, deliberately permissive, "General"
 * fallback — a different concern) or a raw SQLITE_CONSTRAINT from the new
 * FK.
 *
 * Accessed directly via `as unknown as {...}` (the private method is not
 * part of the public API) — same established pattern as
 * `FinancialServiceRepository.mapDrawerName.characterization.test.ts`, kept
 * intentionally lightweight (no drawer/payment machinery needed to exercise
 * this one guard).
 *
 * Rule 17 note: this test was run against the pre-fix repository (the
 * `this.assertValidProvider(data.provider);` call removed from
 * `createTransaction`) and observed to fail — a bogus provider fell through
 * silently — before the guard was added. See the method's own doc comment
 * in FinancialServiceRepository.ts for the fix.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { resetServiceProviderRepository } from "../ServiceProviderRepository";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
    clearDb: () => {
      _db = null;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setDb, clearDb } = jest.requireMock("../../db/connection") as {
  setDb: (db: Database.Database) => void;
  clearDb: () => void;
};

const SERVICE_PROVIDERS_SCHEMA = `
  CREATE TABLE service_providers (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id          INTEGER,
    code               TEXT NOT NULL,
    label              TEXT NOT NULL,
    drawer_name        TEXT NOT NULL,
    is_system_provider INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    is_system          INTEGER NOT NULL DEFAULT 0,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, code)
  );
`;

function seed(db: Database.Database): void {
  db.prepare(
    `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'OMT', 'OMT', 'OMT_System')`,
  ).run();
  db.prepare(
    `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'iPick', 'iPick', 'iPick')`,
  ).run();
}

/** Invoke the private `assertValidProvider` method without a full createTransaction() round trip. */
function assertValidProvider(
  repo: FinancialServiceRepository,
  provider: string,
): void {
  (
    repo as unknown as { assertValidProvider: (p: string) => void }
  ).assertValidProvider(provider);
}

describe("FinancialServiceRepository.assertValidProvider — provider-taxonomy membership check (plan §5b phase 3)", () => {
  afterEach(() => {
    clearDb();
    resetServiceProviderRepository();
    resetTenantContext();
  });

  it("accepts a provider with a matching service_providers row for this tenant", () => {
    const db = new Database(":memory:");
    db.exec(SERVICE_PROVIDERS_SCHEMA);
    seed(db);
    setDb(db);
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    expect(() => assertValidProvider(repo, "OMT")).not.toThrow();
  });

  it("accepts a mixed-case code exactly as stored (no case normalization)", () => {
    const db = new Database(":memory:");
    db.exec(SERVICE_PROVIDERS_SCHEMA);
    seed(db);
    setDb(db);
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    expect(() => assertValidProvider(repo, "iPick")).not.toThrow();
  });

  it("rejects a provider with no matching service_providers row (typo / unconfigured) with a clear message", () => {
    const db = new Database(":memory:");
    db.exec(SERVICE_PROVIDERS_SCHEMA);
    seed(db);
    setDb(db);
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    expect(() => assertValidProvider(repo, "SYRIA")).toThrow(
      /Invalid provider 'SYRIA'/,
    );
  });

  it("rejects a code seeded only for a DIFFERENT tenant, when THIS tenant has other rows configured (tenant-scoped membership, not global)", () => {
    const db = new Database(":memory:");
    db.exec(SERVICE_PROVIDERS_SCHEMA);
    seed(db); // tenant 1 gets OMT + iPick
    db.prepare(
      `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (2, 'WHISH', 'Whish', 'Whish_System')`,
    ).run();
    setDb(db);
    initFixedTenantContext(1); // tenant 1 is configured, but never got 'WHISH'
    const repo = new FinancialServiceRepository();

    expect(() => assertValidProvider(repo, "WHISH")).toThrow(/Invalid provider/);
  });

  it("does not reject anything when service_providers does not exist (pre-phase-1 DB / synthetic fixture — unchecked, matches mapDrawerName's own fallback)", () => {
    const db = new Database(":memory:"); // no service_providers table at all
    setDb(db);
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    expect(() => assertValidProvider(repo, "ANYTHING_AT_ALL")).not.toThrow();
  });

  it("does not reject anything when service_providers EXISTS but this tenant has zero rows — matches mapDrawerName's permissive 'empty' fallback, and protects generic DB-driver mocks", () => {
    const db = new Database(":memory:");
    db.exec(SERVICE_PROVIDERS_SCHEMA); // table exists, zero rows for tenant 1
    setDb(db);
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    // Deliberately permissive: a tenant with NO configured providers at all
    // is indistinguishable, from a single query's return value, from a
    // generic test double that stubs every `.get()`/`.all()` call to return
    // undefined/[] regardless of the SQL (exactly the shape
    // backend/src/services/__tests__/FinancialService.test.ts's
    // `createTrackingMock()` uses) — treating "empty" as "reject" broke that
    // whole class of test. In real production this state does not occur
    // (migration v153 / TenantRepository.seedServiceProviders always seed 9
    // rows per tenant), so the cost of staying permissive here is zero
    // there; the FK is still the real backstop if it somehow did.
    expect(() => assertValidProvider(repo, "OMT")).not.toThrow();
  });
});
