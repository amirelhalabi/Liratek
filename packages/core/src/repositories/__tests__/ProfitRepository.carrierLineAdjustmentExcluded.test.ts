/**
 * LIRA-252 wave 2 — proves (by EXECUTING the query, rule 28) that a
 * `CARRIER_LINE_ADJUSTMENT` transaction (`CarrierLineRepository
 * .postCarrierDrawerAdjustment`'s new unified-transaction row for a manual
 * SIM-line hand-edit) never reaches Profits revenue/profit reporting.
 *
 * `CARRIER_LINE_ADJUSTMENT` is deliberately ABSENT from `ProfitRepository`'s
 * `PROFIT_TXN_TYPES` allowlist
 * ('SALE','FINANCIAL_SERVICE','RECHARGE','CUSTOM_SERVICE','MAINTENANCE',
 * 'LOTO','REFUND','TELECOM_CREDIT_BUYBACK','SUPPLIER_SETTLEMENT',
 * 'RECHARGE_TOPUP') — a closed allowlist, so a brand-new type is excluded by
 * omission with no code change needed. Confirmed below by actually seeding
 * one and reading `getByUser`/`getByClient` back, the same technique
 * `ProfitRepository.debtAccountEntriesExcluded.test.ts` uses for
 * `DEBT_CASH_OUT`/`CREDIT_CASH_IN`/`ACCOUNT_ADJUSTMENT` (rule 14 — same
 * proof shape, new type).
 *
 * Model the transaction row on what `postCarrierDrawerAdjustment` actually
 * writes: amount_usd = the signed credits delta, profit_usd/profit_lbp
 * always 0 — a manual stock correction is neither revenue nor profit, same
 * as `TELECOM_SELF_CHARGE`.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes";

const D = "2026-10-02 10:00:00";
const FROM = "2026-10-02 00:00:00";
const TO = "2026-10-02 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0, client_id INTEGER, client_name TEXT, client_phone TEXT,
      reverses_id INTEGER, created_at TEXT, metadata_json TEXT
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

/** Mirrors `CarrierLineRepository.postCarrierDrawerAdjustment`'s
 *  `CARRIER_LINE_ADJUSTMENT` transaction-writing shape. */
function seedCarrierLineAdjustmentTxn(
  db: Database.Database,
  amountUsd: number,
): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, created_at, metadata_json)
     VALUES (1, ?, 'carrier_lines', 1, 1, ?, 0, 0, 0, ?, ?)`,
  ).run(
    TRANSACTION_TYPES.CARRIER_LINE_ADJUSTMENT,
    amountUsd,
    D,
    JSON.stringify({
      carrier: "mtc",
      phone_number: "03111111",
      drawer_name: "MTC",
      reason: "created",
      is_auto: false,
    }),
  );
}

describe("ProfitRepository — CARRIER_LINE_ADJUSTMENT never reaches Profits (LIRA-252 wave 2)", () => {
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

  it("getByUser: a $10,000 manual carrier-line hand-edit is not counted at all — no phantom row either", () => {
    // Large, deliberately eye-catching amount, mirroring the exact
    // production bug this plan fixes (MTC drawer read $10,000 against a
    // $500 line) — proves a big manual adjustment cannot leak into revenue.
    seedCarrierLineAdjustmentTxn(db, 10000);

    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));

    expect(rows).toHaveLength(0);
  });

  it("getByClient: the same adjustment does not appear on any client row", () => {
    seedCarrierLineAdjustmentTxn(db, 10000);
    const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
    expect(rows).toHaveLength(0);
  });

  it("getDeferredProfit: a carrier-line adjustment contributes nothing to the Deferred Profit card", () => {
    seedCarrierLineAdjustmentTxn(db, 10000);
    seedCarrierLineAdjustmentTxn(db, -500);

    const deferred = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));

    expect(deferred.partner_profit_usd).toBe(0);
    expect(deferred.client_debt_profit_usd).toBe(0);
  });

  it("control: a REAL sale-linked SALE transaction DOES count (proves the query isn't just broken/empty)", () => {
    seedCarrierLineAdjustmentTxn(db, 10000); // noise, must stay excluded
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
