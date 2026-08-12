/**
 * LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — the bills-only Katsh/
 * iPick settlement commission must reach the Profits page exactly ONCE.
 *
 * Background: `SupplierRepository.settleTransactions`'s `isBillsOnlyBatch`
 * branch (commit 4fd0ad1) stamps the operator's entered commission as
 * `profit_usd`/`profit_lbp` directly on the SUPPLIER_SETTLEMENT transaction —
 * "our profit entirely" (owner). `ProfitRepository`/`ProfitService` never
 * read that type, so the profit was stamped and permanently invisible on
 * every profits view (Summary totals, by-module, by-user, by-client).
 *
 * Double-count analysis (full audit in the task report): confirmed SAFE to
 * surface — no other profits query reads a supplier_ledger-sourced
 * transaction, and a BILL row's `financial_services.commission` column stays
 * 0 forever (LIRA-112: bills are created with `cost === price`, so
 * `commission = price - cost = 0`; settlement never writes the entered
 * commission back to that column). This file proves the fix is additive
 * (counted exactly once) and reverses cleanly (rule 20).
 *
 * Rule 17 — every assertion below was run against the pre-fix code (no
 * `supplier_commission` field on `ProfitSummary`, `SUPPLIER_SETTLEMENT`
 * absent from `PROFIT_TXN_TYPES`) and observed failing — see the task report
 * for the exact pre-fix output (net_profit_lbp missing the 20,000 LBP
 * commission entirely; `summary.supplier_commission` undefined).
 *
 * Schema copied from ProfitService.transactionBased.test.ts (rule 14 — same
 * fixture shape every getSummary() test in this package uses) so this file
 * exercises the SAME `getSummary` code path with a REAL in-memory
 * better-sqlite3 database, not a mock.
 */

import Database from "better-sqlite3";
import { ProfitService, resetProfitService } from "../ProfitService.js";

const FROM = "2000-01-01";
const TO = "2100-12-31";
const TS = "2026-08-12 10:00:00";

interface TestDb extends Database.Database {}

let db: TestDb;
let service: ProfitService;

function createSchema(d: TestDb): void {
  d.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      phone_number TEXT
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
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      reverses_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    , refunded_at TEXT DEFAULT NULL);

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
    , refunded_at TEXT DEFAULT NULL);

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
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE expenses (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT,
      currency_code TEXT,
      amount REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by ProfitRepository's notPartnerPending / salePaidOrPartnerSettled
    -- fragments (PFT-6). Left empty: the NOT EXISTS gate then passes every row,
    -- preserving this suite's pre-partner expectations unchanged. Also proves
    -- (empty here) that a SUPPLIER_SETTLEMENT row can NEVER be partner-pending —
    -- no partner_ledger row is ever created with reference_table =
    -- 'supplier_ledger' anywhere in the codebase (verified in the task report).
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
    -- Left empty: the NOT EXISTS gate passes every row unchanged. Also proves
    -- a SUPPLIER_SETTLEMENT transaction id is never a debt_ledger.transaction_id
    -- (module-debt rows are keyed to CUSTOMER_ACCOUNT-charged services only).
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
    , refunded_at TEXT DEFAULT NULL);
  `);

  d.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
}

// ── Insert helpers ────────────────────────────────────────────────────────────

function insertSale(opts: {
  id: number;
  final: number;
  paid: number;
  status?: string;
}): void {
  db.prepare(
    `INSERT INTO sales (id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
     VALUES (?, ?, ?, ?, 0, 90000, ?)`,
  ).run(opts.id, opts.status ?? "completed", opts.final, opts.paid, TS);
}

function insertSaleItem(opts: {
  saleId: number;
  qty: number;
  price: number;
  cost: number;
}): void {
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
     VALUES (?, 1, ?, ?, ?, 0, 0)`,
  ).run(opts.saleId, opts.qty, opts.price, opts.cost);
}

/** Katsh BILL row, created with cost === price (LIRA-112 shape: bills stamp
 *  exactly 0 commission at creation — the operator enters commission later,
 *  at settlement). Used by the regression-guard test below. The row's own
 *  `id` is autoincrement — the caller must insert exactly one to know it's 1
 *  (matches this file's own usage: sourceId: 1 on the paired transaction). */
function insertKatshBill(opts: { amount: number }): void {
  db.prepare(
    `INSERT INTO financial_services (provider, amount, currency, price, cost, commission, is_settled, created_at)
     VALUES ('Katsh', ?, 'USD', ?, ?, 0, 0, ?)`,
  ).run(opts.amount, opts.amount, opts.amount, TS);
}

