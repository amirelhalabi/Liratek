/**
 * LIRA-162 — pending commission is INVISIBLE on the Profits Overview and
 * Commissions cards.
 *
 * D15's "N transactions awaiting settlement" count landed in
 * `ProfitRepository.getPendingCommissionTotals`, which previously fed ONLY
 * the By-Payment-Method tab (via `ProfitService.getByPaymentMethod`). The
 * Overview/Commissions cards are fed by `ProfitService.getSummary`'s
 * `financial_services` block instead, which had NO way to surface a
 * model-1 (post-cutover) row's pending commission at all — its dollar
 * columns (`pending_commission_usd`/`_lbp`) stay legacy-model-only by
 * design (LIRA-158), so an all-post-cutover period read 0/0 with nothing to
 * explain why.
 *
 * This test proves `getSummary` now ALSO calls `getPendingCommissionTotals`
 * and carries `awaiting_settlement_count` onto the `financial_services`
 * block, without touching `pending_commission_usd`/`_lbp`/`revenue_usd`
 * (still sourced from `getFinancialPendingByCurrency`, unchanged).
 *
 * Schema: a self-contained copy of `ProfitService.transactionBased.test.ts`'s
 * `createSchema` (the fixture already proven to support every table
 * `getSummary` touches) with `financial_services.commission_model` added —
 * the one column needed to seed a genuine model-1 row. Kept as an isolated
 * file (rather than editing the shared fixture) so this ticket's diff stays
 * localised and cannot regress that file's ~30 pre-existing assertions.
 */

import Database from "better-sqlite3";
import { ProfitService, resetProfitService } from "../ProfitService.js";
import { resetProfitRepository } from "../../repositories/ProfitRepository.js";

const FROM = "2000-01-01";
const TO = "2100-12-31";
const TS = "2026-03-01 10:00:00";

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

    -- LIRA-162: the ONE deviation from ProfitService.transactionBased.test.ts's
    -- createSchema — commission_model added so a genuine model-1 row can be
    -- seeded. Every existing test in that sibling file's fixture omits this
    -- column entirely and still passes unaffected (schema-drift degrades to
    -- "treat every row as legacy" — see ProfitRepository.hasCommissionModelColumn's
    -- doc comment); this file needs the column ON to prove the model-1 path.
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
      commission_model INTEGER NOT NULL DEFAULT 0,
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
    , refunded_at TEXT DEFAULT NULL);
  `);

  d.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
}

/** Insert a financial_services row (mirrors LIRA158.estimateNoLongerReported
 *  .test.ts's own `insertFs` helper, adapted to this file's column set). */
function insertFs(row: {
  provider: string;
  currency?: string;
  commission: number;
  commissionModel: number;
  isSettled: number;
  createdAt?: string;
}): number {
  const result = db
    .prepare(
      `INSERT INTO financial_services
         (provider, currency, commission, commission_model, is_settled, is_refunded, cost, price, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(
      row.provider,
      row.currency ?? "USD",
      row.commission,
      row.commissionModel,
      row.isSettled,
      row.createdAt ?? TS,
    );
  return Number(result.lastInsertRowid);
}

/** getFinancialPendingByCurrency (revenue/count/pending dollar figure)
 *  INNER JOINs financial_services to its own FINANCIAL_SERVICE transaction
 *  row — without one, a seeded fs row is invisible to that query (though
 *  NOT to getPendingCommissionTotals, which reads financial_services alone;
 *  the two queries have different join requirements by design). Its
 *  `commission` column reads the TRANSACTION's `profit_usd`/`profit_lbp`
 *  stamp (transaction-based profit, not the raw `fs.commission` estimate) —
 *  `profitUsd` must be set to whatever this test wants
 *  `pending_commission_usd` to read. */
function insertFsTxn(
  fsId: number,
  opts: { profitUsd?: number; createdAt?: string } = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO transactions
         (type, status, source_table, source_id, amount_usd, profit_usd, created_at)
       VALUES ('FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 100, ?, ?)`,
    )
    .run(fsId, opts.profitUsd ?? 0, opts.createdAt ?? TS);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  db = new Database(":memory:") as TestDb;
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetProfitService();
  // This file's tests deliberately mix commission_model = 0 and = 1 rows
  // across separate `it()`s. ProfitRepository memoizes its
  // hasCommissionModelColumn() PRAGMA probe PER INSTANCE
  // (_hasCommissionModelColumnCache) — resetting the repository singleton
  // too (not just the service) keeps each test's probe fresh against ITS
  // OWN `db`, matching this suite's per-test schema/db swap.
  resetProfitRepository();
  service = new ProfitService();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-162 — ProfitService.getSummary carries awaiting_settlement_count", () => {
  it("surfaces a model-1 pending row's count on financial_services.awaiting_settlement_count", () => {
    // Post-cutover OMT SEND, unsettled — commission is a stale
    // creation-time estimate the legacy dollar columns must NOT trust
    // (LIRA-158), but D15's count must still see it.
    const fsId = insertFs({
      provider: "OMT",
      currency: "USD",
      commission: 2, // the estimate — irrelevant to this assertion
      commissionModel: 1,
      isSettled: 0,
    });
    insertFsTxn(fsId);

    const summary = service.getSummary(FROM, TO);

    expect(summary.financial_services.awaiting_settlement_count).toBe(1);
    // getFinancialPendingByCurrency (revenue/count) is UNCHANGED — this is
    // an addition, not a swap. price=0/amount=0 on this row, so revenue is
    // 0 too; count still reflects the one pending row.
    expect(summary.financial_services.count).toBe(1);
    // The legacy dollar figure stays 0 — a model-1 row's commission is
    // never trusted as the settled truth (LIRA-158).
    expect(summary.financial_services.pending_commission_usd).toBe(0);
  });

  it("a legacy (model-0) pending row contributes 0 to awaiting_settlement_count", () => {
    const fsId = insertFs({
      provider: "WHISH",
      currency: "USD",
      commission: 1.5,
      commissionModel: 0,
      isSettled: 0,
    });
    insertFsTxn(fsId, { profitUsd: 1.5 });

    const summary = service.getSummary(FROM, TO);

    expect(summary.financial_services.awaiting_settlement_count).toBe(0);
    expect(summary.financial_services.pending_commission_usd).toBe(1.5);
  });

  it("mixes both: legacy dollar figure and model-1 count coexist without hiding each other", () => {
    const legacyId = insertFs({
      provider: "WHISH",
      currency: "USD",
      commission: 3,
      commissionModel: 0,
      isSettled: 0,
    });
    insertFsTxn(legacyId, { profitUsd: 3 });
    const modelOneId = insertFs({
      provider: "OMT",
      currency: "USD",
      commission: 0.75,
      commissionModel: 1,
      isSettled: 0,
    });
    // A model-1 row's FINANCIAL_SERVICE transaction stamps profit_usd = 0
    // at creation (LIRA-158 Phase 1) — the real commission is recognised
    // separately at settlement, never on this row. Omitting profitUsd here
    // (defaults to 0) matches that production shape and proves this row
    // does NOT inflate pending_commission_usd alongside the legacy row.
    insertFsTxn(modelOneId);

    const summary = service.getSummary(FROM, TO);

    expect(summary.financial_services.pending_commission_usd).toBe(3);
    expect(summary.financial_services.awaiting_settlement_count).toBe(1);
    expect(summary.financial_services.count).toBe(2);
  });
});
