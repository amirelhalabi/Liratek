/**
 * Round-4 review findings HIGH-2 and MEDIUM-3 — `_splitAcrossPoolCurrencyMix`
 * / `_sessionPooledOutLegsTotal`'s availability math for an item refund's
 * cash-back default.
 *
 * HIGH-2 — `_sessionPooledOutLegsTotal` counted EVERY negative
 * drawer-affecting pooled leg as "already given back", including a
 * NON-netted PAYOUT leg (`SessionPaymentService`'s `kind: "PAYOUT"`, noted
 * "Basket payout to customer" — a direct cashout that never had a
 * corresponding `customer_session_transactions` member, so
 * `_assertNoNettedPayoutMembers`/step 4a never saw it and never refused the
 * refund). That shrank an item refund's available cash-back by the
 * payout's own amount even though the sale's OWN pooled IN leg fully
 * collected the item's price. Fixed: only a CHANGE leg (noted "Basket
 * change returned") counts.
 *
 * MEDIUM-3 — the mixed-currency-pool split's ratio used to be computed from
 * the GROSS tendered amounts (ignoring change already given back in either
 * currency), and only the FIRST-computed side (USD) could push its leftover
 * to the other side; the LBP side's own cap, computed last, had nowhere to
 * push ITS leftover. Fixed: the ratio is computed from the NET mix
 * (IN minus CHANGE), and whichever side's cap binds pushes its shortfall to
 * the other side.
 *
 * Fixture/helpers copied from
 * `TransactionRepository.refundSessionBasketItem.test.ts` (rule 14 — same
 * established schema/helpers, not reinvented).
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

describe("Round-4 review findings HIGH-2 / MEDIUM-3 — session pool availability", () => {
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

  function seedSession(): number {
    return Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
  }

  function sellIntoSession(
    sessionId: number,
    items: Array<{ name: string; price: number; cost: number }>,
  ): { saleId: number; txnId: number; itemIds: number[] } {
    const productIds = items.map((it) =>
      Number(
        db
          .prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES (?, ?, 100)`)
          .run(it.name, it.cost).lastInsertRowid,
      ),
    );
    const totalAmount = items.reduce((s, it) => s + it.price, 0);
    const result = salesRepo.processSale(
      {
        client_id: null,
        items: items.map((it, i) => ({ product_id: productIds[i], quantity: 1, price: it.price })),
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
      .prepare(`SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`)
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, ?, 0)`,
    ).run(sessionId, saleId, txnRow.id, totalAmount);
    const itemIds = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`).all(saleId) as { id: number }[]
    ).map((r) => r.id);
    return { saleId, txnId: txnRow.id, itemIds };
  }

  it("HIGH-2: a $100 sale item refunds its FULL amount even though the basket ALSO paid out $60 to the customer via a non-netted PAYOUT leg", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, [{ name: "item", price: 100, cost: 60 }]);

    // $100 tendered in, PLUS a separate $60 payout (kind: PAYOUT) — no
    // session member represents this payout, so `_assertNoNettedPayoutMembers`
    // correctly never blocks the refund; only the pool's AVAILABILITY math
    // is at risk of wrongly shrinking by the payout's amount.
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 100, direction: "IN" },
        { method: "CASH", currencyCode: "USD", amount: 60, direction: "OUT", kind: "PAYOUT", payoutOrigin: "GENERAL" },
      ],
      exchangeRate: RATE,
      userId: USER_ID,
    });

    const generalUsdBefore = (
      db.prepare(`SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code='USD'`).get() as {
        balance: number;
      }
    ).balance;

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    // The FULL $100 comes back — never capped to $40 by the unrelated payout.
    expect(result.remainderUsd).toBeCloseTo(100, 6);
    const generalUsdAfter = (
      db.prepare(`SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code='USD'`).get() as {
        balance: number;
      }
    ).balance;
    expect(generalUsdAfter).toBeCloseTo(generalUsdBefore - 100, 6);
  });

  it("MEDIUM-3: two lines ($60+$40) tendered $50 USD + 4,895,000 LBP with 445,000 LBP change — refunding both returns EXACTLY $50 + 4,450,000 LBP (no shortfall)", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, [
      { name: "lineA", price: 60, cost: 30 },
      { name: "lineB", price: 40, cost: 20 },
    ]);

    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 50, direction: "IN" },
        { method: "CASH", currencyCode: "LBP", amount: 4_895_000, direction: "IN" },
        { method: "CASH", currencyCode: "LBP", amount: 445_000, direction: "OUT", kind: "CHANGE" },
      ],
      exchangeRate: 89000,
      userId: USER_ID,
    });

    const r1 = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
      exchangeRate: 89000,
    });
    const r2 = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[1],
      quantity: 1,
      userId: USER_ID,
      exchangeRate: 89000,
    });

    const totalUsd = r1.remainderUsd + r2.remainderUsd;
    const totalLbp = r1.remainderLbp + r2.remainderLbp;
    expect(totalUsd).toBeCloseTo(50, 2);
    expect(totalLbp).toBeCloseTo(4_450_000, 1);
  });
});