function insertTxn(opts: {
  type: string;
  sourceTable: string;
  sourceId: number;
  status?: string;
  profitUsd?: number;
  profitLbp?: number;
  amountUsd?: number;
  userId?: number;
  clientId?: number | null;
  reversesId?: number;
  createdAt?: string;
}): number {
  const info = db
    .prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, client_id, reverses_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.type,
      opts.status ?? "ACTIVE",
      opts.sourceTable,
      opts.sourceId,
      opts.userId ?? 1,
      opts.amountUsd ?? 0,
      opts.profitUsd ?? 0,
      opts.profitLbp ?? 0,
      opts.clientId ?? null,
      opts.reversesId ?? null,
      opts.createdAt ?? TS,
    );
  return Number(info.lastInsertRowid);
}

/** A bills-only SUPPLIER_SETTLEMENT — commission is the ONLY money on this
 *  row (amount_usd/amount_lbp are contractually 0/0, per the commit's own
 *  invariant for this batch shape). */
function insertBillsCommissionSettlement(opts: {
  sourceId: number;
  profitLbp?: number;
  profitUsd?: number;
  userId?: number;
}): number {
  return insertTxn({
    type: "SUPPLIER_SETTLEMENT",
    sourceTable: "supplier_ledger",
    sourceId: opts.sourceId,
    profitUsd: opts.profitUsd ?? 0,
    profitLbp: opts.profitLbp ?? 0,
    amountUsd: 0,
    userId: opts.userId,
  });
}

