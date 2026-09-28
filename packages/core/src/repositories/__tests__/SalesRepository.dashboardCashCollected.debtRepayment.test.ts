/**
 * LIRA-244 — Dashboard "Cash Collected (Today)" double-counts a debt
 * repayment made the SAME DAY as the credit sale it settles.
 *
 * Owner report: measured twice on the web ($8.00 shown against a $4.00
 * drawer, and $21.37 against $17.37); in both runs the gap is exactly the
 * repayment amount.
 *
 * Root cause, traced by reading `SalesRepository.getDashboardStats()`
 * (~:2478) alongside `DebtRepository._markSalesPaidFIFO` (~:883):
 *
 *  - `processSale` stores `sales.paid_usd` = the cash actually tendered AT
 *    SALE TIME (drawer-affecting legs only — the unpaid remainder books a
 *    separate 'Sale Debt' `debt_ledger` row, never touches `paid_usd`).
 *  - `getDashboardStats`'s `cashFromSalesResult` SUMs `sales.paid_usd` for
 *    every sale whose `created_at` is TODAY — intending "cash tendered at
 *    sale time today".
 *  - But `DebtRepository.addRepayment` → `_markSalesPaidFIFO` LATER does
 *    `UPDATE sales SET paid_usd = paid_usd + ?` on the ORIGINAL sale row
 *    when the client repays — it does not insert a new sale, it mutates the
 *    existing one, with no record of WHEN the increment happened.
 *  - `getDashboardStats`'s `repaymentResult` separately SUMs the
 *    repayment's own `debt_ledger` 'Repayment' row for today.
 *  - When the credit sale was ALSO created today, both queries pick up the
 *    SAME cash: once via the mutated `sales.paid_usd` (bucketed under the
 *    SALE's creation day) and again via the `debt_ledger` 'Repayment' row
 *    (bucketed under the REPAYMENT's creation day) — same calendar day,
 *    same money, counted twice. A credit sale from a PRIOR day is
 *    unaffected (its `created_at` isn't "today", so the mutated `paid_usd`
 *    is invisible to `cashFromSalesResult`) — which is why this only shows
 *    up for a same-day sale-then-repay sequence, exactly what a quick manual
 *    QA pass (sell on credit, immediately repay) reproduces.
 *
 * RULE 17 — RED, actually run (`npx jest
 * SalesRepository.dashboardCashCollected.debtRepayment --maxWorkers=2`,
 * 2026-09-28) against the pre-fix `getDashboardStats`:
 *
 *   FAIL packages/core/src/repositories/__tests__/SalesRepository.dashboardCashCollected.debtRepayment.test.ts
 *     ✕ Cash Collected (Today) does not double-count a same-day debt
 *       repayment
 *       Expected: 10 / Received: 14
 *   The $4 repayment was counted once via the mutated sales.paid_usd (now
 *   10, since $6 tendered at sale time + the $4 FIFO payoff) AND once more
 *   via the debt_ledger 'Repayment' row (SalesRepository.ts ~:2548).
 *
 * GREEN after `cashFromSalesResult` sources "cash tendered at sale time"
 * from the sale's OWN `payments` rows (immutable — `_markSalesPaidFIFO`
 * never inserts a payment row against the sale's transaction, only against
 * the repayment's) instead of the mutable `sales.paid_usd` column.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { DebtRepository } from "../DebtRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { resetDebtService } from "../../services/DebtService.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      cost_price_usd  REAL NOT NULL DEFAULT 0,
      stock_quantity  INTEGER NOT NULL DEFAULT 0,
      min_stock_level INTEGER NOT NULL DEFAULT 0,
      is_active       INTEGER NOT NULL DEFAULT 1,
      warranty_months INTEGER,
      tenant_id       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

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
      tenant_id     INTEGER NOT NULL DEFAULT 1,
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL DEFAULT 0,
      amount_lbp       REAL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty — only needed so DebtRepository.addRepayment's OMT/WHISH
    -- service-debt routing JOIN resolves (no rows means no routing).
    CREATE TABLE financial_services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    );

    -- SUPPLIER_STOCK_INTAKE_PLAN.md v164 — processSale/refundSaleItem touch
    -- these unconditionally, even for a product with no batch history.
    CREATE TABLE product_stock_batches (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      product_id         INTEGER NOT NULL,
      supplier_id        INTEGER,
      quantity           INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd      DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt         INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id    INTEGER,
      transaction_id     INTEGER,
      is_opening         INTEGER NOT NULL DEFAULT 0,
      created_by         INTEGER,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      batch_id           INTEGER NOT NULL,
      sale_item_id       INTEGER,
      custom_service_id  INTEGER,
      product_id         INTEGER NOT NULL,
      quantity           INTEGER NOT NULL,
      unit_cost_usd      DECIMAL(10,2) NOT NULL,
      reason             TEXT NOT NULL DEFAULT 'SALE',
      is_restored        INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO clients (id, full_name, tenant_id) VALUES (1, 'Same-Day Client', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity, min_stock_level)
     VALUES (1, 'Phone case', 3, 10, 0)`,
  ).run();
  return db;
}

describe("LIRA-244 — Dashboard Cash Collected (Today) vs. a same-day debt repayment", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let debtRepo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtService();
    salesRepo = new SalesRepository();
    debtRepo = new DebtRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetDebtService();
    resetTenantContext();
  });

  it("Cash Collected (Today) does not double-count a same-day debt repayment", () => {
    // $10 sale, client tenders $6 cash, the $4 remainder books as Sale Debt.
    const sale = salesRepo.processSale(
      {
        client_id: 1,
        items: [{ product_id: 1, quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 6,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(sale.success).toBe(true);

    const beforeRepay = salesRepo.getDashboardStats();
    expect(beforeRepay.totalSalesUSD).toBe(10);
    expect(beforeRepay.cashCollectedUSD).toBe(6);

    // Client pays off the remaining $4 debt in cash, same day.
    const repayment = debtRepo.addRepayment({
      client_id: 1,
      amount_usd: 4,
      amount_lbp: 0,
      created_by: 1,
      paid_by_method: "CASH",
    });
    expect(repayment.id).toBeGreaterThan(0);

    // Ground truth: the General/USD drawer only ever received $6 (sale) +
    // $4 (repayment) = $10 — never $14.
    const drawerUsd = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number };
    expect(drawerUsd.balance).toBe(500 + 10);

    const afterRepay = salesRepo.getDashboardStats();
    // The sale's own value is unaffected by the repayment.
    expect(afterRepay.totalSalesUSD).toBe(10);
    // Cash Collected (Today) must equal the real cash taken today: $6
    // tendered at sale time + $4 repaid later = $10 — NOT $14 (the sale's
    // mutated paid_usd counted again on top of the repayment).
    expect(afterRepay.cashCollectedUSD).toBe(10);
  });
});
