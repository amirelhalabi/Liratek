/**
 * Migration v175 — backfill metadata_json.is_auto on historical EXPENSE
 * transactions ("auto-generated expenses hide by default in the Transactions
 * table").
 *
 * Same shape as migration v130's SUPPLIER_PAYMENT backfill (CQ-8/D2, see
 * SupplierPaymentIsAutoBackfillMigration.test.ts): new EXPENSE rows get
 * `is_auto` stamped at write time (ExpenseRepository.createExpense, derived
 * from `source_ref_table`); this migration backfills the flag onto
 * HISTORICAL rows written before that derivation existed, keyed off the
 * already-reliable `expenses.source_ref_table` column (added in v166).
 *
 * Every assertion is constructed against the migration's `up()`/`down()`
 * directly, mirroring SupplierPaymentIsAutoBackfillMigration.test.ts.
 *
 * Rule 17 note: this guard is proven to fail against the pre-fix migration
 * set — before v175 existed, `MIGRATIONS.find((m) => m.version === 175)`
 * itself was `undefined` and every test below threw immediately. That is the
 * "failing-first" proof for a migration that ADDS behavior wholesale (there
 * is no older `up()` to run instead, unlike a code-level fix).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../../db/migrations/index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      description TEXT,
      category TEXT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      source_ref_table TEXT,
      source_ref_id INTEGER,
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

function insertExpenseRow(
  db: Database.Database,
  sourceRefTable: string | null,
  tenantId = 1,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO expenses (tenant_id, description, category, amount_usd, source_ref_table, source_ref_id)
         VALUES (?, 'fee', 'SMS_Transfer_Fee', 0.5, ?, ?)`,
      )
      .run(tenantId, sourceRefTable, sourceRefTable ? 1 : null).lastInsertRowid,
  );
}

function insertExpenseTxn(
  db: Database.Database,
  expenseId: number,
  metadataJson: string | null,
  tenantId = 1,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, source_table, source_id, metadata_json) VALUES (?, 'EXPENSE', 'expenses', ?, ?)`,
      )
      .run(tenantId, expenseId, metadataJson).lastInsertRowid,
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

describe("migration v175 — backfill_expense_is_auto_metadata", () => {
  const v175 = MIGRATIONS.find((m) => m.version === 175)!;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("exists, is the newest migration, and has a down()", () => {
    expect(v175).toBeDefined();
    expect(typeof v175.down).toBe("function");
    const maxVersion = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(v175.version).toBe(maxVersion);
  });

  it("stamps is_auto=true on an EXPENSE row linked to an expense with source_ref_table set", () => {
    const expenseId = insertExpenseRow(db, "recharges");
    const txnId = insertExpenseTxn(
      db,
      expenseId,
      JSON.stringify({ category: "SMS_Transfer_Fee" }),
    );

    v175.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBe(true);
    // Additive: the existing key must survive the backfill untouched.
    expect(meta.category).toBe("SMS_Transfer_Fee");
  });

  it("does NOT touch an EXPENSE row linked to a manual expense (source_ref_table NULL)", () => {
    const expenseId = insertExpenseRow(db, null);
    const txnId = insertExpenseTxn(
      db,
      expenseId,
      JSON.stringify({ category: "Shop_Supply" }),
    );

    v175.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
  });

  it("does NOT touch a non-EXPENSE transaction even if source_id matches an auto expense row", () => {
    const expenseId = insertExpenseRow(db, "recharges");
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, metadata_json) VALUES (1, 'RECHARGE', 'expenses', ?, '{}')`,
        )
        .run(expenseId).lastInsertRowid,
    );

    v175.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
  });

  it("guards NULL metadata_json (normalized to '{}') instead of crashing", () => {
    const expenseId = insertExpenseRow(db, "financial_services");
    const txnId = insertExpenseTxn(db, expenseId, null);

    expect(() => v175.up(db)).not.toThrow();

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBe(true);
  });

  it("guards invalid/malformed metadata_json instead of crashing", () => {
    const expenseId = insertExpenseRow(db, "financial_services");
    const txnId = insertExpenseTxn(db, expenseId, "{not-json");

    expect(() => v175.up(db)).not.toThrow();

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBe(true);
  });

  it("respects tenant isolation: an auto expense row in a DIFFERENT tenant does not backfill this tenant's transaction", () => {
    // Expense row belongs to tenant 2; the transaction (tenant 1) merely
    // happens to reuse the same numeric source_id — must not cross-match.
    const otherTenantExpenseId = insertExpenseRow(db, "recharges", 2);
    const txnId = insertExpenseTxn(
      db,
      otherTenantExpenseId,
      "{}",
      1, // transaction is tenant 1
    );

    v175.up(db);

    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
  });

  it("is idempotent — running up() twice produces the same result", () => {
    const expenseId = insertExpenseRow(db, "supplier_ledger");
    const txnId = insertExpenseTxn(
      db,
      expenseId,
      JSON.stringify({ category: "Misc" }),
    );

    v175.up(db);
    const once = JSON.stringify(getMetadata(db, txnId));
    v175.up(db);
    const twice = JSON.stringify(getMetadata(db, txnId));

    expect(twice).toBe(once);
    expect(JSON.parse(once).is_auto).toBe(true);
  });

  it("down() strips is_auto from the EXPENSE rows it stamped, leaving other keys untouched", () => {
    const expenseId = insertExpenseRow(db, "recharges");
    const txnId = insertExpenseTxn(
      db,
      expenseId,
      JSON.stringify({ category: "SMS_Transfer_Fee" }),
    );

    v175.up(db);
    expect(getMetadata(db, txnId).is_auto).toBe(true);

    v175.down!(db);
    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
    expect(meta.category).toBe("SMS_Transfer_Fee");
  });

  it("down() leaves a manual expense's metadata (no is_auto) alone", () => {
    const expenseId = insertExpenseRow(db, null);
    const txnId = insertExpenseTxn(
      db,
      expenseId,
      JSON.stringify({ category: "Shop_Supply" }),
    );

    v175.up(db);
    expect(() => v175.down!(db)).not.toThrow();
    const meta = getMetadata(db, txnId);
    expect(meta.is_auto).toBeUndefined();
    expect(meta.category).toBe("Shop_Supply");
  });
});
