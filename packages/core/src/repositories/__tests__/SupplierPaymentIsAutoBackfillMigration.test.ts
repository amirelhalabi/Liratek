/**
 * Migration v130 — backfill metadata_json.is_auto on historical
 * SUPPLIER_PAYMENT transactions (CQ-8, D2).
 *
 * Owner decision D2 (2026-07-18): manual supplier payments show on the
 * Transactions page by default; auto-generated sibling rows
 * (`metadata.is_auto`) stay behind the filter. New rows get `is_auto` stamped
 * at write time (SupplierRepository.addLedgerEntry); this migration backfills
 * the flag onto HISTORICAL rows written before that stamp existed, keyed off
 * the already-reliable `supplier_ledger.is_auto` column (added in v110).
 *
 * Every assertion is constructed against the migration's `up()` directly
 * (mirrors the MIGRATIONS.find(...).up(db) pattern used by
 * LotoSupplierLedgerSign.test.ts / SupplierPaymentVoid.test.ts).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../../db/migrations/index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertLedgerRow(
  db: Database.Database,
  isAuto: 0 | 1,
  tenantId = 1,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, is_auto) VALUES (?, 1, 'TOP_UP', 10, ?)`,
      )
      .run(tenantId, isAuto).lastInsertRowid,
  );
}

function insertSupplierPaymentTxn(
  db: Database.Database,
  ledgerId: number,
  metadataJson: string | null,
  tenantId = 1,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, source_table, source_id, metadata_json) VALUES (?, 'SUPPLIER_PAYMENT', 'supplier_ledger', ?, ?)`,
      )
      .run(tenantId, ledgerId, metadataJson).lastInsertRowid,
  );
}

function getMetadata(
  db: Database.Database,
  txnId: number,
): Record<string, unknown> {
  const row = db
    .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
    .get(txnId) as { metadata_json: string | null };
  return row.metadata_json ? JSON.parse(row.metadata_json) : {};
}

describe("migration v130 — backfill_supplier_payment_is_auto_metadata", () => {
  const v130 = MIGRATIONS.find((m) => m.version === 130)!;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("exists and has a down()", () => {
    // "Is the highest version" is NOT this test's job — CQ-10 (v131) landed
    // after it; that check now belongs to the newest migration's own test
    // (SupplierLedgerDiscountCheckMigration.test.ts).
    expect(v130).toBeDefined();
    expect(typeof v130.down).toBe("function");
  });

  it("stamps is_auto=true on a SUPPLIER_PAYMENT row linked to an is_auto=1 ledger row", () => {
    const ledgerId = insertLedgerRow(db, 1);
    const txnId = insertSupplierPaymentTxn(
      db,
      ledgerId,
      JSON.stringify({ supplier_id: 1, entry_type: "TOP_UP" }),
    );

    v130.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBe(true);
    // Additive: the existing key must survive the backfill untouched.
    expect(meta.entry_type).toBe("TOP_UP");
  });

  it("does NOT touch a SUPPLIER_PAYMENT row linked to an is_auto=0 (manual) ledger row", () => {
    const ledgerId = insertLedgerRow(db, 0);
    const txnId = insertSupplierPaymentTxn(
      db,
      ledgerId,
      JSON.stringify({ supplier_id: 1, entry_type: "PAYMENT" }),
    );

    v130.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
  });

  it("does NOT touch a non-SUPPLIER_PAYMENT transaction even if source_id matches an is_auto=1 ledger row", () => {
    const ledgerId = insertLedgerRow(db, 1);
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, metadata_json) VALUES (1, 'SUPPLIER_SETTLEMENT', 'supplier_ledger', ?, '{}')`,
        )
        .run(ledgerId).lastInsertRowid,
    );

    v130.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
  });

  it("guards NULL metadata_json (COALESCE to '{}') instead of crashing", () => {
    const ledgerId = insertLedgerRow(db, 1);
    const txnId = insertSupplierPaymentTxn(db, ledgerId, null);

    expect(() => v130.up(db)).not.toThrow();

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBe(true);
  });

  it("guards invalid/malformed metadata_json instead of crashing", () => {
    const ledgerId = insertLedgerRow(db, 1);
    const txnId = insertSupplierPaymentTxn(db, ledgerId, "{not-json");

    expect(() => v130.up(db)).not.toThrow();

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBe(true);
  });

  it("respects tenant isolation: an is_auto=1 ledger row in a DIFFERENT tenant does not backfill this tenant's transaction", () => {
    // Ledger row belongs to tenant 2; the transaction (tenant 1) merely
    // happens to reuse the same numeric source_id — must not cross-match.
    const otherTenantLedgerId = insertLedgerRow(db, 1, 2);
    const txnId = insertSupplierPaymentTxn(
      db,
      otherTenantLedgerId,
      "{}",
      1, // transaction is tenant 1
    );

    v130.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
  });

  it("is idempotent — running up() twice produces the same result", () => {
    const ledgerId = insertLedgerRow(db, 1);
    const txnId = insertSupplierPaymentTxn(
      db,
      ledgerId,
      JSON.stringify({ supplier_id: 1 }),
    );

    v130.up(db);
    const once = JSON.stringify(getMetadata(db, txnId));
    v130.up(db);
    const twice = JSON.stringify(getMetadata(db, txnId));

    expect(twice).toBe(once);
    expect(JSON.parse(once).is_auto).toBe(true);
  });

  it("down() is a documented no-op (data-only backfill)", () => {
    const ledgerId = insertLedgerRow(db, 1);
    const txnId = insertSupplierPaymentTxn(db, ledgerId, "{}");

    v130.up(db);
    const afterUp = JSON.stringify(getMetadata(db, txnId));
    v130.down!(db);
    const afterDown = JSON.stringify(getMetadata(db, txnId));

    // No-op: down() does not strip the key back out (documented lossy-safe
    // but pointless — see the migration's own down() comment).
    expect(afterDown).toBe(afterUp);
  });
});
