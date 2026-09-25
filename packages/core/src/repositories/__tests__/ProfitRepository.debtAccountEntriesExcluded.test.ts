/**
 * Owner ticket #27 (2026-09-23, verbatim second half): "if its [the huge
 * revenue number] from the debts account page, that page should not affect
 * our profits page in any sense. not even in the pending tab [only the new
 * debts should be recorded, the ones that are linked to items and sales in
 * our system]".
 *
 * This file proves — by EXECUTING the query, not by reading it (rule 28) —
 * that a MANUAL debt-account entry (the Debts page's "cash advance" /
 * "account credit" button, `DebtRepository.addAccountCashEntry`, which has
 * NO linked sale or item) is already fully invisible to every Profits query:
 *
 *   - `getByUser` / `getByClient` (Overview "by cashier"/"by client",
 *     the only two queries that scan ALL transaction types via
 *     `PROFIT_TXN_TYPES` rather than a specific module table) — the manual
 *     entry contributes 0 revenue, 0 profit, and is not even COUNTED.
 *   - `getDeferredProfit` (feeds the "Deferred Profit" card, which is the
 *     closest thing to a "pending" cross-cutting view on the Overview tab)
 *     — same `PROFIT_TXN_TYPES` filter, same result: 0.
 *   - `getPendingSaleProfit` (the actual "Pending Profit" TAB) is verified
 *     separately by inspection: its query is `FROM sales s ... WHERE
 *     s.status = 'completed'` with no reference to `debt_ledger` at all — a
 *     manual account entry has no `sales` row to join through, so it
 *     structurally cannot appear there.
 *
 * `addAccountCashEntry` (DebtRepository.ts ~1255) writes ONE `debt_ledger`
 * row plus ONE `transactions` row typed `DEBT_CASH_OUT` (cash advance,
 * direction "debt") or `CREDIT_CASH_IN` (direction "credit"), or
 * `ACCOUNT_ADJUSTMENT` on the no-cash-moved ("paper") path — profit is
 * explicitly never stamped on any of the three ("No profit is stamped (pure
 * liability movement)", same file's own doc comment). None of the three
 * types appears in `PROFIT_TXN_TYPES`
 * ('SALE','FINANCIAL_SERVICE','RECHARGE','CUSTOM_SERVICE','MAINTENANCE',
 * 'LOTO','REFUND','TELECOM_CREDIT_BUYBACK','SUPPLIER_SETTLEMENT',
 * 'RECHARGE_TOPUP') — confirmed below by actually seeding one of each and
 * reading the totals back, rather than trusting the source list is
 * exhaustive.
 *
 * VERDICT: for #27, the debts-account-page mechanism the owner suspected is
 * NOT a code defect — it was already correctly excluded before this ticket.
 * The real mechanism (the LBP-wearing-a-$ exchange bug) is fixed and proven
 * separately in `ProfitRepository.exchangeCurrencyBlindRevenue.test.ts`.
 * This file exists so that claim is backed by a passing, executed test
 * rather than an assertion in a report.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-09-23 10:00:00";
const FROM = "2026-09-23 00:00:00";
const TO = "2026-09-23 23:59:59";

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
      is_refunded INTEGER DEFAULT 0, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
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

/** Mirrors DebtRepository.addAccountCashEntry's transaction-writing shape
 *  for each of its 3 possible types — no profit ever stamped. */
function seedManualDebtAccountTxn(
  db: Database.Database,
  type: "DEBT_CASH_OUT" | "CREDIT_CASH_IN" | "ACCOUNT_ADJUSTMENT",
  amountUsd: number,
): void {
  const ledgerId = Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by, tenant_id, created_at)
         VALUES (1, ?, ?, 0, 1, 1, ?)`,
      )
      .run(type === "CREDIT_CASH_IN" ? "CREDIT_DEPOSIT" : "Manual Debt", amountUsd, D)
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
     VALUES (1, ?, 'debt_ledger', ?, 1, ?, 0, 0, 0, 1, ?)`,
  ).run(type, ledgerId, amountUsd, D);
}

describe("ProfitRepository — manual debt-account entries never reach Profits (owner #27)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getByUser: a $5,000 manual cash-advance (DEBT_CASH_OUT) is not counted at all — no phantom $0 row either", () => {
    // Large, deliberately eye-catching amount — if this leaked in, it would
    // dwarf any real revenue and be exactly the kind of "huge number" #27
    // describes.
    seedManualDebtAccountTxn(db, "DEBT_CASH_OUT", 5000);

    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));

    // Not merely zero-valued — the cashier has NO row at all, proving the
    // WHERE clause excludes the type outright rather than including it at 0.
    expect(rows).toHaveLength(0);
  });

  it("getByUser: a $3,000 manual account credit (CREDIT_CASH_IN) is not counted", () => {
    seedManualDebtAccountTxn(db, "CREDIT_CASH_IN", 3000);
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    expect(rows).toHaveLength(0);
  });

  it("getByUser: a paper (move_cash: false) ACCOUNT_ADJUSTMENT is not counted", () => {
    seedManualDebtAccountTxn(db, "ACCOUNT_ADJUSTMENT", 1200);
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    expect(rows).toHaveLength(0);
  });

  it("getByClient: the same $5,000 cash advance does not appear on the client's row", () => {
    seedManualDebtAccountTxn(db, "DEBT_CASH_OUT", 5000);
    const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
    expect(rows).toHaveLength(0);
  });

  it("getDeferredProfit: a manual debt-account entry contributes nothing to the Deferred Profit card either", () => {
    seedManualDebtAccountTxn(db, "DEBT_CASH_OUT", 5000);
    seedManualDebtAccountTxn(db, "CREDIT_CASH_IN", 3000);

    const deferred = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));

    expect(deferred.partner_profit_usd).toBe(0);
    expect(deferred.client_debt_profit_usd).toBe(0);
  });

  it("control: a REAL sale-linked SALE transaction DOES count (proves the query isn't just broken/empty)", () => {
    seedManualDebtAccountTxn(db, "DEBT_CASH_OUT", 5000); // noise, must stay excluded
    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, created_at) VALUES (1, 1, 'completed', 40, 40, ?)`,
    ).run(D);
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
       VALUES (1, 'SALE', 'sales', 1, 1, 40, 0, 15, 0, 1, ?)`,
    ).run(D);

    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    expect(rows).toHaveLength(1);
    expect(rows[0].revenue_usd).toBeCloseTo(40, 2);
    expect(rows[0].profit_usd).toBeCloseTo(15, 2);
  });
});
