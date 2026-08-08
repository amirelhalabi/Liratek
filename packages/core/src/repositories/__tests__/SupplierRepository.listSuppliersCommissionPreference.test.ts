/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md D8 — reviewer finding #1 (FIX_FIRST):
 * the UI stage claimed `listSuppliers()` returns `commission_entry_mode`/
 * `commission_rate` (the Settlement UI's `selectedSupplier?.commission_entry_mode
 * ?? 'LUMP'` pre-select, Suppliers/index.tsx ~755), but only the
 * `SupplierEntity` TypeScript interface (SupplierRepository.ts ~40-48) ever
 * got the fields — the actual SQL in `getColumns()` never selected them.
 * `listSuppliers()` backs BOTH the IPC handler AND the REST route, so this
 * broke the preference read end-to-end on both transports.
 *
 * Rule 17: this test was run against the pre-fix `getColumns()` (missing
 * `commission_entry_mode`/`commission_rate`) and OBSERVED FAILING —
 * `supplier!.commission_entry_mode` read `undefined`, not `'RATE'`:
 *
 *   expect(received).toBe(expected)
 *   Expected: "RATE"
 *   Received: undefined
 *
 * Reverting `getColumns()` to the pre-fix column list reproduces this
 * failure; the fix below (adding the two columns, COALESCE'ing
 * `commission_entry_mode`) makes it pass.
 */

import Database from "better-sqlite3";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE suppliers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      note         TEXT,
      provider     TEXT,
      is_system    INTEGER NOT NULL DEFAULT 0,
      is_active    INTEGER NOT NULL DEFAULT 1,
      module_key   TEXT,
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')),
      commission_rate REAL,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      key_name  TEXT NOT NULL,
      value     TEXT
    );
  `);
  return db;
}

describe("SupplierRepository.listSuppliers — D8 commission preference round-trip", () => {
  let db: Database.Database;
  let repo: SupplierRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSupplierRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetSupplierRepository();
    resetTenantContext();
  });

  it("round-trips a seeded RATE/7000 supplier's commission preference through the real listSuppliers()", () => {
    db.prepare(
      `INSERT INTO suppliers (id, name, provider, commission_entry_mode, commission_rate)
       VALUES (1, 'Katsh', 'Katsh', 'RATE', 7000)`,
    ).run();

    const supplier = repo.listSuppliers().find((s) => s.id === 1);
    expect(supplier).toBeDefined();
    expect(supplier!.commission_entry_mode).toBe("RATE");
    expect(supplier!.commission_rate).toBe(7000);
  });

  it("COALESCEs a NULL (pre-v150) commission_entry_mode to 'LUMP' and leaves commission_rate null", () => {
    db.prepare(
      `INSERT INTO suppliers (id, name, provider, commission_entry_mode, commission_rate)
       VALUES (2, 'OMT', 'OMT', NULL, NULL)`,
    ).run();

    const supplier = repo.listSuppliers().find((s) => s.id === 2);
    expect(supplier).toBeDefined();
    expect(supplier!.commission_entry_mode).toBe("LUMP");
    expect(supplier!.commission_rate).toBeNull();
  });
});
