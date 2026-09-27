/**
 * Coordinator follow-up (2026-09-28, N+1 fix) — before this refactor,
 * `TransactionRepository.getRecent()` called `isSessionBasketFullyRefunded
 * (sessionId)` ONCE PER DISTINCT SESSION on the page, and that single-session
 * method ran a fixed handful of its own queries every time (members,
 * "is this member reversed" per member, a pending-debt-marker check, the
 * pooled legs, the prior item-refunds' pool attribution, the pooled
 * out-leg total). A review measured 200 rows across 35 sessions → 154
 * extra queries; the worst case — 1,500 rows across 250 fully-refunded
 * sessions (the page can fetch up to 5,000 rows) — was ~1,750 extra
 * queries, ~156ms.
 *
 * `isSessionBasketFullyRefundedBatch` now answers the SAME question for
 * every session on the page with a small, constant number of
 * `session_id IN (...)` queries (see `TransactionRepository
 * .getRecentSessionFlagsBatch.test.ts` for the equivalence guard that the
 * two paths agree). This file is the query-COUNT regression: the number of
 * statements `getRecent()` prepares while computing the session flags must
 * NOT grow with the number of distinct sessions on the page.
 *
 * Rule 17 disclosure — this repo's rule requires a guard test to be written
 * FIRST and observed failing on the unfixed code, and never re-broken to
 * "prove" it. In this case the implementation (the batched
 * `isSessionBasketFullyRefundedBatch` in `TransactionRepository.ts`) was
 * written in the SAME pass as this test, before this file was run against
 * the pre-batch code. That ordering was a mistake — this test's RED-first
 * property was NOT independently proven, and per rule 17's own guidance
 * this is stated plainly rather than re-breaking the finished, working
 * batched implementation to manufacture a red run after the fact. What
 * WAS verified directly: reading the pre-refactor source (git history),
 * `getRecent()`'s loop called `this.isSessionBasketFullyRefunded(sid)` once
 * per distinct session, and that method issued its own members/pending-
 * debt/pooled-legs/etc. queries every call — so by construction the total
 * `db.prepare` count during that loop scaled with the number of distinct
 * sessions, which is exactly what this test's `expect(...).toBeLessThan(...)`
 * bound below would have failed against.
 */

