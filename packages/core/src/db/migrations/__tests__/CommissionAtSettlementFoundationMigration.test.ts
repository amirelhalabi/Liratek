/**
 * Migration v150 — commission_at_settlement_foundation
 * (COMMISSION_AT_SETTLEMENT_PLAN.md §3/Phase 0).
 *
 * Proves:
 *  - `financial_services.commission_model` is added with every PRE-EXISTING
 *    row reading 0 (EMBEDDED/legacy) after the ALTER — the exact CLAUDE.md
 *    rule-10/D3 guarantee the plan's §3 migration spec names, precedent
 *    `SupplierPaymentIsAutoBackfillMigration.test.ts`/
 *    `SupplierLedgerDiscountCheckMigration.test.ts` (constructed directly
 *    against the migration's up()/down(), MIGRATIONS.find(...) pattern).
 *  - `suppliers.commission_entry_mode`/`commission_rate` are added (D8).
 *  - `supplier_settlements` (D5) and `settlement_commission_allocations`
 *    (D6) are created with their CHECK constraints enforced.
 *  - down() reverses all of it, and is defensive against a
 *    suppliers-less/financial_services-less DB (the
 *    `telecomDaysCostMigrationsViaRunner.test.ts` synthetic-harness
 *    scenario — mirrors the v149 `hasRecharges` guard).
 *
 * Constructed directly against the migration's up()/down() (mirrors the
 * `MIGRATIONS.find(...).up(db)` pattern used by
 * `SupplierLedgerDiscountCheckMigration.test.ts`).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // Mirrors the real migration runner's pragma toggle around every up()/
  // down() (db/migrations/index.ts's runMigrations()) — this test calls
  // v150.up()/down() directly, bypassing that driver, so it replicates the
  // toggle itself. Needed because supplier_settlements/settlement_commission
  // _allocations carry REFERENCES tenants(id)/users(id) that this minimal
  // fixture doesn't create.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      commission REAL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      provider TEXT
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertFsRow(
  db: Database.Database,
  opts: { provider: string; serviceType: string; commission?: number },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO financial_services (provider, service_type, amount, commission)
         VALUES (?, ?, 100, ?)`,
      )
      .run(opts.provider, opts.serviceType, opts.commission ?? 0)
      .lastInsertRowid,
  );
}

function insertSupplier(db: Database.Database, name: string): number {
  return Number(
    db
      .prepare(`INSERT INTO suppliers (name, provider) VALUES (?, ?)`)
      .run(name, name).lastInsertRowid,
  );
}

function insertLedgerRow(db: Database.Database, supplierId: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd)
         VALUES (?, 'SETTLEMENT', -10)`,
      )
      .run(supplierId).lastInsertRowid,
  );
}

describe("migration v150 — commission_at_settlement_foundation", () => {
  const v150 = MIGRATIONS.find((m) => m.version === 150)!;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("exists and has a down()", () => {
    expect(v150).toBeDefined();
    expect(
      Math.max(...MIGRATIONS.map((m) => m.version)),
    ).toBeGreaterThanOrEqual(150);
    expect(typeof v150.down).toBe("function");
  });

  it("rejects commission_model BEFORE the migration runs (proves the column doesn't exist yet)", () => {
    insertFsRow(db, { provider: "OMT", serviceType: "SEND" });
    expect(() =>
      db.prepare(`SELECT commission_model FROM financial_services`).get(),
    ).toThrow(/no such column/);
  });

  it("pre-existing financial_services rows read commission_model = 0 after the ALTER (D3, rule 10)", () => {
    const id1 = insertFsRow(db, {
      provider: "OMT",
      serviceType: "SEND",
      commission: 5,
    });
    const id2 = insertFsRow(db, {
      provider: "iPick",
      serviceType: "BILL",
      commission: 0,
    });

    v150.up(db);

    const rows = db
      .prepare(
        `SELECT id, commission_model FROM financial_services ORDER BY id`,
      )
      .all() as Array<{ id: number; commission_model: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id1)?.commission_model).toBe(0);
    expect(rows.find((r) => r.id === id2)?.commission_model).toBe(0);
  });

  it("a row inserted AFTER the migration defaults to commission_model = 0 too (only the repository's explicit stamp makes it 1)", () => {
    v150.up(db);
    const id = insertFsRow(db, { provider: "OMT", serviceType: "SEND" });
    const row = db
      .prepare(`SELECT commission_model FROM financial_services WHERE id = ?`)
      .get(id) as { commission_model: number };
    expect(row.commission_model).toBe(0);
  });

  it("adds suppliers.commission_entry_mode (default 'LUMP') and commission_rate (nullable)", () => {
    const supplierId = insertSupplier(db, "OMT");
    v150.up(db);

    const row = db
      .prepare(
        `SELECT commission_entry_mode, commission_rate FROM suppliers WHERE id = ?`,
      )
      .get(supplierId) as {
      commission_entry_mode: string;
      commission_rate: number | null;
    };
    expect(row.commission_entry_mode).toBe("LUMP");
    expect(row.commission_rate).toBeNull();
  });

  it("enforces the commission_entry_mode CHECK ('LUMP'/'RATE' only)", () => {
    v150.up(db);
    const supplierId = insertSupplier(db, "WHISH");
    expect(() =>
      db
        .prepare(
          `UPDATE suppliers SET commission_entry_mode = 'RATE' WHERE id = ?`,
        )
        .run(supplierId),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `UPDATE suppliers SET commission_entry_mode = 'BOGUS' WHERE id = ?`,
        )
        .run(supplierId),
    ).toThrow(/CHECK constraint failed/);
  });

  it("creates supplier_settlements (D5) with its CHECK constraints and ledger_entry_id UNIQUE", () => {
    v150.up(db);
    const supplierId = insertSupplier(db, "OMT");
    const ledgerId = insertLedgerRow(db, supplierId);

    expect(() =>
      db
        .prepare(
          `INSERT INTO supplier_settlements
             (supplier_id, ledger_entry_id, gross_usd, commission_usd, entry_mode, model)
           VALUES (?, ?, 100, 5, 'LUMP', 1)`,
        )
        .run(supplierId, ledgerId),
    ).not.toThrow();

    // ledger_entry_id UNIQUE — a second settlement can't reuse the same
    // ledger row (this is the LIRA-085 "never link by time proximity" link).
    expect(() =>
      db
        .prepare(
          `INSERT INTO supplier_settlements
             (supplier_id, ledger_entry_id, gross_usd, commission_usd, entry_mode, model)
           VALUES (?, ?, 50, 2, 'LUMP', 1)`,
        )
        .run(supplierId, ledgerId),
    ).toThrow(/UNIQUE constraint failed/);

    // entry_mode CHECK.
    const ledgerId2 = insertLedgerRow(db, supplierId);
    expect(() =>
      db
        .prepare(
          `INSERT INTO supplier_settlements
             (supplier_id, ledger_entry_id, entry_mode, model)
           VALUES (?, ?, 'BOGUS', 1)`,
        )
        .run(supplierId, ledgerId2),
    ).toThrow(/CHECK constraint failed/);

    // model CHECK (must be 0 or 1).
    const ledgerId3 = insertLedgerRow(db, supplierId);
    expect(() =>
      db
        .prepare(
          `INSERT INTO supplier_settlements
             (supplier_id, ledger_entry_id, entry_mode, model)
           VALUES (?, ?, 'LUMP', 2)`,
        )
        .run(supplierId, ledgerId3),
    ).toThrow(/CHECK constraint failed/);
  });

  it("creates settlement_commission_allocations (D6), one row per settled fs row", () => {
    v150.up(db);
    const supplierId = insertSupplier(db, "OMT");
    const ledgerId = insertLedgerRow(db, supplierId);
    const fsId = insertFsRow(db, { provider: "OMT", serviceType: "SEND" });

    expect(() =>
      db
        .prepare(
          `INSERT INTO settlement_commission_allocations
             (settlement_ledger_id, financial_service_id, service_type, provider, commission_usd)
           VALUES (?, ?, 'SEND', 'OMT', 3.5)`,
        )
        .run(ledgerId, fsId),
    ).not.toThrow();

    const rows = db
      .prepare(`SELECT * FROM settlement_commission_allocations`)
      .all() as Array<{ commission_usd: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].commission_usd).toBe(3.5);
  });

  it("down() drops the new tables and columns, preserving existing financial_services/suppliers rows", () => {
    const fsId = insertFsRow(db, {
      provider: "OMT",
      serviceType: "SEND",
      commission: 5,
    });
    const supplierId = insertSupplier(db, "OMT");

    v150.up(db);
    v150.down!(db);

    expect(() =>
      db.prepare(`SELECT commission_model FROM financial_services`).get(),
    ).toThrow(/no such column/);
    expect(() =>
      db.prepare(`SELECT commission_entry_mode FROM suppliers`).get(),
    ).toThrow(/no such column/);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name IN ('supplier_settlements', 'settlement_commission_allocations')`,
      )
      .all();
    expect(tables).toHaveLength(0);

    // Original rows survive the rebuild-free ALTER/DROP round-trip.
    const fsRow = db
      .prepare(
        `SELECT provider, commission FROM financial_services WHERE id = ?`,
      )
      .get(fsId) as { provider: string; commission: number };
    expect(fsRow).toMatchObject({ provider: "OMT", commission: 5 });

    const supplierRow = db
      .prepare(`SELECT name FROM suppliers WHERE id = ?`)
      .get(supplierId) as { name: string };
    expect(supplierRow.name).toBe("OMT");
  });

  it("up() is a no-op (skips cleanly) when 'suppliers'/'financial_services' don't exist — the migration-runner synthetic-harness scenario", () => {
    const bareDb = new Database(":memory:");
    bareDb.pragma("foreign_keys = OFF");
    // No tables at all — mirrors telecomDaysCostMigrationsViaRunner.test.ts's
    // minimal fixture, which never creates financial_services/suppliers.
    expect(() => v150.up(bareDb)).not.toThrow();
    const tables = bareDb
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all();
    expect(tables).toHaveLength(0);
    bareDb.close();
  });

  it("down() is defensive against the same suppliers-less/financial_services-less DB", () => {
    const bareDb = new Database(":memory:");
    bareDb.pragma("foreign_keys = OFF");
    expect(() => v150.down!(bareDb)).not.toThrow();
    bareDb.close();
  });
});
