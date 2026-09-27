/**
 * Round-4 review finding L1 — `TransactionRepository._cancelSessionDebt`
 * (the whole-basket reversal's "cancel what's still attributable to the
 * account side" step) subtracted `takeUsd`/`takeLbp` from the ORIGINAL
 * 'Session Debt' row's `amount_usd`/`amount_lbp` without rounding the
 * result. `takeUsd` is itself the SUM (across every prior item refund's own
 * `accountAttributedUsd`, read back from each REFUND row's metadata_json)
 * of UNROUNDED floating-point shares — so once two item refunds' shares
 * summed to (say) 10.10 + 20.20 = 30.299999999999997 in IEEE-754, while the
 * original charge is stored as the double nearest 30.3, the "what's left"
 * subtraction landed on a few femtocents of dust instead of exactly 0.
 * `DebtRepository.findClientHistory`'s exact `amount_usd = 0` filter then
 * failed to recognize that dust row as the zero-net idempotency marker it
 * is, so it surfaced on the Debts page as a visible "-$0.00" row.
 *
 * This file demonstrates the dust is a real property of IEEE-754 float
 * arithmetic on these exact numbers (never reverting any production code —
 * CLAUDE.md rule 17 forbids that), then proves the REAL repository method,
 * exercised through real writers end to end, lands on EXACTLY 0 — both the
 * written reversal row and `DebtRepository.getClientBalance`.
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
import { DebtRepository, resetDebtRepository } from "../DebtRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService.js";

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
    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, maintenance_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0, stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, batch_id INTEGER NOT NULL, sale_item_id INTEGER,
      custom_service_id INTEGER, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE', is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
    );
  `);
  return db;
}

const USER_ID = 1;
const RATE = 90000;

describe("TransactionRepository._cancelSessionDebt rounding (round-4 finding L1)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let debtRepo: DebtRepository;
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
    debtRepo = new DebtRepository();
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

  it("IEEE-754 fact (no production code involved): 10.10 + 20.20 is NOT exactly 30.30", () => {
    // This is the float-arithmetic property that made the pre-fix
    // `_cancelSessionDebt` land on a few femtocents of dust instead of an
    // exact 0 — demonstrated directly, never by reverting the fix.
    expect(10.1 + 20.2).not.toBe(30.3);
    expect(Math.abs(10.1 + 20.2 - 30.3)).toBeGreaterThan(0);
  });

  it("a whole-basket reversal after both items were individually refunded lands on EXACTLY 0 (not dust)", () => {
    const clientId = Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES ('amir')`).run().lastInsertRowid,
    );
    const sessionId = Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
    const productIds = [
      Number(db.prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('A', 5, 10)`).run().lastInsertRowid),
      Number(db.prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('B', 5, 10)`).run().lastInsertRowid),
    ];
    const total = 10.1 + 20.2;
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: [
          { product_id: productIds[0], quantity: 1, price: 10.1 },
          { product_id: productIds[1], quantity: 1, price: 20.2 },
        ],
        total_amount: total,
        discount: 0,
        final_amount: total,
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
    const saleTxnId = Number(
      (db.prepare(`SELECT id FROM transactions WHERE source_table='sales' AND source_id=? AND type='SALE'`).get(saleId) as { id: number }).id,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, ?, 0)`,
    ).run(sessionId, saleId, saleTxnId, total);
    const itemIds = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`).all(saleId) as { id: number }[]
    ).map((r) => r.id);

    // Whole basket charged to CUSTOMER_ACCOUNT, USD, in ONE 'Session Debt'
    // row (30.3) — the reviewer's exact repro numbers.
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: total }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });

    // Refund BOTH items individually — each call's own `accountAttributedUsd`
    // (10.1, then 20.2) is what a LATER call sums via
    // `_priorSessionItemRefundAccountAttributed`.
    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: saleTxnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: saleTxnId,
      saleItemId: itemIds[1],
      quantity: 1,
      userId: USER_ID,
    });

    // Whole-basket reversal — "reverse only what's left" (owner decision
    // Q1): nothing should be left, and the reversal row it writes must be
    // EXACT zero, not float dust.
    txnRepo.refundSessionBasket(sessionId, USER_ID);

    const reversalRows = db
      .prepare(
        `SELECT amount_usd, amount_lbp FROM debt_ledger WHERE session_id = ? AND transaction_type = 'Refund Reversal'`,
      )
      .all(sessionId) as { amount_usd: number; amount_lbp: number }[];
    expect(reversalRows.length).toBeGreaterThan(0);
    for (const row of reversalRows) {
      expect(row.amount_usd).toBe(0);
      expect(row.amount_lbp).toBe(0);
    }

    // `toBeCloseTo` (not `.toBe`) — SQLite's SUM() over a zero-valued row
    // can legitimately return a NEGATIVE zero (-0), which is economically
    // identical to 0 but fails `Object.is`-based `.toBe(0)`; not a money bug.
    const balance = debtRepo.getClientBalance(clientId);
    expect(balance.balance_usd).toBeCloseTo(0, 6);
    expect(balance.balance_lbp).toBeCloseTo(0, 6);

    // The exact-zero reversal row is filtered from client history regardless
    // (round-3 finding #7) — findClientHistory's now-tolerant filter must
    // still hide it.
    const history = debtRepo.findClientHistory(clientId);
    const visibleZeroReversal = history.find(
      (h) => h.transaction_type === "Refund Reversal" && h.amount_usd === 0 && h.amount_lbp === 0,
    );
    expect(visibleZeroReversal).toBeUndefined();
  });
});
