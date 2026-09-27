/**
 * Coordinator follow-up (2026-09-28, N+1 fix) — `getRecent()` used to
 * compute `session_fully_refunded` (`isSessionBasketFullyRefunded`) with
 * ONE extra round trip of queries PER DISTINCT session on the page (a
 * review measured 200 rows across 35 sessions → 154 extra queries; worst
 * case 1,500 rows across 250 fully-refunded sessions → ~1,750 extra
 * queries, ~156ms). `isSessionBasketFullyRefundedBatch` now computes the
 * SAME predicate for every session on the page with a small, constant
 * number of `session_id IN (...)` queries, and the single-session
 * `isSessionBasketFullyRefunded(sessionId)` is defined in terms of it
 * (rule 14 — `.get([sessionId])`), so the two can never disagree.
 *
 * This file is the EQUIVALENCE guard for that refactor: many sessions of
 * different shapes (not refunded, fully refunded item-by-item, fully
 * refunded via whole-basket void, a netted payout member, kept change,
 * change given back, account-charged) are built with the real writers
 * (`SalesRepository.processSale`, `SessionPaymentService
 * .recordBasketPayment`, `TransactionRepository.refundSessionBasketItem` /
 * `refundSessionBasket`), then `getRecent()`'s batched
 * `session_fully_refunded`/`is_session_payout` for every row is asserted
 * equal to what calling `isSessionBasketFullyRefundedBatch([sessionId])`
 * for THAT session ALONE returns — i.e. the multi-session batch call must
 * never cross-contaminate between sessions. See
 * `TransactionRepository.isSessionBasketFullyRefundedBatch.queryCount.test.ts`
 * for the query-count regression this refactor actually guards (rule 17 —
 * that one was run RED against the pre-batch code; see that file's own
 * header for why this one was not).
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
import { DebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";

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
    INSERT INTO drawer_balances VALUES (1, 'Binance', 'USD', 0, CURRENT_TIMESTAMP);

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

describe("TransactionRepository.getRecent — session flags batch equivalence (N+1 fix)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let sessionPaymentService: SessionPaymentService;
  let debtRepo: DebtRepository;

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
    debtRepo = new DebtRepository();
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

  function seedSession(): number {
    return Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
  }

  function seedClient(name: string): number {
    return Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES (?)`).run(name).lastInsertRowid,
    );
  }

  function sellIntoSession(
    sessionId: number,
    clientId: number | null,
    items: Array<{ name: string; price: number; cost: number; qty?: number }>,
  ): { saleId: number; txnId: number; itemIds: number[] } {
    const productIds = items.map((it) =>
      Number(
        db
          .prepare(
            `INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES (?, ?, 100)`,
          )
          .run(it.name, it.cost).lastInsertRowid,
      ),
    );
    const totalAmount = items.reduce((s, it) => s + it.price * (it.qty ?? 1), 0);
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: items.map((it, i) => ({
          product_id: productIds[i],
          quantity: it.qty ?? 1,
          price: it.price,
        })),
        total_amount: totalAmount,
        discount: 0,
        final_amount: totalAmount,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
        deferPayment: true,
      },
      USER_ID,
    );
    expect(result.success).toBe(true);
    const saleId = result.id!;
    const txnRow = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, ?, 0)`,
    ).run(sessionId, saleId, txnRow.id, totalAmount);
    const itemIds = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`)
        .all(saleId) as { id: number }[]
    ).map((r) => r.id);
    return { saleId, txnId: txnRow.id, itemIds };
  }

  function payCash(sessionId: number, amountUsd: number, clientId?: number | null): void {
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: amountUsd }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
  }

  function payAccount(sessionId: number, amountUsd: number, clientId: number): void {
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: amountUsd }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
  }

  function payCashWithChange(
    sessionId: number,
    cashUsd: number,
    changeUsd: number,
    clientId?: number | null,
  ): void {
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: cashUsd },
        { method: "CASH", currencyCode: "USD", amount: changeUsd, direction: "OUT" },
      ],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
  }

  /** Netted FINANCIAL_SERVICE RECEIVE (Binance) payout — the unified
   *  `transactions` row carries the POSITIVE transfer amount, but the
   *  customer-side `cst` amount is NEGATIVE (the real payout sign). */
  function payoutIntoSession(sessionId: number, amountUsd: number): number {
    const fsId = Number(
      db.prepare(`INSERT INTO financial_services (provider) VALUES ('BINANCE')`).run()
        .lastInsertRowid,
    );
    const fsTxnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, client_id, summary)
           VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, ?, ?, 0, NULL, 'Binance RECEIVE (session)')`,
        )
        .run(fsId, USER_ID, amountUsd).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'financial_service', ?, ?, ?, 0)`,
    ).run(sessionId, fsId, fsTxnId, -amountUsd);
    return fsTxnId;
  }

  /** Asserts that `getRecent`'s batched flags for every row of `sessionIds`
   *  equal what a SEPARATE, single-session-only batch call (`.get([sid])`)
   *  returns for that same session — i.e. the multi-session batch never
   *  leaks state between sessions. */
  function assertBatchMatchesIsolatedSingle(sessionIds: number[]): void {
    const rows = txnRepo.getRecent(5000) as Array<{
      id: number;
      session_id?: number | null;
      session_fully_refunded?: boolean;
      is_session_payout?: boolean;
    }>;
    for (const sid of sessionIds) {
      const isolated = txnRepo
        .isSessionBasketFullyRefundedBatch([sid])
        .get(sid);
      const sessionRows = rows.filter((r) => r.session_id === sid);
      expect(sessionRows.length).toBeGreaterThan(0);
      for (const row of sessionRows) {
        expect(row.session_fully_refunded).toBe(isolated);
      }
    }
  }

  it("a not-yet-refunded session reads false in both getRecent's batch and the isolated single-session batch", () => {
    const sessionId = seedSession();
    const client = seedClient("A");
    sellIntoSession(sessionId, client, [{ name: "Item A", price: 50, cost: 30 }]);
    payCash(sessionId, 50, client);

    assertBatchMatchesIsolatedSingle([sessionId]);
    expect(txnRepo.isSessionBasketFullyRefunded(sessionId)).toBe(false);
  });

  it("a session fully refunded item-by-item reads true in both paths, alongside sessions that are NOT", () => {
    const s1 = seedSession(); // fully refunded via item refund
    const c1 = seedClient("B1");
    const { txnId: t1, itemIds: i1 } = sellIntoSession(s1, c1, [
      { name: "B1 item", price: 40, cost: 20 },
    ]);
    payCash(s1, 40, c1);
    const r1 = txnRepo.refundSessionBasketItem({
      sessionId: s1,
      transactionId: t1,
      saleItemId: i1[0],
      quantity: 1,
      userId: USER_ID,
    });
    expect(r1.refundTransactionId).toBeTruthy();

    const s2 = seedSession(); // only partly refunded
    const c2 = seedClient("B2");
    const { txnId: t2, itemIds: i2 } = sellIntoSession(s2, c2, [
      { name: "B2 item A", price: 30, cost: 15 },
      { name: "B2 item B", price: 30, cost: 15 },
    ]);
    payCash(s2, 60, c2);
    txnRepo.refundSessionBasketItem({
      sessionId: s2,
      transactionId: t2,
      saleItemId: i2[0],
      quantity: 1,
      userId: USER_ID,
    });

    const s3 = seedSession(); // untouched
    const c3 = seedClient("B3");
    sellIntoSession(s3, c3, [{ name: "B3 item", price: 20, cost: 10 }]);
    payCash(s3, 20, c3);

    assertBatchMatchesIsolatedSingle([s1, s2, s3]);
    expect(txnRepo.isSessionBasketFullyRefunded(s1)).toBe(true);
    expect(txnRepo.isSessionBasketFullyRefunded(s2)).toBe(false);
    expect(txnRepo.isSessionBasketFullyRefunded(s3)).toBe(false);
  });

  it("a session reversed via whole-basket refund, a session with a netted payout member, and a session with kept overpayment all agree between the batch and isolated paths", () => {
    // Whole-basket refund reverses every member (guard #1 true), but its
    // own pooled-leg reversal is stamped `SESSION_BASKET_REVERSAL_NOTE`
    // ("Basket reversal"), not the `"Basket change returned%"` marker guard
    // #2 reads (`_sessionPooledOutLegsTotal`/Batch) — so the pooled IN leg
    // still reads as "unaccounted for" and this correctly stays FALSE. A
    // second `refundSessionBasket` call is prevented by the SEPARATE
    // `_assertSessionBasketReversible` guard, not by this predicate — this
    // is existing, unchanged behavior, not something this N+1 fix touches.
    const s1 = seedSession();
    const c1 = seedClient("C1");
    sellIntoSession(s1, c1, [{ name: "C1 item", price: 25, cost: 10 }]);
    payCash(s1, 25, c1);
    txnRepo.refundSessionBasket(s1, USER_ID);

    const s2 = seedSession(); // netted payout member, never refunded
    const c2 = seedClient("C2");
    sellIntoSession(s2, c2, [{ name: "C2 item", price: 100, cost: 60 }]);
    const payoutTxnId = payoutIntoSession(s2, 60);
    payCash(s2, 40, c2);

    const s3 = seedSession(); // overpaid + kept (never given back as change),
    // fully refunded item-by-item — real cash still sits in the pool, so
    // this must read FALSE (guard #2 of isSessionBasketFullyRefunded).
    const c3 = seedClient("C3");
    const { txnId: t3, itemIds: i3 } = sellIntoSession(s3, c3, [
      { name: "C3 item", price: 50, cost: 20 },
    ]);
    payCash(s3, 60, c3); // $10 kept, not returned as change
    txnRepo.refundSessionBasketItem({
      sessionId: s3,
      transactionId: t3,
      saleItemId: i3[0],
      quantity: 1,
      userId: USER_ID,
    });

    assertBatchMatchesIsolatedSingle([s1, s2, s3]);
    expect(txnRepo.isSessionBasketFullyRefunded(s1)).toBe(false);
    expect(txnRepo.isSessionBasketFullyRefunded(s2)).toBe(false);
    expect(txnRepo.isSessionBasketFullyRefunded(s3)).toBe(false);

    const rows = txnRepo.getRecent(5000) as Array<{
      id: number;
      session_id?: number | null;
      is_session_payout?: boolean;
    }>;
    const payoutRow = rows.find((r) => r.id === payoutTxnId)!;
    expect(payoutRow.is_session_payout).toBe(true);
  });

  it("a session with real change given back reads true once fully item-refunded, alongside account-charged sessions gated by the pending-'Session Debt'-marker guard", () => {
    // Cash tendered above the item's value, with the $5 overpayment given
    // back as a real "Basket change returned" OUT leg — exercises the
    // batched `_sessionPooledOutLegsTotalBatch` NET-pool reduction.
    const s1 = seedSession();
    const c1 = seedClient("D1");
    const { txnId: t1, itemIds: i1 } = sellIntoSession(s1, c1, [
      { name: "D1 item", price: 100, cost: 50 },
    ]);
    payCashWithChange(s1, 105, 5, c1);
    txnRepo.refundSessionBasketItem({
      sessionId: s1,
      transactionId: t1,
      saleItemId: i1[0],
      quantity: 1,
      userId: USER_ID,
    });

    const s2 = seedSession(); // account-charged, never repaid or refunded
    const c2 = seedClient("D2");
    sellIntoSession(s2, c2, [{ name: "D2 item", price: 70, cost: 35 }]);
    payAccount(s2, 70, c2);

    // Account-charged, fully repaid in cash AND its only item refunded —
    // but the basket's own 'Session Debt' debt_ledger row is STILL
    // unmarked: guard #3 (`isSessionBasketFullyRefunded`'s own doc,
    // point 3) is explicit that `refundSessionBasketItem` never writes the
    // 'Refund Reversal' idempotency marker — only the whole-basket call
    // does. So this session correctly stays FALSE even though nothing
    // material is left to hand back; the batch must agree with the
    // isolated single-session path on that, not "fix" it to true.
    const s3 = seedSession();
    const c3 = seedClient("D3");
    const { txnId: t3, itemIds: i3 } = sellIntoSession(s3, c3, [
      { name: "D3 item", price: 45, cost: 20 },
    ]);
    payAccount(s3, 45, c3);
    debtRepo.addRepayment({
      client_id: c3,
      amount_usd: 45,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    txnRepo.refundSessionBasketItem({
      sessionId: s3,
      transactionId: t3,
      saleItemId: i3[0],
      quantity: 1,
      userId: USER_ID,
    });

    assertBatchMatchesIsolatedSingle([s1, s2, s3]);
    expect(txnRepo.isSessionBasketFullyRefunded(s1)).toBe(true);
    expect(txnRepo.isSessionBasketFullyRefunded(s2)).toBe(false);
    expect(txnRepo.isSessionBasketFullyRefunded(s3)).toBe(false);
  });
});
