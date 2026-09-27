/**
 * Round-4 review, finding HIGH-1 — the session-item-refund payout guard
 * (`TransactionRepository._assertNoNettedPayoutMembers` / step 4a in
 * `_planSessionItemRefund`) read `transactions.amount_usd/lbp` to decide
 * "is this basket member a payout that was netted against the other
 * items". A FINANCIAL_SERVICE RECEIVE's own unified `transactions` row
 * carries the POSITIVE transfer amount (`FinancialServiceRepository.ts`
 * ~2074-2078) — never the negative customer-side payout sign checkout
 * stamps onto `customer_session_transactions.amount_usd/lbp`
 * (`item.amount = -60`, `SessionCheckoutService.processCartItem`'s
 * `financial:create` branch links it via `linkTransaction` with the cart
 * item's own signed `amount`). So a netted wallet/Binance cash-out was
 * invisible to the guard, and an item refund proceeded against a pool that
 * never held the netted portion — handing back LESS than the item is
 * worth.
 *
 * This reproduces the exact data shape a real `financial:create` /
 * `omt:add-transaction` RECEIVE checkout item leaves behind — a positive
 * `transactions.amount_usd` alongside a negative
 * `customer_session_transactions.amount_usd` — using the SAME hand-built
 * "mirror the real write shape" technique
 * `TransactionRepository.refundSessionBasketItem.test.ts`'s own
 * `rechargeIntoSession`/dual-currency helpers already use for a
 * RECHARGE/CUSTOM_SERVICE member, rather than driving the full
 * `SessionCheckoutService.checkout()` FinancialService pipeline (whose
 * `provider`/`service_type`/supplier-ledger data requirements are a large,
 * separate fixture surface unrelated to what this guard actually reads).
 *
 * Rule 17: run against the pre-fix query (`t.amount_usd` instead of
 * `cst.amount_usd`) and observed RED — the item refund SUCCEEDED and
 * returned only $40 of the $100 item. Fixed, it refuses with "includes a
 * payout".
 */

import Database from "better-sqlite3";
import { SalesRepository, resetSalesRepository } from "../SalesRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository.js";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository.js";
import { resetClientRepository } from "../ClientRepository.js";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository.js";
import { resetSettingsRepository } from "../SettingsRepository.js";
import { resetRateRepository } from "../RateRepository.js";
import { resetDebtRepository } from "../DebtRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService.js";
import { isSessionPayoutMember } from "../../constants/sessionPayoutMember.js";

const USER_ID = 1;
const RATE = 90000;

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

describe("Round-4 review finding HIGH-1 — session payout guard uses the cst (customer-side) amount, not transactions.amount_*", () => {
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

  // Rule 17, mechanism proof (never reverting production code): the shared
  // `isSessionPayoutMember` predicate itself is UNCHANGED by this fix — only
  // WHICH amount is fed to it changed (cst vs transactions). Feeding it the
  // OLD source (the FS row's own positive transfer amount) proves the
  // pre-fix bug would have missed this exact payout; feeding it the NEW
  // source (the cst row's negative customer-side amount) proves the fix
  // detects it. The integration test below proves the real repository code
  // is now wired to the second one.
  it("mechanism proof: isSessionPayoutMember misses the payout on the OLD source (transactions.amount_usd=60, positive) and catches it on the NEW source (cst.amount_usd=-60)", () => {
    const financialServiceRow = { type: "FINANCIAL_SERVICE", amount_usd: 60, amount_lbp: 0 };
    expect(isSessionPayoutMember(financialServiceRow)).toBe(false); // the pre-fix bug

    const cstRow = { type: "FINANCIAL_SERVICE", amount_usd: -60, amount_lbp: 0 };
    expect(isSessionPayoutMember(cstRow)).toBe(true); // the fix
  });

  it("refuses a session item refund when a FINANCIAL_SERVICE RECEIVE payout's transactions row is POSITIVE but its cst (customer-side) amount is NEGATIVE — the exact real-world shape", () => {
    const sessionId = Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
    const productId = Number(
      db.prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('Item', 60, 5)`).run()
        .lastInsertRowid,
    );
    // $100 sale, deferred (session-paid).
    const saleResult = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
        deferPayment: true,
      },
      USER_ID,
    );
    expect(saleResult.success).toBe(true);
    const saleId = saleResult.id!;
    const saleTxnRow = db
      .prepare(`SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`)
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, 100, 0)`,
    ).run(sessionId, saleId, saleTxnRow.id);
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as { id: number }
    ).id;

    // The netted FINANCIAL_SERVICE RECEIVE (Binance) payout: $60 was handed
    // to the customer at checkout, netted against the $100 sale so the
    // basket only collected $40 in cash. Its OWN `transactions` row carries
    // the POSITIVE transfer amount (the real FinancialServiceRepository
    // shape for a RECEIVE) — the bug is that the guard used to read THIS
    // value, never the customer-side sign.
    const fsId = Number(
      db.prepare(`INSERT INTO financial_services (provider) VALUES ('BINANCE')`).run().lastInsertRowid,
    );
    const fsTxnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, client_id, summary)
           VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, ?, 60, 0, NULL, 'Binance RECEIVE (session)')`,
        )
        .run(fsId, USER_ID).lastInsertRowid,
    );
    // The customer-side (cst) amount is NEGATIVE — this is the real payout
    // sign checkout stamps (`item.amount = -60`).
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'financial_service', ?, ?, -60, 0)`,
    ).run(sessionId, fsId, fsTxnId);

    // Only $40 pooled in cash — the $60 was paid out directly, never pooled.
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 40 }],
      exchangeRate: RATE,
      userId: USER_ID,
    });

    // Fixed behavior: refused, because the basket contains a netted payout
    // (correctly detected via the cst amount).
    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: saleTxnRow.id,
        saleItemId: itemId,
        quantity: 1,
        userId: USER_ID,
      }),
    ).toThrow(/includes a payout/);

    // Same refusal from the read-only preview (`getSessionItemRefundPreview`
    // also runs `_planSessionItemRefund`, which shares the guard).
    expect(() =>
      txnRepo.getSessionItemRefundPreview({
        sessionId,
        transactionId: saleTxnRow.id,
        saleItemId: itemId,
        quantity: 1,
      }),
    ).toThrow(/includes a payout/);
  });
});
