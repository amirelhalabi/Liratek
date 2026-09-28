/**
 * LIRA-244 follow-up — Dashboard "Cash Collected (Today)" vs. a customer
 * SESSION checkout ("Refund basket"'s sibling feature: the "Add to Cart" /
 * session-basket flow, `TransactionsViewer.tsx`'s session grouping).
 *
 * `SalesRepository.getDashboardStats()`'s `cashFromSalesResult` (LIRA-244,
 * `SalesRepository.dashboardCashCollected.debtRepayment.test.ts`) now sums
 * the sale's OWN `payments` rows — `payments p JOIN transactions t ON
 * t.id = p.transaction_id … WHERE t.source_table = 'sales'` — instead of the
 * mutable `sales.paid_usd` column, to stop a same-day debt repayment from
 * being counted twice.
 *
 * SUSPECTED GAP (traced by reading `SalesRepository.processSale`'s
 * `deferPayment` branch, ~:1054-1185, and
 * `SessionPaymentRepository.insertSessionLeg`, ~:137): a session-basket sale
 * (`deferPayment: true`) writes NO `payments` rows on its own SALE
 * transaction at all — `partitionLegs(deferPayment ? [] : paymentLines)`
 * empties both leg arrays, so the IN-leg loop that normally inserts a
 * `payments` row never runs. The session's pooled cash leg is posted
 * separately by `SessionPaymentService.recordBasketPayment` →
 * `SessionPaymentRepository.insertSessionLeg`, whose OWN doc comment says:
 * "`transaction_id` is left NULL — a payment row belongs to EITHER a
 * transaction OR a session basket, never both." `cashFromSalesResult`'s
 * `JOIN transactions t ON t.id = p.transaction_id` is an INNER join, so a
 * NULL `p.transaction_id` row can never match it, regardless of
 * `source_table` — the session's cash leg is structurally invisible to this
 * query no matter which transaction it's conceptually "for".
 *
 * RULE 17 — RED, actually run (`npx jest
 * SalesRepository.dashboardCashCollected.sessionCheckout --maxWorkers=2`,
 * 2026-09-28) against the current (LIRA-244-fixed, this-gap-NOT-fixed)
 * `getDashboardStats`:
 *
 *   FAIL … › Cash Collected (Today) counts a session-basket sale paid CASH
 *   at checkout
 *     Expected cashCollectedUSD: 25 / Received: 0
 *   The drawer genuinely moved by $25 (proven independently below), and the
 *   sale's paid_usd was correctly back-filled to 25 by
 *   `SessionPaymentService.recordBasketPayment` — but the dashboard shows
 *   $0 collected today, because the $25 leg's `payments` row has
 *   `transaction_id IS NULL` (session-owned) and can never satisfy
 *   `cashFromSalesResult`'s join.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import {
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository.js";
import {
  resetSessionPaymentRepository,
} from "../SessionPaymentRepository.js";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService.js";
import { resetClientRepository } from "../ClientRepository.js";
import { resetDebtService } from "../../services/DebtService.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

// ─── Mock VoucherRepository — recordBasketPayment resolves it even when no
// GIFT_CARD leg is used in this file; the sibling SessionPaymentService
// basket-test files mock it the same way. ─────────────────────────────────
const mockRedeemByCode = jest.fn();
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: mockRedeemByCode }),
  resetVoucherRepository: jest.fn(),
}));

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
      notes           TEXT,
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

    -- Empty — only needed so recordBasketPayment's PCD-split lookup and
    -- DebtRepository's OMT/WHISH routing JOINs resolve (no rows = no PCD
    -- split, no service-debt routing) — same fail-soft convention the
    -- sibling SessionPaymentService.basket.test.ts fixture documents.
    CREATE TABLE financial_services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    );

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

    CREATE TABLE customer_sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name  TEXT,
      customer_phone TEXT,
      customer_notes TEXT,
      user_id        INTEGER,
      started_at     TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at      TEXT,
      started_by     TEXT NOT NULL,
      closed_by      TEXT,
      is_active      INTEGER NOT NULL DEFAULT 1,
      tenant_id      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER NOT NULL,
      transaction_type       TEXT NOT NULL,
      transaction_id         INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd             REAL NOT NULL DEFAULT 0,
      amount_lbp             REAL NOT NULL DEFAULT 0,
      profit_usd             REAL NOT NULL DEFAULT 0,
      profit_lbp             REAL NOT NULL DEFAULT 0,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity, min_stock_level)
     VALUES (1, 'Phone case', 3, 10, 0)`,
  ).run();
  return db;
}

describe("LIRA-244 follow-up — Dashboard Cash Collected (Today) vs. a session-basket checkout", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let sessionRepo: CustomerSessionRepository;
  let paymentService: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetCustomerSessionRepository();
    resetSessionPaymentRepository();
    resetSessionPaymentService();
    resetClientRepository();
    resetDebtService();
    mockRedeemByCode.mockClear();
    salesRepo = new SalesRepository();
    sessionRepo = new CustomerSessionRepository();
    paymentService = new SessionPaymentService();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetCustomerSessionRepository();
    resetSessionPaymentRepository();
    resetSessionPaymentService();
    resetClientRepository();
    resetDebtService();
    resetTenantContext();
  });

  it("Cash Collected (Today) counts a session-basket sale paid CASH at checkout", () => {
    // Open a customer session (no client needed — CASH is not on-account).
    const sessionId = Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (customer_name, started_by) VALUES ('Walk-in', 'cashier')`,
        )
        .run().lastInsertRowid,
    );

    // Real writer: a $25 POS sale created in session-deferred mode — same
    // path POS/index.tsx's "Add to Cart" flow drives (processSale with
    // deferPayment: true, no payment legs — the basket recorder owns cash).
    const sale = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 25 }],
        total_amount: 25,
        discount: 0,
        final_amount: 25,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90_000,
        deferPayment: true,
      },
      1,
    );
    expect(sale.success).toBe(true);
    const saleId = sale.id as number;
    const saleTxnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ?`,
        )
        .get(saleId) as { id: number }
    ).id;

    // Real writer: link the sale into the session basket (what
    // POS/index.tsx's activeSession branch does via linkTransaction).
    sessionRepo.linkTransaction(sessionId, "sale", saleId, 25, 0, 0, 0, saleTxnId);

    // No sale yet checked out — dashboard shows nothing collected.
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBe(0);

    // Real writer: the session checkout records ONE pooled CASH leg for the
    // whole basket (SessionPaymentService.recordBasketPayment) — exactly
    // what "Charge" on the session checkout sheet does.
    paymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 25, direction: "IN" }],
      exchangeRate: 90_000,
      userId: 1,
    });

    // Ground truth #1: the sale really did realize as fully paid.
    const saleRow = db
      .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
      .get(saleId) as { paid_usd: number };
    expect(saleRow.paid_usd).toBe(25);

    // Ground truth #2: the General/USD drawer really did receive $25 today —
    // the ONE figure "Cash Collected (Today)" is supposed to reconcile
    // against.
    const drawerUsd = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number };
    expect(drawerUsd.balance).toBe(500 + 25);

    // The dashboard must show the SAME $25 the drawer actually took in
    // today — not $0.
    const stats = salesRepo.getDashboardStats();
    expect(stats.totalSalesUSD).toBe(25);
    expect(stats.cashCollectedUSD).toBe(25);
  });
});
