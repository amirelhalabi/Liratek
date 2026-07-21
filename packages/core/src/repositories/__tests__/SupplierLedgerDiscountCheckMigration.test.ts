/**
 * Migration v131 — widen supplier_ledger.entry_type CHECK to allow 'DISCOUNT'
 * (CQ-10).
 *
 * supplier_ledger is the only one of the three counterparty ledgers that
 * still enforces a live CHECK on its type column (partner_ledger dropped
 * its CHECK in v127; debt_ledger never had one). SQLite can't ALTER a CHECK,
 * so the migration recreates the table — this test proves the rebuild
 * preserves every existing row + column, allows the new 'DISCOUNT' literal,
 * and that down() relabels DISCOUNT rows before restoring the old CHECK
 * (mirrors the v99 down() pattern).
 *
 * Constructed directly against the migration's up()/down() (mirrors the
 * MIGRATIONS.find(...).up(db) pattern used by
 * SupplierPaymentIsAutoBackfillMigration.test.ts / LotoSupplierLedgerSign.test.ts).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../../db/migrations/index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // The rebuild's supplier_ledger_new carries REFERENCES tenants(id)/
  // suppliers(id)/transactions(id)/users(id) — this test DB doesn't create
  // those parent tables (out of scope), so FK enforcement must be off, same
  // as the real migration RUNNER does for the whole batch (db/migrations/
  // index.ts's runMigrations(): "foreign_keys = OFF" around every up(), back
  // ON afterward) — this test calls v131.up()/down() directly, bypassing
  // that driver, so it replicates the same pragma toggle itself.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertRow(
  db: Database.Database,
  entryType: string,
  opts: {
    tenantId?: number;
    supplierId?: number;
    amountUsd?: number;
    isAuto?: number;
    isRefunded?: number;
    transactionId?: number | null;
    note?: string | null;
  } = {},
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO supplier_ledger
           (tenant_id, supplier_id, entry_type, amount_usd, is_auto, is_refunded, transaction_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.tenantId ?? 1,
        opts.supplierId ?? 1,
        entryType,
        opts.amountUsd ?? 10,
        opts.isAuto ?? 0,
        opts.isRefunded ?? 0,
        opts.transactionId ?? null,
        opts.note ?? null,
      ).lastInsertRowid,
  );
}

describe("migration v131 — add_discount_entry_type_supplier_ledger", () => {
  const v131 = MIGRATIONS.find((m) => m.version === 131)!;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("exists and has a down()", () => {
    expect(v131).toBeDefined();
    // Not pinned to "the highest version" — that assertion broke on every
    // subsequent migration (v132+). The chain being monotonic is enough.
    expect(
      Math.max(...MIGRATIONS.map((m) => m.version)),
    ).toBeGreaterThanOrEqual(131);
    expect(typeof v131.down).toBe("function");
  });

  it("rejects 'DISCOUNT' BEFORE the migration runs (proves the pre-fix CHECK is live)", () => {
    expect(() => insertRow(db, "DISCOUNT")).toThrow(/CHECK constraint failed/);
  });

  it("allows 'DISCOUNT' after up()", () => {
    v131.up(db);
    expect(() => insertRow(db, "DISCOUNT")).not.toThrow();
    const row = db
      .prepare(
        `SELECT entry_type FROM supplier_ledger WHERE entry_type = 'DISCOUNT'`,
      )
      .get() as { entry_type: string } | undefined;
    expect(row?.entry_type).toBe("DISCOUNT");
  });

  it("still rejects a genuinely invalid entry_type after up() (CHECK still enforced, just widened)", () => {
    v131.up(db);
    expect(() => insertRow(db, "NOT_A_REAL_TYPE")).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("preserves every existing row + column through the rebuild", () => {
    const id1 = insertRow(db, "TOP_UP", {
      supplierId: 5,
      amountUsd: 42,
      isAuto: 1,
      note: "prepaid units",
    });
    const id2 = insertRow(db, "PAYMENT", {
      supplierId: 5,
      amountUsd: -20,
      isRefunded: 1,
      transactionId: 99,
    });

    v131.up(db);

    const rows = db
      .prepare(`SELECT * FROM supplier_ledger ORDER BY id`)
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: id1,
      supplier_id: 5,
      entry_type: "TOP_UP",
      amount_usd: 42,
      is_auto: 1,
      note: "prepaid units",
    });
    expect(rows[1]).toMatchObject({
      id: id2,
      supplier_id: 5,
      entry_type: "PAYMENT",
      amount_usd: -20,
      is_refunded: 1,
      transaction_id: 99,
    });
  });

  it("preserves the supplier_id + created_at index after the rebuild", () => {
    v131.up(db);
    const indexes = db
      .prepare(`PRAGMA index_list(supplier_ledger)`)
      .all() as Array<{ name: string }>;
    expect(
      indexes.some(
        (i) => i.name === "idx_supplier_ledger_supplier_id_created_at",
      ),
    ).toBe(true);
  });

  it("down() relabels DISCOUNT rows to ADJUSTMENT and restores the old CHECK", () => {
    v131.up(db);
    const discountId = insertRow(db, "DISCOUNT", { amountUsd: -15 });

    v131.down!(db);

    const row = db
      .prepare(`SELECT entry_type FROM supplier_ledger WHERE id = ?`)
      .get(discountId) as { entry_type: string };
    expect(row.entry_type).toBe("ADJUSTMENT");

    // The old (narrower) CHECK is back in force.
    expect(() => insertRow(db, "DISCOUNT")).toThrow(/CHECK constraint failed/);
    expect(() => insertRow(db, "PAYMENT")).not.toThrow();
  });
});
