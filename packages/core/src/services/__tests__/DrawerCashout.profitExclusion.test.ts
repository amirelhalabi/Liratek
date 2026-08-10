/**
 * DrawerCashoutRepository × ProfitService — a Cash Out must NEVER move
 * net_profit.
 *
 * A Cash Out is neither a business expense (EXPENSE, which reduces
 * net_profit via ProfitRepository.getExpenseTotals) nor a revenue-bearing
 * flow — it must be completely invisible to ProfitService.getSummary. This
 * suite snapshots getSummary(from, to) before and after a real cashout
 * (via DrawerCashoutRepository, sharing the SAME in-memory DB as
 * ProfitService/ProfitRepository through the `__LIRATEK_TEST_DB__` test
 * hook) and asserts net_profit_usd/net_profit_lbp and the expense totals are
 * BYTE-IDENTICAL.
 *
 * Rule 17 (CLAUDE.md): this test is proven to fail on a realistic mistake —
 * see the PR description / task notes for the before/after run where the
 * repository's transaction-write step was temporarily reimplemented as an
 * INSERT into `expenses` instead of `drawer_cashouts`.
 */

import Database from "better-sqlite3";
import {
  DrawerCashoutRepository,
  resetDrawerCashoutRepository,
} from "../../repositories/DrawerCashoutRepository";
import { ProfitService, resetProfitService } from "../ProfitService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;
let cashoutRepo: DrawerCashoutRepository;
let profitService: ProfitService;

function createSchema(d: Database.Database): void {
  d.exec(`
    -- ── Cashout write-path tables (createTransaction-compatible: mirrors
    -- DrawerTopUpRepository.test.ts's schema, which already carries every
    -- column TransactionRepository.createTransaction's INSERT binds) ──────────

    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT
    );

    CREATE TABLE drawer_cashouts (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── ProfitRepository reporting tables (ProfitService.transactionBased.test.ts's
    -- fixture, verbatim table shapes) ───────────────────────────────────────────

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'completed',
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL NOT NULL DEFAULT 90000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      sold_price_usd REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_quantity INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      omt_service_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      omt_fee REAL,
      payment_method_fee REAL NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      currency_code TEXT NOT NULL DEFAULT 'USD',
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'completed',
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'Delivered_Paid',
      final_amount_usd REAL NOT NULL DEFAULT 0,
      final_amount_lbp REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_tickets (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT,
      sale_amount REAL NOT NULL DEFAULT 0,
      commission_amount REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_in REAL NOT NULL DEFAULT 0,
      leg1_profit_usd REAL,
      leg2_profit_usd REAL,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE expenses (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expense_date TEXT
    );

    -- Referenced by ProfitRepository's notPartnerPending / salePaidOrPartnerSettled
    -- fragments (PFT-6). Left empty: the NOT EXISTS gate then passes every row.
    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL,
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
    );

    -- Referenced by ProfitRepository's notDebtPending fragment (DBT-1, v129).
    -- Left empty: the NOT EXISTS gate passes every row unchanged.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );
  `);

  d.prepare(`INSERT INTO users (id, username) VALUES (1, 'admin')`).run();
}

function seedGeneralBalance(currency: "USD" | "LBP", amount: number): void {
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', ?, ?)`,
  ).run(currency, amount);
}

interface ProfitSnapshot {
  net_profit_usd: number;
  net_profit_lbp: number;
  expenses_total_usd: number;
  expenses_total_lbp: number;
}

function snapshot(): ProfitSnapshot {
  const summary = profitService.getSummary(FROM, TO);
  return {
    net_profit_usd: summary.totals.net_profit_usd,
    net_profit_lbp: summary.totals.net_profit_lbp,
    expenses_total_usd: summary.expenses.total_usd,
    expenses_total_lbp: summary.expenses.total_lbp,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetDrawerCashoutRepository();
  resetProfitService();
  cashoutRepo = new DrawerCashoutRepository();
  profitService = new ProfitService();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTenantContext();
  resetDrawerCashoutRepository();
  resetProfitService();
  db.close();
});

describe("Drawer Cash Out — profit exclusion (a cashout must not move net_profit)", () => {
  it("leaves net_profit and expense totals BYTE-IDENTICAL before and after a cashout", () => {
    seedGeneralBalance("USD", 500);
    seedGeneralBalance("LBP", 20_000_000);

    const before = snapshot();

    cashoutRepo.createCashout(
      { amount_usd: 75, amount_lbp: 3_000_000, notes: "Owner personal use" },
      1,
    );

    const after = snapshot();

    expect(after.net_profit_usd).toBe(before.net_profit_usd);
    expect(after.net_profit_lbp).toBe(before.net_profit_lbp);
    expect(after.expenses_total_usd).toBe(before.expenses_total_usd);
    expect(after.expenses_total_lbp).toBe(before.expenses_total_lbp);

    // Sanity: the snapshot isn't trivially all-zero for an unrelated reason
    // (e.g. getSummary silently failing) — the drawer itself DID move.
    const balUsd = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number };
    expect(balUsd.balance).toBeCloseTo(425, 5);
  });

  it("does not appear in ProfitRepository.getExpenseTotals even though it is a cash outflow", () => {
    seedGeneralBalance("USD", 200);

    cashoutRepo.createCashout(
      { amount_usd: 50, amount_lbp: 0, notes: "test" },
      1,
    );

    const summary = profitService.getSummary(FROM, TO);
    expect(summary.expenses.total_usd).toBe(0);
    expect(summary.expenses.count).toBe(0);
  });
});
