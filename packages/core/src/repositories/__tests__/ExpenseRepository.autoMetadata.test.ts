/**
 * ExpenseRepository.createExpense derives metadata_json.is_auto from
 * `source_ref_table` (owner-reported: an MTC Credits sale's auto-generated
 * `SMS_Transfer_Fee` EXPENSE row cluttered the Transactions table, but
 * EXPENSE can't be blanket-hidden by type because a manual expense must stay
 * visible — see frontend/src/features/audit/auditConstants.ts isAutoRow).
 *
 * Precedent this mirrors exactly: SUPPLIER_PAYMENT's `metadata.is_auto` flag
 * (CQ-8/D2, migration v130) — hidden by default, revealed by an explicit
 * type-targeted filter. The flag is derived in ONE place (createExpense),
 * not passed by each of the five auto-expense writers (RechargeRepository,
 * FinancialServiceRepository x3, SupplierRepository), so a future sixth
 * writer gets it for free and none of the five can drift out of sync
 * (rule 14).
 *
 * Rule 17 note: this guard has been proven to fail — before the fix, the
 * `metadata_json` object built in createExpense had no `is_auto` key at all
 * regardless of `source_ref_table`, so the "auto expense" assertion below
 * failed with `undefined !== true`. Restoring the old object literal
 * (dropping the `is_auto: data.source_ref_table ? true : undefined` line)
 * reproduces that failure.
 */

import Database from "better-sqlite3";
import {
  ExpenseRepository,
  resetExpenseRepository,
} from "../ExpenseRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const USER_ID = 9;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    -- Includes source_ref_table/source_ref_id (migration v166) — the whole
    -- point of this fixture is exercising ExpenseRepository's
    -- hasSourceRef=true INSERT branch, unlike ExpenseActiveGate.test.ts's
    -- schema which predates those columns.
    CREATE TABLE expenses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      description      TEXT,
      category         TEXT,
      expense_type     TEXT,
      amount_usd       REAL,
      amount_lbp       REAL,
      paid_by_method   TEXT DEFAULT 'CASH',
      status           TEXT NOT NULL DEFAULT 'active',
      expense_date     TEXT DEFAULT CURRENT_TIMESTAMP,
      note             TEXT DEFAULT NULL,
      edited_by        TEXT DEFAULT NULL,
      edited_at        TEXT DEFAULT NULL,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      source_ref_table TEXT,
      source_ref_id    INTEGER,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("ExpenseRepository.createExpense — metadata_json.is_auto derivation", () => {
  let db: Database.Database;
  let expenseRepo: ExpenseRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetExpenseRepository();
    resetTransactionRepository();
    expenseRepo = new ExpenseRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetExpenseRepository();
    resetTransactionRepository();
    resetTenantContext();
  });

  function metadataFor(expenseId: number): Record<string, unknown> {
    const txn = txnRepo.getBySourceId("expenses", expenseId);
    if (!txn) throw new Error("test setup: expense has no linked transaction");
    return JSON.parse(txn.metadata_json ?? "{}") as Record<string, unknown>;
  }

  it("stamps metadata_json.is_auto = true when source_ref_table is set (auto-generated sibling expense)", () => {
    const expenseId = expenseRepo.createExpense(
      {
        description: "SMS transfer fee",
        category: "SMS_Transfer_Fee",
        paid_by_method: "CASH",
        amount_usd: 0.5,
        amount_lbp: 0,
        expense_date: new Date().toISOString(),
        source_ref_table: "recharges",
        source_ref_id: 42,
      },
      USER_ID,
    );

    expect(metadataFor(expenseId).is_auto).toBe(true);
  });

  it("leaves metadata_json.is_auto absent for a manual expense (no source_ref_table)", () => {
    const expenseId = expenseRepo.createExpense(
      {
        description: "Office supplies",
        category: "Shop_Supply",
        paid_by_method: "CASH",
        amount_usd: 10,
        amount_lbp: 0,
        expense_date: new Date().toISOString(),
      },
      USER_ID,
    );

    const meta = metadataFor(expenseId);
    expect(meta.is_auto).toBeUndefined();
    expect("is_auto" in meta).toBe(false);
  });

  it("a caller's own extra_metadata.is_auto can never override the derived value", () => {
    const autoId = expenseRepo.createExpense(
      {
        description: "Auto fee",
        category: "SMS_Transfer_Fee",
        paid_by_method: "CASH",
        amount_usd: 0.5,
        amount_lbp: 0,
        expense_date: new Date().toISOString(),
        source_ref_table: "recharges",
        source_ref_id: 7,
        extra_metadata: { is_auto: false },
      },
      USER_ID,
    );
    expect(metadataFor(autoId).is_auto).toBe(true);

    const manualId = expenseRepo.createExpense(
      {
        description: "Manual expense claiming to be auto",
        category: "Misc",
        paid_by_method: "CASH",
        amount_usd: 5,
        amount_lbp: 0,
        expense_date: new Date().toISOString(),
        extra_metadata: { is_auto: true },
      },
      USER_ID,
    );
    expect(metadataFor(manualId).is_auto).toBeUndefined();
  });
});
