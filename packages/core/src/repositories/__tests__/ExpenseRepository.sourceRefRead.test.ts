/**
 * LIRA-335 FR-013 — the Expenses history must see an expense's parent link.
 *
 * The Expenses page hides Void/Edit on a "Drawer shortage" expense (owned by
 * a closed checkpoint difference; only Reopen removes it). It decides by
 * `source_ref_table === 'checkpoint_differences'`, but getColumns() never
 * selected that column, so the lock never fired on real data. Hand-rolled
 * schemas that predate v166 (no source_ref columns) must still read.
 *
 * Failing-first (rule 17): run against the pre-fix getColumns(), the read
 * returns `source_ref_table: undefined`.
 */
import Database from "better-sqlite3";
import { ExpenseRepository } from "../ExpenseRepository.js";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext.js";

function createDb(withSourceRef: boolean): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, description TEXT,
      category TEXT, expense_type TEXT, amount_usd DECIMAL(10, 2), amount_lbp DECIMAL(15, 2),
      paid_by_method TEXT DEFAULT 'CASH', status TEXT NOT NULL DEFAULT 'active',
      expense_date DATETIME DEFAULT CURRENT_TIMESTAMP, note TEXT DEFAULT NULL,
      edited_by TEXT DEFAULT NULL, edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL,
      ${withSourceRef ? "source_ref_table TEXT DEFAULT NULL, source_ref_id INTEGER DEFAULT NULL," : ""}
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("ExpenseRepository — source_ref_table reaches the read model (LIRA-335)", () => {
  let db: Database.Database;

  function install(withSourceRef: boolean): ExpenseRepository {
    db = createDb(withSourceRef);
    (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    return new ExpenseRepository();
  }

  afterEach(() => {
    delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  it("history and by-id reads carry source_ref_table", () => {
    const repo = install(true);
    const id = Number(
      db
        .prepare(
          `INSERT INTO expenses (tenant_id, description, category, amount_usd, amount_lbp, expense_date, source_ref_table, source_ref_id)
           VALUES (1, 'Drawer shortage (General, checkpoint #7)', 'Drawer shortage', 3, 0, datetime('now'), 'checkpoint_differences', 12)`,
        )
        .run().lastInsertRowid,
    );
    expect(repo.getExpenseHistory()[0].source_ref_table).toBe("checkpoint_differences");
    expect(repo.getExpenseById(id)?.source_ref_table).toBe("checkpoint_differences");
  });

  it("a schema without the v166 columns still reads", () => {
    const repo = install(false);
    db.prepare(
      `INSERT INTO expenses (tenant_id, description, category, amount_usd, amount_lbp, expense_date)
       VALUES (1, 'Rent', 'Bill', 400, 0, datetime('now'))`,
    ).run();
    expect(repo.getExpenseHistory()).toHaveLength(1);
  });
});
