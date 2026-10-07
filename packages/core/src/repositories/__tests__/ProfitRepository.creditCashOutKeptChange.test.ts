/**
 * Profits — kept change on a Debts credit cash-out (owner decision
 * 2026-10-07): the shop hands out slightly less than the client's credit and
 * keeps the shortfall as profit, stamped on the CREDIT_CASH_OUT row
 * (DebtRepository.cashOutCredit). The ONE kept-change source predicate
 * (keptChangeSource) and its count twins now include CREDIT_CASH_OUT, so the
 * "Kept Change" profits line, the drill-down and the by-cashier view show it —
 * exactly once (CREDIT_CASH_OUT is in no other module's totals).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";
import { ProfitService } from "../../services/ProfitService";

const D = "2026-10-07 10:00:00";
const FROM = "2026-10-07 00:00:00";
const TO = "2026-10-07 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0, client_id INTEGER, client_name TEXT, client_phone TEXT,
      reverses_id INTEGER, created_at TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, username TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, full_name TEXT, phone_number TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      provider TEXT, omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', commission REAL DEFAULT 0,
      omt_fee REAL, cost REAL DEFAULT 0, price REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL, transaction_type TEXT,
      reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')), covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, transaction_id INTEGER, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL, session_id INTEGER /* LIRA-258 / G17 */
    );
    -- LIRA-258 / G17: read by notDebtPending's session-basket arm.
    CREATE TABLE IF NOT EXISTS customer_session_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      paid_exchange_rate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, created_at TEXT);
  `);
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'cashier1')`,
  ).run();
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (1, 1, 'Test Client', '71000000')`,
  ).run();
}

function seedCashOut(db: Database.Database, profitUsd: number, profitLbp = 0) {
  const ledgerId = Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by, tenant_id, created_at)
         VALUES (1, 'CREDIT_USED', 101.12, 0, 1, 1, ?)`,
      )
      .run(D).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
     VALUES (1, 'CREDIT_CASH_OUT', 'debt_ledger', ?, 1, 101.12, 0, ?, ?, 1, ?)`,
  ).run(ledgerId, profitUsd, profitLbp, D);
}

describe("Profits — kept change on a credit cash-out", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("GUARD: the Kept Change total includes the cash-out's kept $0.12, counted once", () => {
    seedCashOut(db, 0.12);
    const totals = runWithTenant(1, () =>
      repo.getDebtRepaymentProfit(FROM, TO),
    );
    expect(totals.profit_usd).toBeCloseTo(0.12, 6);
    expect(totals.profit_lbp).toBe(0);
    expect(totals.count).toBe(1);
  });

  it("GUARD: the Kept Change drill-down lists the cash-out row", () => {
    seedCashOut(db, 0, 50_000);
    const rows = runWithTenant(1, () => repo.getKeptChangeDetail(FROM, TO));
    expect(rows).toHaveLength(1);
    expect(rows[0].txn_type).toBe("CREDIT_CASH_OUT");
    expect(rows[0].profit_lbp).toBe(50_000);
  });

  it("GUARD: by cashier — the kept $0.12 appears exactly once", () => {
    seedCashOut(db, 0.12);
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    const total = rows.reduce((s, r) => s + r.profit_usd, 0);
    expect(total).toBeCloseTo(0.12, 6);
  });

  // LIRA-268 follow-up (Kept Change drill-down label): a cash-out row read
  // as the generic "Kept change", indistinguishable from a sale's. Written
  // before the label change and run against the old label first (rule 17).
  it("the Kept Change drill-down labels a cash-out row \"Debts cash-out\"", () => {
    seedCashOut(db, 0.12);
    const detail = runWithTenant(1, () =>
      new ProfitService(repo).getModuleDetail(
        "KEPT_CHANGE",
        "2026-10-07",
        "2026-10-07",
      ),
    );
    expect(detail.counted).toHaveLength(1);
    expect(detail.counted[0].detail).toBe("Debts cash-out kept change");
  });

  it("an older cash-out (no kept, stamp 0) adds nothing and is not counted", () => {
    seedCashOut(db, 0);
    const totals = runWithTenant(1, () =>
      repo.getDebtRepaymentProfit(FROM, TO),
    );
    expect(totals).toEqual({ profit_usd: 0, profit_lbp: 0, count: 0 });
    // …and does not clutter the Kept Change drill-down as a $0 row.
    expect(runWithTenant(1, () => repo.getKeptChangeDetail(FROM, TO))).toEqual(
      [],
    );
  });
});