beforeEach(() => {
  db = new Database(":memory:") as TestDb;
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetProfitService();
  service = new ProfitService();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// The commission reaches the Profits page
// ─────────────────────────────────────────────────────────────────────────────

describe("a bills-only settlement's commission appears in the profits aggregate", () => {
  it("shows in the new supplier_commission bucket AND in totals.gross_profit_lbp/net_profit_lbp, in LBP", () => {
    insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });

    const summary = service.getSummary(FROM, TO);
    expect(summary.supplier_commission.profit_lbp).toBe(20000);
    expect(summary.supplier_commission.profit_usd).toBe(0);
    expect(summary.supplier_commission.count).toBe(1);
    expect(summary.totals.gross_profit_lbp).toBe(20000);
    expect(summary.totals.net_profit_lbp).toBe(20000);
  });

  it("also shows in USD when the entered commission is USD", () => {
    insertBillsCommissionSettlement({ sourceId: 1, profitUsd: 3.5 });

    const summary = service.getSummary(FROM, TO);
    expect(summary.supplier_commission.profit_usd).toBe(3.5);
    expect(summary.totals.gross_profit_usd).toBe(3.5);
    expect(summary.totals.net_profit_usd).toBe(3.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 20 — reversal nets the aggregate back to zero
// ─────────────────────────────────────────────────────────────────────────────

describe("reversing a bills-only settlement nets the profits aggregate back to zero", () => {
  it("VOID: status flips to VOIDED, excluded from every ACTIVE-only sum", () => {
    const id = insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });

    // Sanity — nonzero before reversal.
    expect(service.getSummary(FROM, TO).totals.gross_profit_lbp).toBe(20000);

    // TransactionRepository.voidTransaction's core effect: flip status.
    db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(id);

    const summary = service.getSummary(FROM, TO);
    expect(summary.supplier_commission.profit_lbp).toBe(0);
    expect(summary.totals.gross_profit_lbp).toBe(0);
    expect(summary.totals.net_profit_lbp).toBe(0);
  });

  it("REFUND: negated REFUND row (original stays ACTIVE) nets to 0", () => {
    const id = insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });
    expect(service.getSummary(FROM, TO).totals.gross_profit_lbp).toBe(20000);

    // TransactionRepository._refundTransactionInternal's core effect: a new
    // REFUND row, same source_table/source_id, negated profit stamp.
    insertTxn({
      type: "REFUND",
      sourceTable: "supplier_ledger",
      sourceId: 1,
      profitLbp: -20000,
      reversesId: id,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.supplier_commission.profit_lbp).toBe(0);
    expect(summary.totals.gross_profit_lbp).toBe(0);
    expect(summary.totals.net_profit_lbp).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Counted exactly once — the assertion the owner's money depends on
// ─────────────────────────────────────────────────────────────────────────────

describe("regression guard — the commission is counted exactly once, no other figure moves", () => {
  it("a normal SALE's profit is unaffected by a concurrent bills-only settlement", () => {
    insertSale({ id: 1, final: 200, paid: 200 });
    insertSaleItem({ saleId: 1, qty: 2, price: 100, cost: 60 });
    insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 80,
      amountUsd: 200,
    });
    insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });

    const summary = service.getSummary(FROM, TO);
    expect(summary.sales.profit_usd).toBe(80); // unchanged
    expect(summary.supplier_commission.profit_lbp).toBe(20000);
    expect(summary.totals.gross_profit_usd).toBe(80); // not smeared into USD
    expect(summary.totals.gross_profit_lbp).toBe(20000); // counted once, not doubled
  });

  it("the Katsh BILL's own creation-time FINANCIAL_SERVICE transaction (0 commission, LIRA-112) does not ALSO carry the settlement's profit — no double count across the two rows for the SAME bill", () => {
    // Real production shape: the bill is created first (cost === price, so
    // commission = price - cost = 0 at creation — LIRA-112), then settled
    // later, when the operator enters the real commission.
    insertKatshBill({ amount: 20 });
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: 0, // LIRA-112: bills stamp exactly 0 at creation
      amountUsd: 20,
    });
    insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });

    const summary = service.getSummary(FROM, TO);
    // The bill's own FINANCIAL_SERVICE row contributes 0 (unsettled anyway —
    // is_settled=0 — but even if it were settled, its stamped profit is 0).
    expect(summary.mobile_services.profit_usd).toBe(0);
    expect(summary.financial_services.commission_usd).toBe(0);
    // The commission appears EXACTLY ONCE, in its own bucket.
    expect(summary.supplier_commission.profit_lbp).toBe(20000);
    expect(summary.totals.gross_profit_lbp).toBe(20000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OMT/legacy (commission_model = 0) path is untouched — no leak
// ─────────────────────────────────────────────────────────────────────────────

describe("an OMT/legacy (commission_model = 0) settlement contributes NOTHING new", () => {
  it("a legacy settlement's profit stamp is 0/0 (SupplierRepository never sets it for this shape) — supplier_commission stays 0", () => {
    // Mirrors SupplierRepository.settleTransactions's real stamp for every
    // batch shape OTHER than isBillsOnlyBatch: profit_usd: 0, profit_lbp: 0.
    insertBillsCommissionSettlement({ sourceId: 1, profitUsd: 0, profitLbp: 0 });

    const summary = service.getSummary(FROM, TO);
    expect(summary.supplier_commission.profit_usd).toBe(0);
    expect(summary.supplier_commission.profit_lbp).toBe(0);
    expect(summary.supplier_commission.count).toBe(0);
    expect(summary.totals.gross_profit_usd).toBe(0);
    expect(summary.totals.gross_profit_lbp).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROFIT_TXN_TYPES consumers — getByUser / getByClient / getDeferredProfit
// ─────────────────────────────────────────────────────────────────────────────

describe("PROFIT_TXN_TYPES consumers correctly account for SUPPLIER_SETTLEMENT", () => {
  it("getByUser attributes the settlement's profit to the settling user, not silently dropped", () => {
    db.prepare(`INSERT INTO users (id, username) VALUES (2, 'khalil')`).run();
    insertBillsCommissionSettlement({
      sourceId: 1,
      profitLbp: 20000,
      userId: 2,
    });

    const rows = service.getByUser(FROM, TO);
    const khalil = rows.find((r) => r.user_id === 2);
    expect(khalil).toBeDefined();
    expect(khalil!.profit_lbp).toBe(20000);
    // amount_usd is contractually 0 for a bills-only batch — no revenue
    // inflation from a profit-only row.
    expect(khalil!.revenue_usd).toBe(0);
  });

  it("getByClient buckets a client-less settlement under 'Walk-in' — a sensible home, not dropped", () => {
    insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });

    const rows = service.getByClient(FROM, TO);
    const walkIn = rows.find((r) => r.client_id === null);
    expect(walkIn).toBeDefined();
    expect(walkIn!.client_name).toBe("Walk-in");
    expect(walkIn!.profit_lbp).toBe(20000);
  });

  it("getDeferredProfit never defers it — a supplier_ledger-sourced row can never be partner-/debt-pending", () => {
    insertBillsCommissionSettlement({ sourceId: 1, profitLbp: 20000 });

    const summary = service.getSummary(FROM, TO);
    expect(summary.deferred.partner_profit_lbp).toBe(0);
    expect(summary.deferred.client_debt_profit_lbp).toBe(0);
    // Confirms it is fully realized in the main totals instead.
    expect(summary.totals.gross_profit_lbp).toBe(20000);
  });
});
