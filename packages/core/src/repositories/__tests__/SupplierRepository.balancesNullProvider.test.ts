/**
 * SupplierRepository.getSupplierBalances — provider-less suppliers must
 * appear in the balances list.
 *
 * Pre-fix, the secondary-system exclusion evaluated
 * `s.provider IN ('OMT','WHISH')` — SQL NULL for a NULL provider — and
 * `NOT (NULL AND …)` is NULL, so every supplier without a provider was
 * silently dropped from getSupplierBalances(). Invisible in the UI (the
 * Companies view only lists provider-bearing system suppliers; product
 * suppliers use getProductSupplierBalances) but wrong at the API surface —
 * caught by lira-web-015 asserting a fresh plain supplier's balance delta.
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
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER NOT NULL DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      entry_type  TEXT NOT NULL,
      amount_usd  REAL NOT NULL DEFAULT 0,
      amount_lbp  REAL NOT NULL DEFAULT 0,
      note        TEXT,
      created_by  INTEGER,
      transaction_id INTEGER,
      is_auto     INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
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

describe("SupplierRepository.getSupplierBalances — NULL-provider inclusion", () => {
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

  it("includes a provider-less supplier with its ledger balance", () => {
    db.prepare(
      `INSERT INTO suppliers (id, name, provider) VALUES (1, 'Plain Supplier', NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd)
       VALUES (1, 'PAYMENT', -42.5)`,
    ).run();

    const balances = repo.getSupplierBalances();
    const row = balances.find((b) => b.supplier_id === 1);
    expect(row).toBeDefined();
    expect(row!.total_usd).toBeCloseTo(-42.5, 2);
  });

  it("listSuppliers includes a provider-less supplier (same NULL trap)", () => {
    db.prepare(
      `INSERT INTO suppliers (id, name, provider) VALUES (1, 'Plain Supplier', NULL)`,
    ).run();
    const ids = repo.listSuppliers().map((s) => s.id);
    expect(ids).toContain(1);
  });

  it("still hides the secondary OMT/WHISH system (base defaults to OMT)", () => {
    db.prepare(
      `INSERT INTO suppliers (id, name, provider, is_system) VALUES (2, 'OMT Co', 'OMT', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO suppliers (id, name, provider, is_system) VALUES (3, 'Whish Co', 'WHISH', 1)`,
    ).run();

    const ids = repo.getSupplierBalances().map((b) => b.supplier_id);
    expect(ids).toContain(2); // base system (default OMT) stays
    expect(ids).not.toContain(3); // secondary system hidden
  });
});