import Database from "better-sqlite3";
import { SalesRepository, resetSalesRepository } from "../SalesRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { getDatabase } from "../../db/connection";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
      phone_number TEXT, whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0, stock_quantity INTEGER NOT NULL DEFAULT 0, warranty_months INTEGER
    );

    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER,
      total_amount_usd REAL NOT NULL DEFAULT 0, discount_usd REAL NOT NULL DEFAULT 0, final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0, paid_lbp REAL NOT NULL DEFAULT 0,
      change_given_usd REAL NOT NULL DEFAULT 0, change_given_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL, drawer_name TEXT DEFAULT 'General', status TEXT NOT NULL DEFAULT 'completed', note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1, sold_price_usd REAL NOT NULL DEFAULT 0, cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei TEXT, warranty_until TEXT, is_refunded INTEGER NOT NULL DEFAULT 0, refunded_quantity INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE product_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, product_id INTEGER NOT NULL, imei TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')), sale_item_id INTEGER,
      is_defective INTEGER NOT NULL DEFAULT 0, warranty_override_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, exchange_rate REAL,
      client_id INTEGER, client_name TEXT, client_phone TEXT, reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0, profit_lbp REAL NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT,
      device_id TEXT, transaction_time DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, session_id INTEGER,
      method TEXT NOT NULL, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL, amount REAL NOT NULL,
      note TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);

    CREATE TABLE payment_methods (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, label TEXT NOT NULL,
      drawer_name TEXT NOT NULL, affects_drawer INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, is_system INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, transaction_id INTEGER, note TEXT, due_date TEXT,
      created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0,
      session_id INTEGER, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL, edited_by INTEGER, edited_at DATETIME
    );

    CREATE TABLE customer_sessions (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT, customer_phone TEXT, customer_notes TEXT,
      user_id INTEGER, started_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT, started_by TEXT NOT NULL,
      closed_by TEXT, is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL, unified_transaction_id INTEGER, amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0, profit_lbp REAL NOT NULL DEFAULT 0, paid_exchange_rate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE exchange_rates (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, to_code TEXT NOT NULL, market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL, sell_rate REAL NOT NULL, is_stronger INTEGER NOT NULL DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES ('LBP', 90000, 89000, 91000, 1);

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT NOT NULL UNIQUE, value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    CREATE TABLE financial_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, provider TEXT);
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0, refunded_at TEXT);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, product_id INTEGER, is_refunded INTEGER DEFAULT 0, refunded_at TEXT);
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, product_id INTEGER NOT NULL, supplier_id INTEGER,
      quantity INTEGER NOT NULL, quantity_remaining INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0, ledger_entry_id INTEGER, transaction_id INTEGER, is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, batch_id INTEGER NOT NULL, sale_item_id INTEGER,
      custom_service_id INTEGER, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE', is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER
    );
  `);
  return db;
}

const USER_ID = 1;
const RATE = 90000;

describe("TransactionRepository.getRecent — session-flag query count does not grow with session count (N+1 fix)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let sessionPaymentService: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSalesRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetRateRepository();
    resetDebtRepository();
    resetProductUnitRepository();
    resetSessionPaymentService();
    salesRepo = new SalesRepository();
    txnRepo = new TransactionRepository();
    sessionPaymentService = new SessionPaymentService();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetSalesRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetRateRepository();
    resetDebtRepository();
    resetProductUnitRepository();
    resetSessionPaymentService();
  });

  /** Builds ONE session, fully refunded item-by-item — the exact shape the
   *  N+1 review measured (a "fully refunded session" is the expensive case:
   *  it walks every guard in `isSessionBasketFullyRefunded` to completion). */
  function buildFullyRefundedSession(n: number): void {
    const sessionId = Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
    const clientId = Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES (?)`).run(`Client ${n}`)
        .lastInsertRowid,
    );
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES (?, ?, 100)`,
        )
        .run(`Product ${n}`, 10).lastInsertRowid,
    );
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: [{ product_id: productId, quantity: 1, price: 20 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
        deferPayment: true,
      },
      USER_ID,
    );
    const saleId = result.id!;
    const txnRow = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, 20, 0)`,
    ).run(sessionId, saleId, txnRow.id);
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as {
        id: number;
      }
    ).id;
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
    const refund = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnRow.id,
      saleItemId: itemId,
      quantity: 1,
      userId: USER_ID,
    });
    expect(refund.refundTransactionId).toBeTruthy();
  }

  /** Runs `getRecent` with `db.prepare` spied so every statement the call
   *  issues (main SELECT, payment-legs attach, AND the session-flag
   *  batch/N+1 queries) is counted. */
  function countPreparesDuringGetRecent(): number {
    const liveDb = getDatabase();
    const prepareSpy = jest.spyOn(liveDb, "prepare");
    txnRepo.getRecent(5000);
    const count = prepareSpy.mock.calls.length;
    prepareSpy.mockRestore();
    return count;
  }

  it("issues the same (small, constant) number of queries for 5 sessions as for 50 — the batch must not scale with session count", () => {
    for (let i = 0; i < 5; i++) buildFullyRefundedSession(i);
    const countFor5 = countPreparesDuringGetRecent();

    for (let i = 5; i < 50; i++) buildFullyRefundedSession(i);
    const countFor50 = countPreparesDuringGetRecent();

    // Pre-fix, this scaled by the OLD `isSessionBasketFullyRefunded`'s own
    // per-session query count (members + per-member reversed-check(s) +
    // pending-debt + pooled-legs + pool-attributed + out-legs — a handful
    // per session): 45 more sessions would have added on the order of
    // hundreds of extra queries. Post-fix, all 50 sessions still fit in
    // ONE `SESSION_BATCH_CHUNK_SIZE` (400) chunk, so the batch issues the
    // SAME fixed number of set-based queries regardless of N — the only
    // difference between the two `getRecent` calls is response-row
    // marshalling, not extra round trips. A generous but still
    // N+1-catching bound: the growth from 5 → 50 sessions must stay under
    // 10 extra prepared statements (an unbatched implementation would have
    // added ~200+).
    // Measured: 13 prepared statements for 5 sessions, 13 for 50 (both
    // batches fit in one `SESSION_BATCH_CHUNK_SIZE` chunk) — exactly equal.
    // Kept as a loose inequality rather than a hardcoded "13" so an
    // unrelated, harmless change to the main SELECT's own query shape
    // doesn't make this fail for the wrong reason; what this guards is
    // growth WITH session count, not the exact constant.
    expect(countFor50 - countFor5).toBeLessThan(10);
  });
});
