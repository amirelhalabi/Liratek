/**
 * LIRA-232 phase 1 (SESSION_ITEM_REFUND_PLAN.md) — refunding a single item
 * out of a session basket. Rule 17: this file was written BEFORE
 * `TransactionRepository.refundSessionBasketItem` existed and run against
 * that state first (every case failed with "refundSessionBasketItem is not
 * a function" / "getSessionItemRefundPreview is not a function" — the
 * strongest possible failing-first proof for brand-new functionality, since
 * there is no way to call it at all on the pre-change tree). It was then run
 * again after the implementation landed, and the failures recorded in this
 * file's own commit history / PR diff are the red→green evidence.
 *
 * Fixture strategy: builds session-basket SALE fixtures directly with
 * `SalesRepository.processSale({ deferPayment: true })` (the session-cart
 * flow's own deferred-payment mode — see SessionPaymentService's header
 * doc), linked into the session the same way `SessionCheckoutService` links
 * every cart item — a `customer_session_transactions` row with
 * `unified_transaction_id` set — then pays the basket via the REAL
 * `SessionPaymentService.recordBasketPayment` (never hand-rolled payments
 * rows), matching `TransactionRepository.refundSessionBasketCostPriceFlow
 * .test.ts`'s established pattern (financial-services variant) applied to
 * SALE instead.
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
import { SalesService } from "../../services/SalesService";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER
    );

    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      total_amount_usd REAL NOT NULL DEFAULT 0,
      discount_usd REAL NOT NULL DEFAULT 0,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL NOT NULL DEFAULT 0,
      change_given_usd REAL NOT NULL DEFAULT 0,
      change_given_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name TEXT DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'completed',
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      sold_price_usd REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei TEXT,
      warranty_until TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_quantity INTEGER NOT NULL DEFAULT 0
    );

    -- Coordinator follow-up — unitExtras on the session SALE branch: a
    -- product_units row linked to a sale_item, flipped SOLD at processSale
    -- time (product_unit_id) and back to IN_STOCK (with the operator's
    -- defective/warranty flags) by applySaleItemReversalForSession.
    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER DEFAULT 1,
      product_id               INTEGER NOT NULL,
      imei                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';

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
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);

    CREATE TABLE payment_methods (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      session_id INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      edited_by INTEGER,
      edited_at DATETIME
    );

    CREATE TABLE customer_sessions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_notes TEXT,
      user_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      started_by TEXT NOT NULL,
      closed_by TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    CREATE TABLE exchange_rates (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES ('LBP', 90000, 89000, 91000, 1);

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    -- DebtRepository.addRepayment's OMT/WHISH service-debt routing step
    -- unconditionally joins financial_services (finding #6's real-repayment
    -- tests use the REAL addRepayment, not a hand-set covered_usd) — a
    -- missing table here dies in setup looking like an assertion failure
    -- (see CLAUDE.md's "Test schemas silently void whole files" note).
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT
    );

    -- Finding #5/#4 fixtures hand-build a RECHARGE session member (mirroring
    -- RechargeRepository.processRecharge's deferPayment write: a 'RECHARGE'
    -- transactions row + its own telecom-stock payments leg, WITHOUT going
    -- through the real recharge module) — _markSourceRefunded's supported-
    -- table list includes 'recharges', so it needs to exist or the generic
    -- item reversal dies in setup (CLAUDE.md's "Test schemas silently void
    -- whole files" note).
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT
    );

    -- Finding #3's dual-currency fixture hand-builds a CUSTOM_SERVICE member
    -- the same way — 'custom_services' is also in _markSourceRefunded's list.
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT
    );

    -- SUPPLIER_STOCK_INTAKE_PLAN.md v164 — production code now unconditionally
    -- touches these two tables from SalesRepository.processSale/refundSaleItem
    -- and TransactionRepository._restoreStock (StockBatchRepository.consume /
    -- restoreForSaleItem), even for a product with no batch history: a missing
    -- table here makes the whole file die in setup looking like an assertion
    -- failure (see CLAUDE.md's "Test schemas silently void whole files" note).
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
    );
  `);
  return db;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function balance(db: Database.Database, drawer: string, currency: string): number {
  const row = db
    .prepare(`SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`)
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function clientNetDebtUsd(db: Database.Database, clientId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_usd - covered_usd), 0) AS total FROM debt_ledger WHERE client_id = ?`)
    .get(clientId) as { total: number };
  return row.total;
}

function clientNetDebtLbp(db: Database.Database, clientId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_lbp - covered_lbp), 0) AS total FROM debt_ledger WHERE client_id = ?`)
    .get(clientId) as { total: number };
  return row.total;
}

function insertProduct(db: Database.Database, name: string, costUsd: number): number {
  return Number(
    db
      .prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES (?, ?, 100)`)
      .run(name, costUsd).lastInsertRowid,
  );
}

function insertUnit(db: Database.Database, productId: number, imei: string): number {
  return Number(
    db
      .prepare(`INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, ?, 'IN_STOCK')`)
      .run(productId, imei).lastInsertRowid,
  );
}

function getUnit(
  db: Database.Database,
  id: number,
): { status: string; is_defective: number; warranty_override_until: string | null } {
  return db
    .prepare(`SELECT status, is_defective, warranty_override_until FROM product_units WHERE id = ?`)
    .get(id) as { status: string; is_defective: number; warranty_override_until: string | null };
}

describe("TransactionRepository.refundSessionBasketItem (LIRA-232 phase 1)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let sessionPaymentService: SessionPaymentService;
  const USER_ID = 1;
  const RATE = 90000;

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

  function seedClient(name = "amir"): number {
    return Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES (?)`).run(name).lastInsertRowid,
    );
  }

  /** Sells `items` (each {name, price, cost, qty}) into a session basket via
   *  deferPayment, links each line's SALE txn into the session, and returns
   *  the sale id, its unified SALE transaction id, and each line's sale_item id. */
  function sellIntoSession(
    sessionId: number,
    clientId: number | null,
    items: Array<{ name: string; price: number; cost: number; qty?: number }>,
  ): { saleId: number; txnId: number; itemIds: number[] } {
    const productIds = items.map((it) => insertProduct(db, it.name, it.cost));
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
      .prepare(`SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`)
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, ?, 0)`,
    ).run(sessionId, saleId, txnRow.id, totalAmount);
    const itemIds = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`).all(saleId) as {
        id: number;
      }[]
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

  function payMixed(
    sessionId: number,
    cashUsd: number,
    accountUsd: number,
    clientId: number,
  ): void {
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: cashUsd },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: accountUsd },
      ],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
  }

  function payAccountLbp(sessionId: number, amountLbp: number, clientId: number): void {
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: amountLbp }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
  }

  /** F5 fixture — cash tendered ABOVE the basket's value, with the
   *  overpayment returned as a real "Basket change returned" OUT leg
   *  (`kind` omitted defaults to CHANGE — SessionPaymentService.ts). */
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

  /** Finding #5/#4 fixture — hand-builds a session-linked RECHARGE member,
   *  mirroring RechargeRepository.processRecharge(deferPayment)'s OWN write
   *  shape: a 'RECHARGE' transactions row (client-facing amount lives on the
   *  session's pooled leg, NOT here — deferPayment mode) plus its OWN
   *  telecom-stock payments leg (`method`/`drawer_name` = the carrier, a
   *  NEGATIVE amount debiting the provider drawer — see
   *  RechargeRepository.ts's `stockLeg` write, ~line 1082-1101). Returns the
   *  member's own unified transaction id. */
  function rechargeIntoSession(
    sessionId: number,
    clientId: number | null,
    priceUsd: number,
    stockLegUsd: number,
    carrier = "MTC",
  ): number {
    const tenantId = 1;
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary, tenant_id)
           VALUES ('RECHARGE', 'recharges', 1, ?, 0, 0, 0, 0, ?, 'Recharge (session)', ?)`,
        )
        .run(USER_ID, clientId, tenantId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id)
       VALUES (?, ?, ?, 'USD', ?, 'Telecom stock leg', ?, ?)`,
    ).run(txnId, carrier, carrier, -stockLegUsd, USER_ID, tenantId);
    db.prepare(
      `INSERT OR IGNORE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, 'USD', 0)`,
    ).run(carrier);
    db.prepare(
      `UPDATE drawer_balances SET balance = balance - ? WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = 'USD'`,
    ).run(stockLegUsd, carrier);
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'recharge', 1, ?, ?, 0)`,
    ).run(sessionId, txnId, priceUsd);
    return txnId;
  }

  /** Finding #3 fixture — hand-builds a session-linked, DUAL-CURRENCY
   *  CUSTOM_SERVICE member ($usd + LBP, both nonzero simultaneously — the
   *  exact shape the old single-tag `itemCurrency` pick silently dropped
   *  one side of). */
  function customServiceIntoSession(
    sessionId: number,
    clientId: number | null,
    amountUsd: number,
    amountLbp: number,
  ): number {
    const tenantId = 1;
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary, tenant_id)
           VALUES ('CUSTOM_SERVICE', 'custom_services', 1, ?, ?, ?, 0, 0, ?, 'Custom service (session)', ?)`,
        )
        .run(USER_ID, amountUsd, amountLbp, clientId, tenantId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'custom_service', 1, ?, ?, ?)`,
    ).run(sessionId, txnId, amountUsd, amountLbp);
    return txnId;
  }

  /** Round-3 finding #2 fixture — hand-builds a session-linked PAYOUT member
   *  (a loto cash prize, negative amount_lbp — the SAME sign convention
   *  `LotoCashPrizeRepository.recordCashPrize` writes in production) that was
   *  netted against the basket's other items at checkout, never sold to the
   *  customer on its own. Never refunded directly in these tests — only used
   *  to prove its mere PRESENCE in the basket blocks an ITEM refund on a
   *  DIFFERENT (sold) member. */
  function payoutIntoSession(
    sessionId: number,
    amountLbp: number,
    type = "LOTO_CASH_PRIZE",
  ): number {
    const tenantId = 1;
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary, tenant_id)
           VALUES (?, 'loto_cash_prizes', 1, ?, 0, ?, 0, 0, NULL, 'Prize (session)', ?)`,
        )
        .run(type, USER_ID, -amountLbp, tenantId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'loto_cash_prize', 1, ?, ?, 0)`,
    ).run(sessionId, txnId, -amountLbp);
    return txnId;
  }

  function drawerBalance(drawerName: string, currency: "USD" | "LBP"): number {
    const row = db
      .prepare(`SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`)
      .get(drawerName, currency) as { balance: number } | undefined;
    return row ? row.balance : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  it("amir's case: basket fully on account, refunding the iPhone reduces the account by exactly the item amount and moves no drawer", () => {
    const clientId = seedClient("amir");
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "test", price: 120, cost: 100 },
      { name: "testpart", price: 15, cost: 10 },
    ]);
    payAccount(sessionId, 1635, clientId);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(1635, 6);

    const generalBefore = balance(db, "General", "USD");
    const stockBefore = (
      db.prepare(`SELECT stock_quantity FROM products WHERE id = (SELECT product_id FROM sale_items WHERE id = ?)`)
        .get(itemIds[0]) as { stock_quantity: number }
    ).stock_quantity;

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.itemAmountUsd).toBeCloseTo(1500, 6);
    expect(result.accountReductionUsd).toBeCloseTo(1500, 6);
    expect(result.remainderUsd).toBeCloseTo(0, 6);
    expect(result.legs).toHaveLength(0);

    // No drawer moved.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 6);
    // Debt reduced to exactly $135.
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(135, 6);
    // Stock +1.
    const stockAfter = (
      db.prepare(`SELECT stock_quantity FROM products WHERE id = (SELECT product_id FROM sale_items WHERE id = ?)`)
        .get(itemIds[0]) as { stock_quantity: number }
    ).stock_quantity;
    expect(stockAfter).toBe(stockBefore + 1);
    // Profit stamp -200 (1500-1300 margin, no discount).
    const refundTxn = db
      .prepare(`SELECT profit_usd FROM transactions WHERE id = ?`)
      .get(result.refundTransactionId) as { profit_usd: number };
    expect(refundTxn.profit_usd).toBeCloseTo(-200, 6);
    // Linked to the session.
    const linked = db
      .prepare(`SELECT id FROM customer_session_transactions WHERE session_id = ? AND unified_transaction_id = ?`)
      .get(sessionId, result.refundTransactionId);
    expect(linked).toBeDefined();
  });

  it("cash basket: default legs hand back the item's full price via the basket's own pooled method, and the drawer moves by exactly that", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "charger", price: 15, cost: 8 },
      { name: "cable", price: 20, cost: 10 },
    ]);
    payCash(sessionId, 35);
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.accountReductionUsd).toBe(0);
    expect(result.remainderUsd).toBeCloseTo(15, 6);
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].method).toBe("CASH");
    expect(result.legs[0].amount).toBeCloseTo(15, 6);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore - 15, 6);
  });

  it("cash basket: a cashier-chosen return method posts exactly that leg instead of the default", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "charger", price: 15, cost: 8 },
    ]);
    payCash(sessionId, 15);
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
    });

    expect(result.legs).toHaveLength(1);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore - 15, 6);

    // An override that doesn't match R is rejected.
    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 999 }],
      }),
    ).toThrow();
  });

  it("mixed basket (cash + account): the account is reduced first, only the remainder is handed back", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    payMixed(sessionId, 60, 40, clientId);
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.accountReductionUsd).toBeCloseTo(40, 6);
    expect(result.remainderUsd).toBeCloseTo(10, 6);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore - 10, 6);
  });

  // Finding #6 (adversarial review, HIGH) — "account first" used to ignore
  // repayments entirely: `_coverServiceDebtsFIFO` (DebtRepository.ts)
  // deliberately excludes 'Session Debt' from FIFO coverage (repayments
  // against a session basket net the CLIENT's total balance via a separate
  // negative 'Repayment' row, never `covered_usd`/`covered_lbp` on the
  // charge row itself), so the pre-fix `outstandingUsd = amount_usd -
  // covered_usd` always read the GROSS $100 charge, repaid or not.
  //
  // This test replaces the old version, which FAKED the bug's "fix" by
  // hand-setting `covered_usd = 70` directly via SQL — a shape repayments
  // never actually produce — so it exercised nothing about the real
  // mechanism and passed against BOTH the broken and the fixed code. Rule
  // 17: run against the pre-fix `_planSessionItemRefund` (which read
  // `d.amount_usd - d.covered_usd` with `covered_usd` still 0), this test
  // measured `accountReductionUsd = 100` (the full charge — the $70
  // repayment was invisible) and `remainderUsd = 0`, instead of the
  // owner's worked example (SESSION_ITEM_REFUND_PLAN.md §3, row 4): reduce
  // $30, hand back $20.
  it("partly repaid debt (REAL repayment via DebtRepository.addRepayment): only the OUTSTANDING part is reduced, and the rest comes back as cash", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
      { name: "filler", price: 50, cost: 30 },
    ]);
    payAccount(sessionId, 100, clientId);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(100, 6);

    // A REAL $70 repayment — writes its own negated 'Repayment' debt_ledger
    // row against the CLIENT (never touches the Session Debt row's own
    // covered_usd, which is exactly the point).
    const debtRepo = new DebtRepository();
    debtRepo.addRepayment({
      client_id: clientId,
      amount_usd: 70,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(30, 6);
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    // Item $50: only $30 is still genuinely owed (account reduced by $30,
    // written as a real debt_ledger credit); the other $20 was ALREADY
    // repaid in cash, so it comes back as cash, not a second debt credit.
    expect(result.accountReductionUsd).toBeCloseTo(30, 6);
    expect(result.remainderUsd).toBeCloseTo(20, 6);
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].currency_code).toBe("USD");
    expect(result.legs[0].amount).toBeCloseTo(20, 6);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore - 20, 6);
  });

  it("fully repaid debt: the item refund is ALL cash, never a store credit, and balance stays 0", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    payAccount(sessionId, 50, clientId);
    const debtRepo = new DebtRepository();
    debtRepo.addRepayment({
      client_id: clientId,
      amount_usd: 50,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.accountReductionUsd).toBe(0);
    expect(result.remainderUsd).toBeCloseTo(50, 6);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore - 50, 6);
  });

  it("mixed $60 cash + $40 account, the $40 repaid: item $50 → credit 0, cash 50 — and refunding the rest of the basket returns the repaid $40 too (round-2 finding #1, BLOCKER)", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
      { name: "filler", price: 50, cost: 30 },
    ]);
    const generalBaseline = balance(db, "General", "USD");
    payMixed(sessionId, 60, 40, clientId);
    const debtRepo = new DebtRepository();
    debtRepo.addRepayment({
      client_id: clientId,
      amount_usd: 40,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    // General now holds the $60 checkout cash + the $40 repayment.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBaseline + 100, 6);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.accountReductionUsd).toBe(0);
    expect(result.remainderUsd).toBeCloseTo(50, 6);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);

    // Round-2 finding #1 (BLOCKER): refund the rest of the basket (the
    // "filler" line). The customer paid $100 of REAL money in total ($60
    // cash at checkout + a genuine $40 repayment) and nothing remains on
    // the account, so they are owed all $100 back. Pre-fix,
    // `_reverseSessionPooledPayments` treated item A's FULL $50 money-back
    // leg (not just its $10 pool-attributed share) as "already returned
    // from the pool", so it only reversed $10 more of the $60 pool leg —
    // $40 of the customer's own repayment stayed stuck in the General
    // drawer forever.
    txnRepo.refundSessionBasket(sessionId, USER_ID);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBaseline, 6);
  });

  // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md, SESSION_ITEM_REFUND_PLAN.md §9b
  // item 12, SETTLED 2026-09-27) superseded the day's-buy-rate default this
  // test originally proved: the default is now the refunded member's own
  // BOOKED rate (the sale's `exchange_rate_snapshot`), and the cashier can
  // type any rate explicitly. This basket's debt was booked in LBP at the
  // day's buy rate (89,000) at payment time — passing that SAME rate here
  // (what the popup would show if the cashier typed it, or what a caller
  // reads off a stored per-basket rate) still clears the account EXACTLY;
  // omitting it now defaults to the SALE's own rate (90,000) instead, which
  // leaves the small mismatch residue the plan names as a "known
  // limitation" (§4) — proved separately below.
  it("currency mismatch: an LBP-only account debt is reduced EXACTLY when refunded at the SAME rate it was booked at (LIRA-236 typed rate)", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    // 50 USD * buy_rate(89000) = 4,450,000 LBP debt — book it directly in LBP.
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4_450_000 }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(4_450_000, 1);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
      exchangeRate: 89000,
    });

    expect(result.accountReductionUsd).toBeCloseTo(0, 6);
    expect(result.accountReductionLbp).toBeCloseTo(4_450_000, 1);
    expect(result.remainderUsd).toBeCloseTo(0, 2);
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(0, 1);
  });

  // LIRA-236 — the SAME scenario, but the cashier does NOT type a rate: the
  // default is now the SALE's own booked rate (90,000, `RATE`), not the
  // rate the debt happened to be booked at (89,000). That mismatch leaves a
  // small residue — the "known limitation" REFUND_EXCHANGE_RATE_PLAN.md §4
  // names explicitly (the drawer/account differs slightly from the exact
  // refunded amount when the cashier refunds at a different rate than the
  // one used to book the charge).
  //
  // UPDATED (round-3 review, finding F3's "cap the no-pool branch"): this
  // basket has NO pooled cash at all (the debt is CUSTOMER_ACCOUNT-only), so
  // the small valuation residue from the rate mismatch is now capped to
  // ZERO instead of being converted and paid out as a few cents of cash
  // from a drawer that never received any — strictly better than the old
  // "small bounded residue," and the debt still nets to exactly 0 via the
  // account reduction alone.
  it("LIRA-236: without a typed rate, the same mismatch leaves NO residue — the no-pool cap absorbs it rather than paying cash out of a drawer that never held any", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4_450_000 }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    // Defaults to the SALE's own booked rate (90,000), not the day's buy
    // rate (89,000) the debt happened to be booked at.
    expect(result.accountReductionLbp).toBeCloseTo(4_450_000, 1);
    expect(result.remainderUsd).toBe(0);
    expect(result.legs).toHaveLength(0);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 6);
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(0, 1);
  });

  // Round-3 review finding F3 (HIGH) — distinct from the test above. That one
  // models a genuine buy/sell SPREAD (both `transactions.exchange_rate` AND
  // `sales.exchange_rate_snapshot` are RATE=90,000; only the debt's own LBP
  // conversion used 89,000) — REFUND_EXCHANGE_RATE_PLAN.md §4's documented,
  // in-scope-as-a-limitation residue. THIS test models the actual bug: the
  // item was added to the cart at RATE=90,000 (`transactions.exchange_rate`,
  // stamped at cart-creation time by `sellIntoSession`), but the basket was
  // actually CHECKED OUT — and its debt booked — at a DIFFERENT rate, 89,000
  // (`recordBasketPayment({ exchangeRate: 89000 })`, which back-fills
  // `sales.exchange_rate_snapshot = 89000` via `markSalePaid`). The debt's
  // own LBP amount (4,450,000) is computed AT 89,000, matching what checkout
  // actually booked — so refunding at the CORRECT default rate (the sale's
  // own `exchange_rate_snapshot`, 89,000) must net the account to EXACTLY 0,
  // not a residue "documented" as acceptable.
  it("F3: the default rate is the rate the BASKET was checked out at (sales.exchange_rate_snapshot), not the cart's stamped rate — nets to EXACTLY 0", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    // Checkout happens at 89,000 — DIFFERENT from the cart's stamped 90,000
    // (`RATE`, used by `sellIntoSession` above). 50 USD * 89,000 = 4,450,000.
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4_450_000 }],
      exchangeRate: 89000,
      userId: USER_ID,
      clientId,
    });
    // The checkout rate landed on the sale's own snapshot, not the cart rate.
    const saleRow = db
      .prepare(`SELECT exchange_rate_snapshot FROM sales WHERE id = (SELECT source_id FROM transactions WHERE id = ?)`)
      .get(txnId) as { exchange_rate_snapshot: number };
    expect(saleRow.exchange_rate_snapshot).toBe(89000);

    const generalBefore = balance(db, "General", "USD");

    // No typed rate — the refund must default to the CHECKOUT rate (89,000),
    // not the cart's stamped 90,000.
    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.accountReductionLbp).toBeCloseTo(4_450_000, 1);
    expect(result.remainderUsd).toBeCloseTo(0, 6);
    expect(result.remainderLbp).toBe(0);
    expect(result.legs).toHaveLength(0);
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(0, 1);
    // No cash left General — nothing was ever handed out of a drawer.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 6);
  });

  // F3 companion — the SAME bug/fix for a NON-sale member (CUSTOM_SERVICE),
  // which has no `sales.exchange_rate_snapshot` equivalent of its own. Its
  // default rate must come from
  // `customer_session_transactions.paid_exchange_rate` (migration v186,
  // stamped by `recordBasketPayment`), never the stale
  // `transactions.exchange_rate` the member happened to carry from whenever
  // it was added to the cart.
  it("F3 (non-SALE member): a CUSTOM_SERVICE member's default rate is the basket's CHECKOUT rate, not its own stale transactions.exchange_rate", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const tenantId = 1;
    // Hand-built CUSTOM_SERVICE member (mirrors `customServiceIntoSession`,
    // but with an explicit STALE cart-time rate — the exact shape the
    // finding names).
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, exchange_rate, summary, tenant_id)
           VALUES ('CUSTOM_SERVICE', 'custom_services', 1, ?, 50, 0, 0, 0, ?, 90000, 'Custom service (session)', ?)`,
        )
        .run(USER_ID, clientId, tenantId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'custom_service', 1, ?, 50, 0)`,
    ).run(sessionId, txnId);

    // Checked out at 89,000 — different from the stale 90,000 on the
    // transactions row. 50 USD * 89,000 = 4,450,000 LBP.
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4_450_000 }],
      exchangeRate: 89000,
      userId: USER_ID,
      clientId,
    });

    const stamped = db
      .prepare(`SELECT paid_exchange_rate FROM customer_session_transactions WHERE unified_transaction_id = ?`)
      .get(txnId) as { paid_exchange_rate: number };
    expect(stamped.paid_exchange_rate).toBe(89000);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      userId: USER_ID,
    });

    expect(result.accountReductionLbp).toBeCloseTo(4_450_000, 1);
    expect(result.remainderUsd).toBeCloseTo(0, 6);
    expect(result.remainderLbp).toBe(0);
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(0, 1);
  });

  // F3 (round-3 review) — "cap the no-pool branch": a basket with NO pooled
  // drawer-affecting cash legs at all must never hand out real cash for the
  // part of an item the account charge didn't cover. A dual-currency
  // CUSTOM_SERVICE ($10 + 450,000 LBP) charged to the account for ONLY its
  // $10 USD side (the LBP side was never charged to anything) has a real
  // 450,000 LBP "leftover" that isn't attributable to the account in either
  // currency — `_splitAcrossPoolCurrencyMix`'s no-pool branch used to
  // convert that leftover to cash and hand it out of General, even though
  // this basket never held a single dollar of pooled cash.
  it("F3: the no-pool branch never hands out cash a basket didn't receive (dual-currency item, account covers only ONE side)", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const txnId = customServiceIntoSession(sessionId, clientId, 10, 450000);
    // Only the $10 USD side is charged to the account — no LBP charge, and
    // NO pooled cash leg of any kind (CUSTOMER_ACCOUNT is non-drawer).
    payAccount(sessionId, 10, clientId);
    const generalBeforeUsd = balance(db, "General", "USD");
    const generalBeforeLbp = balance(db, "General", "LBP");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      userId: USER_ID,
    });

    // The USD side is reduced from the account; the LBP side has nothing to
    // come from — neither an account charge nor pooled cash — so it must be
    // ZERO, never converted-and-paid-out cash.
    expect(result.accountReductionUsd).toBeCloseTo(10, 6);
    expect(result.remainderLbp).toBe(0);
    expect(result.remainderUsd).toBeCloseTo(0, 6);
    expect(result.legs).toHaveLength(0);
    // Nothing left General — this basket never held cash to give back.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBeforeUsd, 6);
    expect(balance(db, "General", "LBP")).toBeCloseTo(generalBeforeLbp, 6);
  });

  it("Q2 — saleItemId omitted refunds ALL remaining lines of the sale in one operation", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId } = sellIntoSession(sessionId, clientId, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "test", price: 120, cost: 100 },
      { name: "testpart", price: 15, cost: 10 },
    ]);
    payAccount(sessionId, 1635, clientId);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      userId: USER_ID,
    });

    expect(result.itemAmountUsd).toBeCloseTo(1635, 6);
    expect(result.accountReductionUsd).toBeCloseTo(1635, 6);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
  });

  // ── Refusals ──────────────────────────────────────────────────────────
  it("refuses a payout/prize/kept-change member (owner decision #4)", () => {
    const sessionId = seedSession();
    const prizeTxnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp)
           VALUES ('LOTO_CASH_PRIZE', 'loto_cash_prizes', 1, ?, 0, -400000)`,
        )
        .run(USER_ID).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'loto_cash_prize', 1, ?, 0, -400000)`,
    ).run(sessionId, prizeTxnId);

    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: prizeTxnId,
        userId: USER_ID,
      }),
    ).toThrow(/cannot be refunded on its own/);
  });

  it("refuses refunding more than the available quantity", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "item", price: 10, cost: 5 },
    ]);
    payCash(sessionId, 10);

    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 2,
        userId: USER_ID,
      }),
    ).toThrow(/only 1 available/);
  });

  it("refuses a refund on a whole-reversed basket", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "item", price: 10, cost: 5 },
    ]);
    payCash(sessionId, 10);
    txnRepo.refundSessionBasket(sessionId, USER_ID);

    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      }),
    ).toThrow(/already been voided\/refunded/);
  });

  // ── Q1 — whole-basket reversal after an item refund ─────────────────────
  it("Q1: whole-basket reversal after an item refund nets to 0 per drawer, per currency", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "charger", price: 15, cost: 8 },
    ]);
    payCash(sessionId, 1515);
    const generalBaseline = balance(db, "General", "USD") - 1515;

    // Refund the iPhone alone first.
    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBaseline + 15, 6);

    // Then reverse whatever's left of the basket.
    const result = txnRepo.refundSessionBasket(sessionId, USER_ID);

    // Nets fully back to the pre-sale baseline.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBaseline, 6);
    // The charger line (still untouched) was the one whole-basket reversal
    // actually refunded — not a second, double reversal of the iPhone.
    expect(result.reversedTransactionIds).toEqual([txnId]);
    const chargerRow = db
      .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
      .get(itemIds[1]) as { refunded_quantity: number };
    expect(chargerRow.refunded_quantity).toBe(1);
  });

  it("Q1: whole-basket reversal after an item refund also nets the account to 0", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "charger", price: 15, cost: 8 },
    ]);
    payAccount(sessionId, 1515, clientId);

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(15, 6);

    txnRepo.refundSessionBasket(sessionId, USER_ID);

    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
  });

  // ── Regression: idempotency / LPAY-V1 are unaffected ─────────────────────
  it("a single item refund does NOT trip the whole-basket idempotency guard", () => {
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "charger", price: 15, cost: 8 },
    ]);
    payCash(sessionId, 1515);

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    // The basket is NOT considered whole-reversed — a second, independent
    // item refund (or the whole-basket path) must still be reachable.
    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[1],
        quantity: 1,
        userId: USER_ID,
      }),
    ).not.toThrow();
  });

  // ── Finding #1 (BLOCKER) — discount ignored ─────────────────────────────
  // Rule 17: run against the pre-fix `_computeSaleItemRefundAmounts`
  // (`refundAmount = item.sold_price_usd * refundQuantity`, no discount
  // netting), this measured itemAmountUsd = $50 per line (gross), two item
  // refunds summing to $100 handed back on a $90 tender — the exact
  // over-refund the finding names.
  it("finding #1: a discounted basket's item refund is net of the line's discount share, not gross", () => {
    const sessionId = seedSession();
    // 2 x $50 = $100 pre-discount, $10 discount → $90 tendered in cash.
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "item-a", price: 50, cost: 30 },
      { name: "item-b", price: 50, cost: 30 },
    ]);
    // sellIntoSession's processSale call always sends discount: 0 — apply
    // the discount directly on the sale row the same way processSale would
    // have stamped it, so the fixture matches a REAL discounted sale.
    db.prepare(`UPDATE sales SET discount_usd = 10, final_amount_usd = 90 WHERE id = (SELECT source_id FROM transactions WHERE id = ?)`).run(txnId);
    payCash(sessionId, 90);
    const generalBefore = balance(db, "General", "USD");

    const first = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    // $50 gross - ($10 discount * 0.5 share) = $45, not $50.
    expect(first.itemAmountUsd).toBeCloseTo(45, 6);
    expect(first.remainderUsd).toBeCloseTo(45, 6);

    const second = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[1],
      quantity: 1,
      userId: USER_ID,
    });
    expect(second.itemAmountUsd).toBeCloseTo(45, 6);

    // Both refunds together hand back exactly the $90 tender — the drawer
    // returns to its pre-sale baseline, never $10 short.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore - 90, 6);
  });

  // ── Finding #2 (BLOCKER) — cross-currency double refund ─────────────────
  it("finding #2: an item refunded out of an all-LBP-paid basket hands back LBP, not USD — and the whole-basket reversal nets to 0", () => {
    const sessionId = seedSession();
    // $100 item, paid entirely in 9,000,000 LBP (rate 90,000).
    const { txnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "item", price: 100, cost: 60 },
    ]);
    db.prepare(
      `INSERT INTO payments (session_id, method, drawer_name, currency_code, amount, note, created_by)
       VALUES (?, 'CASH', 'General', 'LBP', 9000000, 'Basket payment', ?)`,
    ).run(sessionId, USER_ID);
    db.prepare(
      `UPDATE drawer_balances SET balance = balance + 9000000 WHERE drawer_name = 'General' AND currency_code = 'LBP'`,
    ).run();
    const lbpBefore = balance(db, "General", "LBP");
    const usdBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    // The $100 remainder is handed back in LBP (what the basket actually
    // holds), never USD (the item's own native currency) — the pre-fix bug
    // always posted a USD CASH leg regardless of what the customer paid.
    //
    // LIRA-236 (SETTLED 2026-09-27) superseded the original day's-BUY-rate
    // default (89,000, owner's Q3 decision) this test used to assert: the
    // default is now the refunded member's own BOOKED rate — this SALE's
    // `exchange_rate_snapshot`, which IS the sell rate (90,000) the basket
    // was actually paid at (`RATE`, `sellIntoSession`'s own
    // `processSale({ exchange_rate: RATE })`). So the exact figure is now
    // $100 x 90,000 = 9,000,000 — EXACTLY what the pool collected, not the
    // old buy/sell-spread-shorted 8,900,000. This is the worked
    // improvement REFUND_EXCHANGE_RATE_PLAN.md describes: refunding at the
    // rate the sale was paid at returns exactly what the customer paid.
    expect(result.remainderUsd).toBeCloseTo(0, 6);
    expect(result.remainderLbp).toBeCloseTo(9000000, 1);
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].currency_code).toBe("LBP");
    expect(balance(db, "General", "USD")).toBeCloseTo(usdBefore, 6);
    expect(balance(db, "General", "LBP")).toBeCloseTo(lbpBefore - 9000000, 1);
  });

  // ── Finding #3 (BLOCKER) — dual-currency member refunds only USD ────────
  it("finding #3: a $ + LBP custom service on account reduces BOTH currencies of the charge, not just USD", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const serviceTxnId = customServiceIntoSession(sessionId, clientId, 10, 450000);
    // Basket charged to the account in the SAME dual-currency shape.
    payAccount(sessionId, 10, clientId);
    payAccountLbp(sessionId, 450000, clientId);
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(10, 6);
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(450000, 1);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: serviceTxnId,
      userId: USER_ID,
    });

    expect(result.itemAmountUsd).toBeCloseTo(10, 6);
    expect(result.itemAmountLbp).toBeCloseTo(450000, 1);
    expect(result.accountReductionUsd).toBeCloseTo(10, 6);
    expect(result.accountReductionLbp).toBeCloseTo(450000, 1);
    // BOTH currencies of the account are cleared — the pre-fix bug picked
    // USD only (amount_usd !== 0) and left the LBP side owed forever.
    expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(0, 1);
  });

  // ── Finding #4 (BLOCKER) — basket unreversable after a non-SALE item
  // refund ──────────────────────────────────────────────────────────────
  it("finding #4: a whole-basket refund AFTER a recharge item refund succeeds (not 'REFUND transactions cannot be voided or refunded') and nets to 0", () => {
    const sessionId = seedSession();
    const rechargeTxnId = rechargeIntoSession(sessionId, null, 20, 9, "MTC");
    const { txnId: saleTxnId, itemIds } = sellIntoSession(sessionId, null, [
      { name: "charger", price: 15, cost: 8 },
    ]);
    payCash(sessionId, 35); // 20 (recharge) + 15 (charger)
    const generalBaseline = balance(db, "General", "USD") - 35;

    // Refund the recharge item alone first — this is what used to poison
    // the whole basket (its own REFUND row set reverses_id and got picked
    // up again by the basket loop as if it were an unreversed member).
    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: rechargeTxnId,
      userId: USER_ID,
    });

    expect(() => txnRepo.refundSessionBasket(sessionId, USER_ID)).not.toThrow();

    // Nets fully back to the pre-sale baseline — the charger line (still
    // untouched by the item refund) was the one thing left to reverse. It
    // was never item-touched, so refundSessionBasket refunds it through the
    // ordinary WHOLE-transaction path (is_refunded, not refunded_quantity —
    // that field is item-refund-specific).
    expect(balance(db, "General", "USD")).toBeCloseTo(generalBaseline, 6);
    const chargerRow = db
      .prepare(`SELECT is_refunded FROM sale_items WHERE id = ?`)
      .get(itemIds[0]) as { is_refunded: number };
    expect(chargerRow.is_refunded).toBe(1);
    void saleTxnId;
  });

  // ── Finding #5 (BLOCKER) — recharge item refund doesn't restore the
  // provider drawer ────────────────────────────────────────────────────
  it("finding #5: a recharge item refund restores the provider (MTC) drawer, not just the carrier-line credits", () => {
    const sessionId = seedSession();
    const rechargeTxnId = rechargeIntoSession(sessionId, null, 20, 9, "MTC");
    payCash(sessionId, 20);
    const mtcBefore = drawerBalance("MTC", "USD");
    expect(mtcBefore).toBeCloseTo(-9, 6); // consumed at sale time

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: rechargeTxnId,
      userId: USER_ID,
    });
    void result;

    // The provider drawer is restored to 0 — the pre-fix bug left it stuck
    // at -9 (only the customer-facing cash leg was reversed, never the
    // recharge's OWN telecom-stock payments row).
    expect(drawerBalance("MTC", "USD")).toBeCloseTo(0, 6);
  });

  // ── Finding #10 — credit on the wrong client ────────────────────────────
  it("finding #10: the account credit lands on the client the Session Debt was charged to, not the item's own buyer", () => {
    const buyerA = seedClient("buyer A");
    const chargedB = seedClient("charged B");
    const sessionId = seedSession();
    // The sale line's own client_id is buyer A (processSale's own client
    // param); the BASKET's account charge is on client B — a real scenario
    // (an item rung up for one person, the whole visit billed to another's
    // account).
    const { txnId, itemIds } = sellIntoSession(sessionId, buyerA, [
      { name: "item", price: 50, cost: 30 },
    ]);
    payAccount(sessionId, 50, chargedB);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    expect(result.accountReductionUsd).toBeCloseTo(50, 6);
    // The credit reduced B's account (who was actually charged) — A's
    // balance (who never owed anything) is untouched at 0.
    expect(clientNetDebtUsd(db, chargedB)).toBeCloseTo(0, 6);
    expect(clientNetDebtUsd(db, buyerA)).toBeCloseTo(0, 6);
  });

  // ── Finding #11 — misc refusals ──────────────────────────────────────────
  it("finding #11: refuses a payout-direction (negative-amount) non-SALE member", () => {
    const sessionId = seedSession();
    const payoutTxnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp)
           VALUES ('CUSTOM_SERVICE', 'custom_services', 1, ?, -10, 0)`,
        )
        .run(USER_ID).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'custom_service', 1, ?, -10, 0)`,
    ).run(sessionId, payoutTxnId);

    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: payoutTxnId,
        userId: USER_ID,
      }),
    ).toThrow(/payout, not a sold item/);
  });

  it("finding #11: the account credit shows on the REFUND row's own account_payments, not smeared across the whole session group", () => {
    const clientId = seedClient("amir");
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "charger", price: 15, cost: 8 },
    ]);
    payAccount(sessionId, 1515, clientId);

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    const rows = txnRepo.getRecent(100);
    const refundRow = rows.find((r) => r.id === result.refundTransactionId)!;
    const saleRow = rows.find((r) => r.id === txnId)!;

    // The credit is the REFUND row's OWN account leg...
    expect(refundRow.account_payments?.length ?? 0).toBeGreaterThan(0);
    expect(
      refundRow.account_payments?.reduce((s, l) => s + l.amount, 0) ?? 0,
    ).toBeCloseTo(1500, 6);
    // ...the group's pooled session_account_payments still shows the
    // ORIGINAL $1,515 basket charge (real, unrelated information — that
    // charge genuinely happened) but is NOT reduced by the credit a second
    // time here — the credit lives ONLY on the REFUND row above, never
    // blended into the group total (which would read $15, not $1,515, if
    // the old bug's ACCOUNT_CHARGE_PREDICATE gap were still netting it in).
    const saleGroupAccountTotal =
      saleRow.session_account_payments?.reduce((s, l) => s + l.amount, 0) ?? 0;
    expect(saleGroupAccountTotal).toBeCloseTo(1515, 6);
  });

  // LIRA-236 — the default rate is now the refunded member's own BOOKED
  // rate FIRST (this SALE's `exchange_rate_snapshot`, always stamped by
  // `processSale`), so a cross-currency refund no longer needs the day's
  // rate table at all as long as the member itself recorded one — this is
  // the improvement (owner decision: "the rate the sale was paid at").
  // Reaching the true "no rate ANYWHERE" refusal now additionally requires
  // the member's OWN recorded rate to be missing too (simulated here by
  // clearing `transactions.exchange_rate` directly — a legacy/pre-rate-
  // snapshot row, or a data-repair edge case), on top of an empty rate
  // table.
  it("finding #11: refuses a cross-currency conversion when NO rate is available anywhere (not the member's own, not the day's), instead of guessing", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    // Basket debt is LBP-only; the item is USD-only — a cross-currency
    // account-first conversion IS needed. Remove the rate row entirely AND
    // the member's own recorded rate.
    //
    // F3 (round-3 review): a SALE member's "own recorded rate" is now
    // `sales.exchange_rate_snapshot` (the CHECKOUT rate), never
    // `transactions.exchange_rate` (the cart-time rate) — nulling the OLD
    // column no longer removes the rate this path actually reads, since
    // `payAccountLbp` → `recordBasketPayment` back-fills the snapshot
    // regardless. Null the snapshot instead to genuinely simulate "no rate
    // anywhere" post-fix.
    payAccountLbp(sessionId, 4500000, clientId);
    db.prepare(`DELETE FROM exchange_rates`).run();
    db.prepare(`UPDATE transactions SET exchange_rate = NULL WHERE id = ?`).run(txnId);
    db.prepare(
      `UPDATE sales SET exchange_rate_snapshot = NULL WHERE id = (SELECT source_id FROM transactions WHERE id = ?)`,
    ).run(txnId);

    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      }),
    ).toThrow(/Set the LBP exchange rate first/);
  });

  // LIRA-236 — the companion case: the member DOES have its own recorded
  // rate, so the refund now succeeds even with an EMPTY exchange_rates
  // table (no day's rate available at all) — this is the exact scenario
  // the test immediately above used to (incorrectly, pre-LIRA-236) expect
  // a refusal for.
  it("LIRA-236: a cross-currency refund succeeds with NO day's rate set, as long as the member has its own booked rate", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    payAccountLbp(sessionId, 4500000, clientId);
    db.prepare(`DELETE FROM exchange_rates`).run();

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    expect(result.accountReductionLbp).toBeGreaterThan(0);
  });

  // ── Finding #9 — debt aging/overdue ignore the session-item-refund credit ─
  // Rule 17: run against the pre-fix getClientDebtAging (no netting against
  // 'Session Item Refund' credits at all — the credit has no due_date, so it
  // never even reached the query's rows), this measured the "current" bucket
  // staying at the ORIGINAL $1,635 charge after refunding $1,500 of it,
  // instead of dropping to $135 — the exact owner-reported number.
  it("finding #9: getClientDebtAging nets a Session Item Refund credit against its own Session Debt charge", () => {
    const clientId = seedClient("amir");
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "test", price: 120, cost: 100 },
      { name: "testpart", price: 15, cost: 10 },
    ]);
    payAccount(sessionId, 1635, clientId);
    // Session Debt rows need a due_date to enter the aging buckets at all —
    // stamp a day in the FUTURE so it lands safely in the "current" bucket
    // (julianday('now') - julianday(due_date) <= 0 needs strict headroom;
    // due_date = 'now' races the clock between this UPDATE and the query).
    db.prepare(
      `UPDATE debt_ledger SET due_date = datetime('now', '+1 day') WHERE session_id = ? AND transaction_type = 'Session Debt'`,
    ).run(sessionId);
    const before = txnRepo.getClientDebtAging(clientId);
    expect(before.current.usd).toBeCloseTo(1635, 6);

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    const after = txnRepo.getClientDebtAging(clientId);
    expect(after.current.usd).toBeCloseTo(135, 6);
  });

  it("finding #9: getOverdueDebts nets the same credit for an overdue (past-due-date) charge", () => {
    const clientId = seedClient("amir");
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "iPhone", price: 1500, cost: 1300 },
      { name: "test", price: 120, cost: 100 },
      { name: "testpart", price: 15, cost: 10 },
    ]);
    payAccount(sessionId, 1635, clientId);
    db.prepare(
      `UPDATE debt_ledger SET due_date = datetime('now', '-10 days') WHERE session_id = ? AND transaction_type = 'Session Debt'`,
    ).run(sessionId);

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    const overdue = txnRepo.getOverdueDebts();
    const row = overdue.find((r) => r.client_id === clientId);
    expect(row).toBeDefined();
    expect(row!.total_usd).toBeCloseTo(135, 6);
  });

  it("round-2 finding #6 (LOW): a client whose overdue charge is fully credited (net 0) does not appear in the overdue list at all", () => {
    const clientId = seedClient("fully-credited");
    const sessionId = seedSession();
    const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item", price: 50, cost: 30 },
    ]);
    payAccount(sessionId, 50, clientId);
    db.prepare(
      `UPDATE debt_ledger SET due_date = datetime('now', '-10 days') WHERE session_id = ? AND transaction_type = 'Session Debt'`,
    ).run(sessionId);

    // Full refund of the only line nets the charge to exactly 0.
    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    expect(result.accountReductionUsd).toBeCloseTo(50, 6);

    // RED on the pre-fix HAVING (`SUM(d.amount_usd) > 0`, the RAW gross
    // charge — the credit row is excluded from `d` entirely, so it never
    // reduces this sum): the client still appears in the list even though
    // their NET balance for this charge is 0.
    const overdue = txnRepo.getOverdueDebts();
    expect(overdue.find((r) => r.client_id === clientId)).toBeUndefined();
  });

  // ── round-2 finding #3 (HIGH) — unitExtras routed per-line on Q2 ────────
  it("round-2 finding #3 (HIGH): Q2 'all remaining lines' routes each unit extra to the line it's actually linked to", () => {
    const sessionId = seedSession();
    const phoneId = insertProduct(db, "iPhone", 800);
    const chargerId = insertProduct(db, "charger", 5);
    const phoneUnitId = insertUnit(db, phoneId, "ROUTE0000000001");
    const result = salesRepo.processSale(
      {
        client_id: null,
        items: [
          { product_id: phoneId, quantity: 1, price: 1000, product_unit_id: phoneUnitId },
          { product_id: chargerId, quantity: 1, price: 15 },
        ],
        total_amount: 1015,
        discount: 0,
        final_amount: 1015,
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
       VALUES (?, 'sale', ?, ?, 1015, 0)`,
    ).run(sessionId, saleId, txnRow.id);
    payCash(sessionId, 1015);

    // RED on the pre-fix code: the WHOLE `unitExtras` array (which only
    // contains a unit linked to the PHONE line) is passed to EVERY line's
    // `applySaleItemReversalForSession`, including the charger's — and the
    // charger has no linked units at all, so `validateRefundUnitExtras`
    // rejects the phone's own unit as "not linked to sale item #<charger>".
    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnRow.id,
        userId: USER_ID,
        unitExtras: [{ unit_id: phoneUnitId, is_defective: true }],
      }),
    ).not.toThrow();

    const unit = getUnit(db, phoneUnitId);
    expect(unit.status).toBe("IN_STOCK");
    expect(unit.is_defective).toBe(1);
  });

  // ── round-2 finding #8 (LOW) — dual-currency pool split must never over-refund ──
  it("round-2 finding #8 (LOW): a dual-currency item refunded from a single-currency pool never hands back more than the pool actually holds", () => {
    const sessionId = seedSession();
    // $10 + 450,000 LBP native price, paid with $15 cash ONLY (no LBP pool
    // at all) — converting the LBP leftover at the buy rate (89000) would
    // ask for 10 + 450000/89000 = $15.06, more than the $15 the pool holds.
    const memberTxnId = customServiceIntoSession(sessionId, null, 10, 450000);
    payCash(sessionId, 15);
    const generalBefore = balance(db, "General", "USD");

    const result = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: memberTxnId,
      userId: USER_ID,
    });

    const totalLegsUsd = result.legs
      .filter((l) => l.currency_code === "USD")
      .reduce((s, l) => s + l.amount, 0);
    // RED on the pre-fix code: totalLegsUsd ≈ 15.056 — more than the pool
    // (and the drawer) ever received for this basket.
    expect(totalLegsUsd).toBeLessThanOrEqual(15 + 1e-9);
    expect(balance(db, "General", "USD")).toBeGreaterThanOrEqual(generalBefore - 15 - 1e-9);
  });

  // ── round-2 finding #9 (LOW) — LBP remainder/default legs are whole LBP ──
  it("round-2 finding #9 (LOW): the default LBP leg is rounded to a whole LBP figure a cashier's rounded override can match", () => {
    const sessionId = seedSession();
    // A $17 USD-only item refunded from a MIXED cash pool ($10 + 1,000,000
    // LBP) forces `_splitAcrossPoolCurrencyMix`'s buy-rate division
    // (10 + 1,000,000/89,000 usd-equivalent total) — pre-fix, the LBP
    // share lands on a fractional LBP figure (there is no sub-lira).
    const memberTxnId = customServiceIntoSession(sessionId, null, 17, 0);
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 10 },
        { method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
      ],
      exchangeRate: RATE,
      userId: USER_ID,
    });

    const preview = txnRepo.getSessionItemRefundPreview({
      sessionId,
      transactionId: memberTxnId,
    });

    const lbpLeg = preview.defaultLegs.find((l) => l.currency_code === "LBP");
    expect(lbpLeg).toBeDefined();
    // RED on the pre-fix code: the buy-rate division leaves a fractional
    // LBP amount (e.g. ...524.94) on both the preview and remainderLbp.
    expect(Number.isInteger(lbpLeg!.amount)).toBe(true);
    expect(Number.isInteger(preview.remainderLbp)).toBe(true);

    // A cashier confirming the previewed default legs, unmodified, must be
    // accepted by the SAME validator that sized them.
    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: memberTxnId,
        userId: USER_ID,
        refundLegs: preview.defaultLegs.map((l) => ({
          method: l.method,
          currencyCode: l.currency_code as "USD" | "LBP",
          amount: l.amount,
        })),
      }),
    ).not.toThrow();
  });

  // ── Coordinator follow-up — the client-balance cap in _cancelSessionDebt
  // was itself a regression: it ran even when NO item refund had happened,
  // so a real repayment against a whole-account-charged basket got
  // cancelled away instead of surviving as a store credit. Rule 17: written
  // and run BEFORE removing the cap — see the reported red numbers below.
  describe("_cancelSessionDebt — no balance cap (coordinator follow-up)", () => {
    it("(a) no item refunds: a real repayment survives the whole-basket reversal as a store credit, not a cancelled debt", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      sellIntoSession(sessionId, clientId, [{ name: "item", price: 100, cost: 60 }]);
      payAccount(sessionId, 100, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: USER_ID,
      });
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(30, 6);
      const generalBefore = balance(db, "General", "USD");

      // RED on the capped code: cancels min(100, balance=30) = 30, leaving
      // balance 0 instead of -70 — the customer's $70 vanishes instead of
      // surviving as a credit.
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(-70, 6);
      // Ledger-only reversal — no pooled cash existed to move.
      expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 6);
    });

    it("(b) compound case: item refund + repayment + whole-basket reversal fully reconciles to a $50 store credit", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "item-a", price: 50, cost: 30 },
        { name: "item-b", price: 50, cost: 30 },
      ]);
      payAccount(sessionId, 100, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: USER_ID,
      });

      // Item A refund: credit $30, cash back $20 (A_account = $50, capped by
      // the CURRENT balance $30 at THIS item refund's own point in time —
      // that per-item cap in _planSessionItemRefund is correct and untouched
      // by this fix; only the WHOLE-BASKET step's cap is removed).
      const itemResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      expect(itemResult.accountReductionUsd).toBeCloseTo(30, 6);
      expect(itemResult.remainderUsd).toBeCloseTo(20, 6);
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);

      // Whole-basket reversal of the remaining line (item B): cancels
      // 100 - 50 (item A's own A_account) = 50 more, unconditional on
      // balance. RED on the capped code: cancels min(50, balance=0) = 0.
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(-50, 6);

      // Reconciliation check: the customer paid $70 (the repayment); they
      // received $20 real cash back plus a $50 store credit (the magnitude
      // of the final negative balance) — 20 + 50 = 70, exactly what they paid.
      const totalPaid = 70;
      const cashBack = itemResult.legs.reduce((s, l) => s + l.amount, 0);
      const finalBalance = clientNetDebtUsd(db, clientId);
      expect(cashBack + Math.abs(finalBalance)).toBeCloseTo(totalPaid, 6);
    });

    it("(c) mixed currencies: the same compound case with an LBP account charge", () => {
      // Same-currency LBP throughout (custom-service members, not SALE
      // lines — SALE lines are always USD-denominated, which would pull in
      // the Q3 cross-currency buy-rate step tested separately by finding
      // #2/#3; this test isolates the balance-cap fix from that conversion).
      const clientId = seedClient();
      const sessionId = seedSession();
      const memberA = customServiceIntoSession(sessionId, clientId, 0, 2_250_000);
      customServiceIntoSession(sessionId, clientId, 0, 2_250_000);
      payAccountLbp(sessionId, 4_500_000, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: 0,
        amount_lbp: 3_150_000, // the LBP analog of (b)'s $70
        created_by: USER_ID,
      });

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: memberA,
        userId: USER_ID,
      });
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      // Same shape as (b), entirely in LBP: 4,500,000 - 3,150,000 - 2,250,000 (member A's own A_account) = -2,250,000.
      expect(clientNetDebtLbp(db, clientId)).toBeCloseTo(-2_250_000, 1);
    });

    it("(d) a client with a SECOND, unrelated debt: the cancellation does not depend on the client's total balance", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      sellIntoSession(sessionId, clientId, [{ name: "item", price: 100, cost: 60 }]);
      payAccount(sessionId, 100, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: USER_ID,
      });
      // An unrelated debt on the SAME client, nothing to do with this
      // session — a manual ledger entry, no session_id.
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
         VALUES (?, 'Manual Debt', 200, 0, 'Unrelated', ?)`,
      ).run(clientId, USER_ID);
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(230, 6); // 100 - 70 + 200

      // RED on the capped code: getClientBalance reads the client's TOTAL
      // balance (230), so the cap wouldn't even bind here in THIS specific
      // direction (100 < 230) — but it proves the cap depends on unrelated
      // debt at all, which this test pins against by asserting the exact
      // cancellation amount is independent of it.
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      // Cancellation was exactly $100 (the session's own gross charge),
      // regardless of the unrelated $200 debt.
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(130, 6); // 230 - 100
    });
  });

  // ── round-2 finding #4 (MEDIUM) — _cancelSessionDebt row shape ──────────
  describe("round-2 finding #4: _cancelSessionDebt writes ONE 'Refund Reversal' row per debt-row TYPE, never a single combined net", () => {
    it("a basket with both a Session Debt charge and a pooled CREDIT_DEPOSIT writes TWO reversal rows", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      sellIntoSession(sessionId, clientId, [{ name: "item", price: 30, cost: 20 }]);
      payAccount(sessionId, 30, clientId);
      // A pooled CREDIT_DEPOSIT from the same checkout (e.g. a payout kept
      // on the customer's account) — unrelated in size to the charge.
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by)
         VALUES (?, 'CREDIT_DEPOSIT', -5, 0, NULL, ?, 'Kept as account credit', ?)`,
      ).run(clientId, sessionId, USER_ID);

      txnRepo.refundSessionBasket(sessionId, USER_ID);

      const reversalRows = db
        .prepare(
          `SELECT amount_usd FROM debt_ledger WHERE session_id = ? AND transaction_type = 'Refund Reversal' ORDER BY id ASC`,
        )
        .all(sessionId) as { amount_usd: number }[];
      // Pre-fix: ONE combined row (netUsd = 30 + -5 = wait no — the two
      // rows are always netted into ONE INSERT). Post-fix: two separate
      // rows, one per original debt-row type, exactly like the staged
      // (pre-item-refund-attribution) shape.
      expect(reversalRows).toHaveLength(2);
      expect(reversalRows.map((r) => r.amount_usd).sort((a, b) => a - b)).toEqual(
        [-30, 5].sort((a, b) => a - b),
      );
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    });

    it("debt == credit (nets to exactly 0): a second whole-basket call AND a further item refund are both still refused — the marker row must survive even at amount 0", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "item", price: 30, cost: 20 },
      ]);
      payAccount(sessionId, 30, clientId);
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by)
         VALUES (?, 'CREDIT_DEPOSIT', -30, 0, NULL, ?, 'Kept as account credit', ?)`,
      ).run(clientId, sessionId, USER_ID);

      // RED on the pre-fix code: sessionDebtNet(30) + creditDepositNet(-30)
      // = 0 → the combined-row writer returns early WITHOUT writing
      // anything, so no idempotency marker exists for this basket at all.
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      expect(() => txnRepo.refundSessionBasket(sessionId, USER_ID)).toThrow(
        /already been voided\/refunded/,
      );
      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[0],
          quantity: 1,
          userId: USER_ID,
        }),
      ).toThrow(/already been voided\/refunded/);
    });
  });

  // ── round-2 finding #2 (HIGH) — SALE already-fully-refunded guard ───────
  it("round-2 finding #2 (HIGH): refuses to item-refund a SALE line whose sale was already marked fully refunded", () => {
    const sessionId = seedSession();
    const { txnId, itemIds, saleId } = sellIntoSession(sessionId, null, [
      { name: "item", price: 30, cost: 20 },
    ]);
    payCash(sessionId, 30);
    // Simulate the state the UNTOUCHED-sale branch of `refundSessionBasket`
    // leaves behind (`_refundTransactionInternal` → `_applyGenericItemReversal`
    // stamps `sales.status = 'refunded'` and blanket `sale_items.is_refunded
    // = 1`, but NEVER touches `refunded_quantity`). Hand-set directly (rather
    // than calling the real `refundSessionBasket`) so this test isolates the
    // SALE-status guard from `_assertSessionBasketReversible` — a REAL
    // whole-basket call's own reversal markers would otherwise block the
    // second call first (see the finding #4 tests above for that combined,
    // end-to-end proof).
    db.prepare(`UPDATE sales SET status = 'refunded' WHERE id = ?`).run(saleId);

    expect(() =>
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      }),
    ).toThrow(/already.*refunded/i);
  });

  // ── round-2 finding #5 (MEDIUM) — store credit must never become cash ───
  describe("round-2 finding #5: pre-existing store credit is never handed back as cash — only a REAL post-charge repayment is", () => {
    it("a client with a pre-existing $200 store credit: the item refund reduces the account, hands back NO cash", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      // Pre-existing store credit — written and committed BEFORE this
      // session's own charge exists (lower id).
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
         VALUES (?, 'Manual Credit', -200, 0, 'Pre-existing store credit', ?)`,
      ).run(clientId, USER_ID);
      const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "item", price: 50, cost: 30 },
      ]);
      payAccount(sessionId, 100, clientId);
      // Balance is now -200 + 100 = -100 (still a credit, never negative
      // enough to look "owed").
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(-100, 6);

      const result = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      // RED on the pre-fix cap (`min(A_account, max(0, balance_now))`):
      // balance_now is negative, so `max(0, balance_now) = 0` →
      // accountReductionUsd = 0, remainderUsd = 50 (the store credit gets
      // handed back as CASH). Fixed: `available = max(0, balance_now) +
      // max(0, -balanceBeforeThisCharge)` = 0 + 200 = 200 → the full $50
      // reduces the account instead.
      expect(result.accountReductionUsd).toBeCloseTo(50, 6);
      expect(result.remainderUsd).toBeCloseTo(0, 6);
    });

    it("an old, UNRELATED debt (owed before this basket): the item refund still reduces THIS basket's account charge, not cash — matches worked example 4's pattern applied on top of unrelated debt", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      // An unrelated debt, already owed BEFORE this session's own charge.
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
         VALUES (?, 'Manual Debt', 200, 0, 'Unrelated, pre-existing', ?)`,
      ).run(clientId, USER_ID);
      const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "item", price: 50, cost: 30 },
      ]);
      payAccount(sessionId, 100, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: USER_ID,
      });
      // Balance: 200 (unrelated) + 100 (this basket) - 70 (repayment) = 230.
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(230, 6);

      const result = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      // available = max(0, 230) + max(0, -200) = 230 + 0 = 230 — plenty, so
      // the full $50 item reduces THIS basket's account charge; no cash.
      expect(result.accountReductionUsd).toBeCloseTo(50, 6);
      expect(result.remainderUsd).toBeCloseTo(0, 6);
    });
  });

  // ── unitExtras on the session SALE branch (coordinator follow-up) ───────
  it("returning a phone through refundSessionBasketItem with is_defective flips the unit to IN_STOCK + defective (not proven failing-first — the underlying plumbing already existed)", () => {
    const sessionId = seedSession();
    const productId = insertProduct(db, "iPhone", 800);
    const unitId = insertUnit(db, productId, "UNITEXTRAS0000001");

    const totalAmount = 1000;
    const result = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: totalAmount, product_unit_id: unitId }],
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
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as { id: number }
    ).id;
    payCash(sessionId, totalAmount);
    expect(getUnit(db, unitId).status).toBe("SOLD");

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnRow.id,
      saleItemId: itemId,
      quantity: 1,
      userId: USER_ID,
      unitExtras: [{ unit_id: unitId, is_defective: true }],
    });

    const unit = getUnit(db, unitId);
    expect(unit.status).toBe("IN_STOCK");
    expect(unit.is_defective).toBe(1);
  });

  // ── round-2 finding #11 — getSaleRefundPreview carries sessionId/sessionTransactionId ──
  it("round-2 finding #11: getSaleRefundPreview's sessionTransactionId still resolves to the SALE's own unified id after an item refund (never the REFUND row)", () => {
    const clientId = seedClient();
    const sessionId = seedSession();
    const { saleId, txnId, itemIds } = sellIntoSession(sessionId, clientId, [
      { name: "item-a", price: 30, cost: 20 },
      { name: "item-b", price: 30, cost: 20 },
    ]);
    payCash(sessionId, 60);

    // Before any refund.
    const before = salesRepo.getSaleRefundPreview(saleId) as {
      legs: unknown[];
      sessionLinked: boolean;
      sessionId?: number;
      sessionTransactionId?: number;
    };
    expect(before.sessionLinked).toBe(true);
    expect(before.sessionTransactionId).toBe(txnId);
    expect(before.sessionId).toBe(sessionId);

    // RED on the pre-fix type: `sessionId`/`sessionTransactionId` don't
    // exist on the result at all. After the fix, and after refunding ONE
    // line (which writes a NEW active REFUND row for the same sale),
    // `sessionTransactionId` must still resolve to the SALE's own row —
    // `getActiveSaleTransactionId` already filters `type = 'SALE'`, so this
    // also regression-proves that filter stays correct.
    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });
    const after = salesRepo.getSaleRefundPreview(saleId) as {
      sessionId?: number;
      sessionTransactionId?: number;
    };
    expect(after.sessionTransactionId).toBe(txnId);
    expect(after.sessionId).toBe(sessionId);
  });

  // ─── Round-3 adversarial review (SESSION_ITEM_REFUND_PLAN.md §9b) ───────

  describe("round-3 finding #1 (BLOCKER): SalesService.getRefundPreview's ITEM branch carries sessionId/sessionTransactionId", () => {
    it("a session-paid SALE line's preview, via SalesService.getRefundPreview, resolves the session ids — the exact path POS 'Refund item' calls", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      const { saleId, txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "item-a", price: 30, cost: 20 },
        { name: "item-b", price: 30, cost: 20 },
      ]);
      payCash(sessionId, 60);
      const salesService = new SalesService(salesRepo);

      const preview = salesService.getRefundPreview(saleId, {
        saleItemId: itemIds[0],
        refundQuantity: 1,
      });

      expect(preview.success).toBe(true);
      expect(preview.sessionLinked).toBe(true);
      expect(preview.sessionId).toBe(sessionId);
      expect(preview.sessionTransactionId).toBe(txnId);

      // Still the SALE's own id after a prior item refund on the SAME sale
      // (never the REFUND row `refundSessionBasketItem` just wrote).
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      const after = salesService.getRefundPreview(saleId, {
        saleItemId: itemIds[1],
        refundQuantity: 1,
      });
      expect(after.sessionTransactionId).toBe(txnId);
      expect(after.sessionId).toBe(sessionId);
    });
  });

  describe("round-3 finding #2 (HIGH): a basket containing a netted payout refuses an item refund on any OTHER member", () => {
    it("refuses refunding a SALE item when the basket also has a LOTO_CASH_PRIZE payout member netted against it", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      // A $60-equivalent prize netted against the $100 item — only $40 ever
      // hit the pool.
      payoutIntoSession(sessionId, 60 * RATE);
      payCash(sessionId, 40);

      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[0],
          quantity: 1,
          userId: USER_ID,
        }),
      ).toThrow(/payout/i);

      // Nothing written — the guard runs before any write.
      const refundCount = db
        .prepare(`SELECT COUNT(*) AS c FROM transactions WHERE type = 'REFUND'`)
        .get() as { c: number };
      expect(refundCount.c).toBe(0);
    });

    it("the SAME refusal from the read-only preview (getSessionItemRefundPreview), before any write is attempted", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      payoutIntoSession(sessionId, 60 * RATE);
      payCash(sessionId, 40);

      expect(() =>
        txnRepo.getSessionItemRefundPreview({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[0],
          quantity: 1,
        }),
      ).toThrow(/payout/i);
    });

    it("a KEPT_CHANGE member does NOT block an item refund — it nets to 0 and is not a payout", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      // KEPT_CHANGE is always posted with amount_usd = amount_lbp = 0 (a
      // profit-only row) — the SAME sign convention SessionCheckoutService
      // writes in production.
      const kcTxnId = Number(
        db
          .prepare(
            `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary, tenant_id)
             VALUES ('KEPT_CHANGE', 'customer_sessions', ?, ?, 0, 0, 2, 0, NULL, 'Kept change (session checkout): $2', 1)`,
          )
          .run(sessionId, USER_ID).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
         VALUES (?, 'kept_change', ?, ?, 0, 0)`,
      ).run(sessionId, sessionId, kcTxnId);
      payCash(sessionId, 100);

      const result = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      expect(result.itemAmountUsd).toBeCloseTo(100, 6);
    });

    it("coordinator follow-up: a basket with ONE PRIOR item refund still allows a SECOND item refund — the refund's own REFUND row must not look like a payout", () => {
      // The exact shape the frontend's ad-hoc `amount_usd < 0 || amount_lbp
      // < 0` scan (over every session-group row, including the REFUND row
      // itself) got wrong: `refundSessionBasketItem` always posts its OWN
      // REFUND row with a NEGATIVE amount (it reverses part of the basket).
      // `isSessionPayoutMember` must exclude it via `type === 'REFUND'`
      // (defense-in-depth alongside the SQL `session_item_refund` link
      // filter), so refunding item B after item A never gets refused.
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "A", price: 30, cost: 20 },
        { name: "B", price: 30, cost: 20 },
      ]);
      payCash(sessionId, 60);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      // The just-written REFUND row (amount -30) is now a session member
      // via the 'session_item_refund' link — it must NOT be read as a
      // payout that blocks refunding item B.
      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[1],
          quantity: 1,
          userId: USER_ID,
        }),
      ).not.toThrow();
    });
  });

  describe("F4/F6 (round-3 review): 'netted payout member' is decided by PCD-eligibility, not just sign", () => {
    /** Hand-builds a session-linked FINANCIAL_SERVICE payout member (a
     *  RECEIVE cash-out), mirroring the real checkout's unified-row + cst
     *  shape: the unified `transactions` row carries 0/0 (matches
     *  production for a netted USDT/Binance leg — see F4's own fix in
     *  SessionCheckoutService.ts), the pooled `customer_session_transactions`
     *  row carries the negative customer-side amount. */
    function financialServicePayoutIntoSession(
      sessionId: number,
      provider: string,
      amountUsd: number,
    ): number {
      const tenantId = 1;
      const fsId = Number(
        db
          .prepare(`INSERT INTO financial_services (provider, tenant_id) VALUES (?, ?)`)
          .run(provider, tenantId).lastInsertRowid,
      );
      const txnId = Number(
        db
          .prepare(
            `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary, tenant_id)
             VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, ?, 0, 0, 0, 0, NULL, 'Cash-out (session)', ?)`,
          )
          .run(fsId, USER_ID, tenantId).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
         VALUES (?, 'financial_service', ?, ?, ?, 0)`,
      ).run(sessionId, fsId, txnId, -amountUsd);
      return txnId;
    }

    // F4 — a netted Binance/USDT cash-out (provider 'BINANCE', never PCD-
    // eligible — no shop_base_system concept applies to it at all) blocks
    // an item refund on a DIFFERENT (sold) member, matching decision 10's
    // own list ("a loto prize, a wallet or Binance cash-out").
    it("F4: a netted Binance (USDT) cash-out blocks refunding a DIFFERENT item, same as a loto prize", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      financialServicePayoutIntoSession(sessionId, "BINANCE", 30);
      payCash(sessionId, 70);

      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[0],
          quantity: 1,
          userId: USER_ID,
        }),
      ).toThrow(/payout/i);
    });

    // F6 — a NON-netted OMT SYSTEM RECEIVE (provider 'OMT', matching this
    // fixture's shop_base_system 'OMT' — PCD-eligible, always posts its own
    // full pooled leg) must NOT block an item refund on a different member.
    it("F6: a NON-netted OMT SYSTEM RECEIVE (provider matches shop_base_system) does NOT block refunding a different item", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      financialServicePayoutIntoSession(sessionId, "OMT", 30);
      payCash(sessionId, 100);

      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[0],
          quantity: 1,
          userId: USER_ID,
        }),
      ).not.toThrow();
    });

    // F4/F6 companion — an OMT_APP (wallet) cash-out is NEVER PCD-eligible
    // (its provider string can never equal shop_base_system 'OMT'/'WHISH'),
    // so it stays netted/refused even though its provider name starts with
    // "OMT".
    it("F4: an OMT_APP (wallet) cash-out is netted — still refused, unlike the OMT SYSTEM variant", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      financialServicePayoutIntoSession(sessionId, "OMT_APP", 30);
      payCash(sessionId, 70);

      expect(() =>
        txnRepo.refundSessionBasketItem({
          sessionId,
          transactionId: txnId,
          saleItemId: itemIds[0],
          quantity: 1,
          userId: USER_ID,
        }),
      ).toThrow(/payout/i);
    });

    // getRecent's is_session_payout must agree with the write-path guard —
    // ONE shared predicate (rule 14), asserted directly here.
    it("getRecent().is_session_payout agrees with the guard: true for the netted Binance member, false for the non-netted OMT SYSTEM member", () => {
      const sessionId = seedSession();
      const binanceTxnId = financialServicePayoutIntoSession(sessionId, "BINANCE", 30);
      const sessionId2 = seedSession();
      const omtTxnId = financialServicePayoutIntoSession(sessionId2, "OMT", 30);

      const rows = txnRepo.getRecent(200) as unknown as Array<{
        id: number;
        is_session_payout?: boolean;
      }>;
      const binanceRow = rows.find((r) => r.id === binanceTxnId);
      const omtRow = rows.find((r) => r.id === omtTxnId);
      expect(binanceRow?.is_session_payout).toBe(true);
      expect(omtRow?.is_session_payout).toBe(false);
    });
  });

  // F5 (round-3 review, MEDIUM) — `isSessionBasketFullyRefunded` summed only
  // POSITIVE pooled legs (the gross IN total), ignoring a pooled CHANGE (OUT)
  // leg entirely. A basket tendered above its items' value and given real
  // change back at checkout then never reads as fully refunded once every
  // item has been individually refunded — "Refund basket" stays clickable
  // and, run anyway, no-ops by writing a phantom ±$5 "Basket reversal" pair
  // (nothing left to actually reverse).
  describe("F5: isSessionBasketFullyRefunded uses the NET pool (IN minus change), not the gross IN total", () => {
    it("$105 tendered with $5 change, both items ($100 total) refunded individually: the basket reads as fully refunded", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "A", price: 60, cost: 40 },
        { name: "B", price: 40, cost: 25 },
      ]);
      payCashWithChange(sessionId, 105, 5);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[1],
        quantity: 1,
        userId: USER_ID,
      });

      expect(txnRepo.isSessionBasketFullyRefunded(sessionId)).toBe(true);

      // "Refund basket" must now REFUSE outright (coordinator item 5) —
      // never a silent no-op writing a phantom ±$5 reversal pair.
      const paymentsCountBefore = (
        db.prepare(`SELECT COUNT(*) AS c FROM payments`).get() as { c: number }
      ).c;
      expect(() => txnRepo.refundSessionBasket(sessionId, USER_ID)).toThrow(
        /already been refunded item by item/,
      );
      const paymentsCountAfter = (
        db.prepare(`SELECT COUNT(*) AS c FROM payments`).get() as { c: number }
      ).c;
      expect(paymentsCountAfter).toBe(paymentsCountBefore);
    });
  });

  describe("round-3 finding #3 (MEDIUM): the pool cap is cumulative across item refunds, never re-applied against the GROSS pool", () => {
    it("custom service ($10 + 450,000 LBP) + $5 sale, refunded from a $20 USD-only pool: total handed back never exceeds the pool", () => {
      const sessionId = seedSession();
      const customServiceTxnId = customServiceIntoSession(sessionId, null, 10, 450000);
      const { txnId: saleTxnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "gadget", price: 5, cost: 2 },
      ]);
      payCash(sessionId, 20);
      const generalAfterPay = balance(db, "General", "USD");

      const firstResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: customServiceTxnId,
        userId: USER_ID,
      });
      // RED on the pre-fix code: the custom service's own pool share alone
      // ($15.0562) is already MORE than $15 — measuring it here pins the
      // exact pre-fix number the plan names.
      const firstHandedBack = firstResult.remainderUsd;

      const secondResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: saleTxnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      const secondHandedBack = secondResult.remainderUsd;

      // The BUG (pre-fix): each call caps against the GROSS $20 pool
      // independently, so firstHandedBack (~15.056) + secondHandedBack (5)
      // = ~20.056 — MORE than the pool ever held.
      expect(firstHandedBack + secondHandedBack).toBeLessThanOrEqual(20.0001);

      // And the drawer proves it structurally, not just the return values:
      // General can never have paid out more than it took in.
      const generalAfterBoth = balance(db, "General", "USD");
      expect(generalAfterPay - generalAfterBoth).toBeCloseTo(20, 2);
    });
  });

  describe("round-3 finding #4 (MEDIUM): pre-existing store credit is attributed ONCE across a basket's item refunds, never re-counted per call", () => {
    it("$60 pre-existing credit, A $50 + B $50 on account, $40 repaid: refund A then B nets to the SAME totals as a single $100 refund", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
         VALUES (?, 'Manual Credit', -60, 0, 'Pre-existing store credit', ?)`,
      ).run(clientId, USER_ID);
      const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "A", price: 50, cost: 30 },
        { name: "B", price: 50, cost: 30 },
      ]);
      payAccount(sessionId, 100, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: 40,
        amount_lbp: 0,
        created_by: USER_ID,
      });
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6); // -60+100-40

      const resultA = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      const resultB = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[1],
        quantity: 1,
        userId: USER_ID,
      });

      const totalAccountReduction =
        resultA.accountReductionUsd + resultB.accountReductionUsd;
      const totalCash = resultA.remainderUsd + resultB.remainderUsd;

      // The plan's own worked example: $40 cash total, $60 total account
      // reduction, ending balance -60 (the $60 credit restored, nothing
      // more, nothing less) — matching what a SINGLE $100 refund already
      // gives (SESSION_ITEM_REFUND_PLAN.md §3's worked example 4 pattern).
      expect(totalAccountReduction).toBeCloseTo(60, 6);
      expect(totalCash).toBeCloseTo(40, 6);
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(-60, 6);
    });

    it("split-vs-single parity: a second basket ($60 credit, $90 on account across two items, $30 repaid) refunded as ONE item gives the SAME totals as split A-then-B", () => {
      // Single-refund control basket.
      const clientSingle = seedClient("single");
      const sessionSingle = seedSession();
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
         VALUES (?, 'Manual Credit', -60, 0, 'Voucher', ?)`,
      ).run(clientSingle, USER_ID);
      const single = sellIntoSession(sessionSingle, clientSingle, [
        { name: "solo", price: 90, cost: 50 },
      ]);
      payAccount(sessionSingle, 90, clientSingle);
      const debtRepo = new DebtRepository();
      debtRepo.addRepayment({
        client_id: clientSingle,
        amount_usd: 30,
        amount_lbp: 0,
        created_by: USER_ID,
      });
      const singleResult = txnRepo.refundSessionBasketItem({
        sessionId: sessionSingle,
        transactionId: single.txnId,
        saleItemId: single.itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      // Split basket, same totals, same voucher-funded credit.
      const clientSplit = seedClient("split");
      const sessionSplit = seedSession();
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
         VALUES (?, 'Manual Credit', -60, 0, 'Voucher', ?)`,
      ).run(clientSplit, USER_ID);
      const split = sellIntoSession(sessionSplit, clientSplit, [
        { name: "A", price: 45, cost: 25 },
        { name: "B", price: 45, cost: 25 },
      ]);
      payAccount(sessionSplit, 90, clientSplit);
      debtRepo.addRepayment({
        client_id: clientSplit,
        amount_usd: 30,
        amount_lbp: 0,
        created_by: USER_ID,
      });
      const splitA = txnRepo.refundSessionBasketItem({
        sessionId: sessionSplit,
        transactionId: split.txnId,
        saleItemId: split.itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      const splitB = txnRepo.refundSessionBasketItem({
        sessionId: sessionSplit,
        transactionId: split.txnId,
        saleItemId: split.itemIds[1],
        quantity: 1,
        userId: USER_ID,
      });

      expect(splitA.accountReductionUsd + splitB.accountReductionUsd).toBeCloseTo(
        singleResult.accountReductionUsd,
        6,
      );
      expect(splitA.remainderUsd + splitB.remainderUsd).toBeCloseTo(
        singleResult.remainderUsd,
        6,
      );
    });
  });

  describe("round-3 finding #5 (LOW): _cancelSessionDebt writes ONE 'Refund Reversal' row PER debt row, never per TYPE", () => {
    it("1 Session Debt + 2 CREDIT_DEPOSIT rows → 3 reversal rows (not 2), each with its own row's client_id", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      sellIntoSession(sessionId, clientId, [{ name: "item", price: 50, cost: 30 }]);
      payAccount(sessionId, 50, clientId);
      const debtRepo = new DebtRepository();
      debtRepo.addCredit({
        clientId,
        amountUsd: 10,
        amountLbp: 0,
        note: "Payout to account",
        createdBy: String(USER_ID),
        sessionId,
      });
      debtRepo.addCredit({
        clientId,
        amountUsd: 5,
        amountLbp: 0,
        note: "Payout to account",
        createdBy: String(USER_ID),
        sessionId,
      });
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(35, 6); // 50-10-5

      const beforeRows = db
        .prepare(`SELECT COUNT(*) AS c FROM debt_ledger WHERE transaction_type = 'Refund Reversal'`)
        .get() as { c: number };

      txnRepo.refundSessionBasket(sessionId, USER_ID);

      const afterRows = db
        .prepare(`SELECT COUNT(*) AS c FROM debt_ledger WHERE transaction_type = 'Refund Reversal'`)
        .get() as { c: number };
      // RED on the pre-fix per-TYPE aggregation: writes 2 rows (one combined
      // 'Session Debt' net, one combined 'CREDIT_DEPOSIT' net) instead of 3.
      expect(afterRows.c - beforeRows.c).toBe(3);
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    });

    it("a second refundSessionBasket call on the same (fully reversed) basket is still refused — the per-row rewrite keeps the idempotency marker", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      sellIntoSession(sessionId, clientId, [{ name: "item", price: 50, cost: 30 }]);
      payAccount(sessionId, 50, clientId);
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      expect(() => txnRepo.refundSessionBasket(sessionId, USER_ID)).toThrow(
        /already been voided\/refunded/,
      );
    });
  });

  describe("round-3 finding #6 (LOW): every proportional LBP/USD split in the whole-basket pooled reversal sums EXACTLY to its total", () => {
    it("3 equal 300,000 LBP pooled legs, 890,000 already returned by a prior item refund: every drawer balance stays a whole LBP and the combined total nets to exactly 0", () => {
      const sessionId = seedSession();
      const customServiceTxnId = customServiceIntoSession(sessionId, null, 0, 890000);
      // 3 different drawer-affecting LBP legs of equal weight — the exact
      // shape that makes an independent Math.round per leg overshoot by 1
      // LBP (296,667 x 3 = 890,001 instead of 890,000).
      const totalBaseline =
        drawerBalance("General", "LBP") +
        drawerBalance("Whish_App", "LBP") +
        drawerBalance("OMT_App", "LBP");
      sessionPaymentService.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "LBP", amount: 300000 },
          { method: "WHISH", currencyCode: "LBP", amount: 300000 },
          { method: "OMT", currencyCode: "LBP", amount: 300000 },
        ],
        exchangeRate: RATE,
        userId: USER_ID,
      });

      // Item refund hands back ~890,000 (capped at the item's own value),
      // proportionally split across the 3 pooled legs.
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: customServiceTxnId,
        userId: USER_ID,
      });
      // Whole-basket reversal returns whatever's left of the pool, MINUS
      // what the item refund already handed back — this is the split that
      // must sum exactly, per finding #6.
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      const generalLbp = drawerBalance("General", "LBP");
      const whishLbp = drawerBalance("Whish_App", "LBP");
      const omtLbp = drawerBalance("OMT_App", "LBP");
      expect(Number.isInteger(generalLbp)).toBe(true);
      expect(Number.isInteger(whishLbp)).toBe(true);
      expect(Number.isInteger(omtLbp)).toBe(true);

      const totalAfter = generalLbp + whishLbp + omtLbp;
      // RED on the pre-fix independent-rounding split: the combined total
      // ends up off by whole LBP units (the finding's measured "sum 890,001
      // vs remainder 890,000" / "-0.333 per drawer" symptoms), not exactly
      // back at the pre-payment baseline.
      expect(totalAfter).toBe(totalBaseline);
    });
  });

  describe("LIRA-236 integration-gap round-4 L2 (coordinator, 2026-09-27): a sub-cent pooled leg with NO prior item refunds reverses EXACTLY, never rounded", () => {
    it("a $33.335 pooled USD leg with no item refunds nets the drawer to EXACTLY its pre-payment balance, not -0.005 off", () => {
      const sessionId = seedSession();
      sellIntoSession(sessionId, null, [
        { name: "item", price: 33.335, cost: 20 },
      ]);
      const baseline = drawerBalance("General", "USD");
      // `payCash` (this file's own helper) posts the leg via the REAL
      // `SessionPaymentService.recordBasketPayment`, unrounded — the exact
      // "a $33.335 pooled leg" shape the finding names, e.g. from a
      // currency-converted split.
      payCash(sessionId, 33.335);
      expect(drawerBalance("General", "USD")).toBeCloseTo(baseline + 33.335, 6);

      // NO item refund happened first — reduceBy is 0 for this leg. The
      // pre-fix `-this._roundToUnit(p.amount - reduceBy, unit)` still rounds
      // 33.335 to 33.34 even when reduceBy is 0, reversing 0.005 MORE than
      // was ever paid in and leaving the drawer negative by that amount.
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      const reversalRow = db
        .prepare(
          `SELECT amount FROM payments WHERE session_id = ? AND transaction_id IS NULL AND note = 'Basket reversal'`,
        )
        .get(sessionId) as { amount: number } | undefined;
      expect(reversalRow?.amount).toBe(-33.335);

      const after = drawerBalance("General", "USD");
      // RED on the pre-fix code: `after` lands at `baseline - 0.005`
      // (reversal wrote -33.34 against a +33.335 payment), not `baseline`.
      expect(Math.abs(after - baseline)).toBeLessThan(0.0005);
    });
  });

  describe("coordinator follow-up (2026-09-27), item 5 — 'Refund basket'/'Void basket' refuse a fully item-refunded basket", () => {
    it("cash basket of 2 items, both refunded individually: refundSessionBasket refuses, voidSessionBasket refuses, and nothing is written", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "item A", price: 30, cost: 20 },
        { name: "item B", price: 20, cost: 10 },
      ]);
      payCash(sessionId, 50);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[1],
        quantity: 1,
        userId: USER_ID,
      });

      const paymentsCountBefore = (
        db.prepare(`SELECT COUNT(*) AS c FROM payments`).get() as { c: number }
      ).c;

      expect(() => txnRepo.refundSessionBasket(sessionId, USER_ID)).toThrow(
        /already been refunded item by item/i,
      );
      expect(() => txnRepo.voidSessionBasket(sessionId, USER_ID)).toThrow(
        /already been refunded item by item/i,
      );

      // Nothing written by either refusal — no new payments row (no "Basket
      // reversal" leg), and no member flipped to VOIDED.
      const paymentsCountAfter = (
        db.prepare(`SELECT COUNT(*) AS c FROM payments`).get() as { c: number }
      ).c;
      expect(paymentsCountAfter).toBe(paymentsCountBefore);
      const memberStatus = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(memberStatus.status).toBe("ACTIVE");
    });

    it("one item refunded, one left: refundSessionBasket is still allowed and reverses only what's left", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "item A", price: 30, cost: 20 },
        { name: "item B", price: 20, cost: 10 },
      ]);
      payCash(sessionId, 50);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      expect(() =>
        txnRepo.refundSessionBasket(sessionId, USER_ID),
      ).not.toThrow();

      // Item B's line is now reversed too (via the whole-basket call's
      // remaining-lines path), and the drawer nets back to its pre-payment
      // baseline (item A's $30 + item B's $20 = the full $50 paid in).
      const lineB = db
        .prepare(`SELECT refunded_quantity, quantity FROM sale_items WHERE id = ?`)
        .get(itemIds[1]) as { refunded_quantity: number; quantity: number };
      expect(lineB.refunded_quantity).toBe(lineB.quantity);
    });

    it("a KEPT_CHANGE member plus all sale lines item-refunded: refundSessionBasket is still allowed (the basket is NOT fully refunded — KEPT_CHANGE is still active)", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "phone", price: 100, cost: 60 },
      ]);
      // Same KEPT_CHANGE fixture shape as round-3 finding #2's own test
      // above — a $2 kept-change row, profit-only (amount 0/0).
      const kcTxnId = Number(
        db
          .prepare(
            `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary, tenant_id)
             VALUES ('KEPT_CHANGE', 'customer_sessions', ?, ?, 0, 0, 2, 0, NULL, 'Kept change (session checkout): $2', 1)`,
          )
          .run(sessionId, USER_ID).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
         VALUES (?, 'kept_change', ?, ?, 0, 0)`,
      ).run(sessionId, sessionId, kcTxnId);
      payCash(sessionId, 100);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      // The basket is NOT "fully refunded" — the KEPT_CHANGE member is only
      // ever reversed by the whole-basket call itself, so it's still ACTIVE.
      expect(txnRepo.isSessionBasketFullyRefunded(sessionId)).toBe(false);
      expect(() =>
        txnRepo.refundSessionBasket(sessionId, USER_ID),
      ).not.toThrow();

      const kcRow = db
        .prepare(`SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND'`)
        .get(kcTxnId) as { id: number } | undefined;
      expect(kcRow).toBeTruthy();
    });

    it("getRecent returns session_fully_refunded: true ONLY once every member is reversed", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "item A", price: 30, cost: 20 },
        { name: "item B", price: 20, cost: 10 },
      ]);
      payCash(sessionId, 50);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      const rowsPartial = txnRepo.getRecent(50) as Array<{
        id: number;
        session_id: number | null;
        session_fully_refunded?: boolean;
      }>;
      const saleRowPartial = rowsPartial.find((r) => r.id === txnId)!;
      expect(saleRowPartial.session_fully_refunded).toBe(false);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[1],
        quantity: 1,
        userId: USER_ID,
      });

      const rowsFull = txnRepo.getRecent(50) as Array<{
        id: number;
        session_id: number | null;
        session_fully_refunded?: boolean;
      }>;
      const saleRowFull = rowsFull.find((r) => r.id === txnId)!;
      expect(saleRowFull.session_fully_refunded).toBe(true);
      // A non-session row elsewhere in the same page always reads false.
      const nonSessionRows = rowsFull.filter((r) => r.session_id == null);
      expect(
        nonSessionRows.every((r) => r.session_fully_refunded === false),
      ).toBe(true);
    });
  });

  describe("round-3 finding #7 (LOW): zero-amount rows never get written or shown", () => {
    // Rule 24 — this test's ORIGINAL premise (pre-coordinator-item-5) was
    // that a whole-basket refund on a fully item-refunded cash basket
    // SUCCEEDS as a silent no-op (asserting it writes no 0-amount payments
    // row). That architecture is exactly the bug item 5 closes: this is the
    // canonical "cash basket, every item refunded individually" case the
    // coordinator described, so `refundSessionBasket` must now REFUSE it
    // instead — rewritten into a guard that the OLD (silent-success) path is
    // no longer taken, rather than deleted. The original "no 0-amount row"
    // guarantee still holds trivially now (nothing is written at all on a
    // refusal), so nothing about round-3 finding #7's own fix regressed.
    it("a fully item-refunded cash basket: refundSessionBasket now REFUSES (coordinator item 5) instead of silently no-op'ing — and still writes no 0-amount 'Basket reversal' payments row", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "item", price: 50, cost: 30 },
      ]);
      payCash(sessionId, 50);

      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      expect(() => txnRepo.refundSessionBasket(sessionId, USER_ID)).toThrow(
        /already been refunded item by item/i,
      );

      const zeroLegs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM payments WHERE session_id = ? AND transaction_id IS NULL AND amount = 0`,
        )
        .get(sessionId) as { c: number };
      expect(zeroLegs.c).toBe(0);
    });

    it("a 0/0 'Refund Reversal' marker row is hidden from DebtRepository.findClientHistory but stays in the raw debt_ledger table", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      sellIntoSession(sessionId, clientId, [{ name: "item", price: 50, cost: 30 }]);
      payAccount(sessionId, 50, clientId);
      // Fully attribute the charge to an item refund first, so the
      // whole-basket reversal's own Session Debt cancellation nets to 0 —
      // the exact "still write the marker row even at 0" case finding #5
      // requires and finding #7 says must not LEAK into the history view.
      const itemId = (
        db.prepare(`SELECT id FROM sale_items`).all() as { id: number }[]
      )[0].id;
      const saleTxnRow = db
        .prepare(`SELECT id FROM transactions WHERE type = 'SALE'`)
        .get() as { id: number };
      txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: saleTxnRow.id,
        saleItemId: itemId,
        quantity: 1,
        userId: USER_ID,
      });
      txnRepo.refundSessionBasket(sessionId, USER_ID);

      const rawZeroRow = db
        .prepare(
          `SELECT COUNT(*) AS c FROM debt_ledger WHERE session_id = ? AND transaction_type = 'Refund Reversal' AND amount_usd = 0 AND amount_lbp = 0`,
        )
        .get(sessionId) as { c: number };
      expect(rawZeroRow.c).toBe(1); // the marker itself stays in the table

      const debtRepo = new DebtRepository();
      const history = debtRepo.findClientHistory(clientId);
      const visibleZeroRows = history.filter(
        (h) =>
          h.transaction_type === "Refund Reversal" &&
          h.amount_usd === 0 &&
          h.amount_lbp === 0,
      );
      expect(visibleZeroRows).toHaveLength(0); // hidden from the reader
    });
  });

  // LIRA-253 — admin "Undo refund" for a session-basket item refund
  // (`refundSessionBasketItem`'s own REFUND row, `metadata_json.refundType
  // === "sessionItem"`). Rule 17: this is brand-new capability — proven
  // failing-first by calling `txnRepo.undoSessionBasketItemRefund` BEFORE it
  // existed on this branch (TypeError: not a function), recorded in the task
  // report; the guard-throw cases below are a real red→green pair within
  // this file (first perform the disallowed action, assert the throw).
  describe("undoSessionBasketItemRefund (LIRA-253)", () => {
    it("nets stock/debt/drawer/profit back to the post-sale state — CUSTOMER_ACCOUNT basket, account-first reduction", () => {
      const clientId = seedClient();
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, clientId, [
        { name: "item", price: 100, cost: 60 },
      ]);
      payAccount(sessionId, 100, clientId);

      const debtBeforeRefund = clientNetDebtUsd(db, clientId);
      expect(debtBeforeRefund).toBeCloseTo(100, 5);

      const refundResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });

      // Item refunded: account reduced by 100, nothing in cash (all pooled
      // money was CUSTOMER_ACCOUNT), stock restored (+1 vs. post-sale).
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(0, 5);
      const stockQty = () =>
        (
          db
            .prepare(
              `SELECT p.stock_quantity FROM products p JOIN sale_items si ON si.product_id = p.id WHERE si.id = ?`,
            )
            .get(itemIds[0]) as { stock_quantity: number }
        ).stock_quantity;
      const stockAfterRefund = stockQty();

      const profitBeforeUndo = (
        db.prepare(`SELECT COALESCE(SUM(profit_usd),0) AS p FROM transactions`).get() as {
          p: number;
        }
      ).p;

      const undoTxnId = txnRepo.undoSessionBasketItemRefund({
        refundTransactionId: refundResult.refundTransactionId,
        userId: USER_ID,
      });
      expect(undoTxnId).toBeGreaterThan(0);

      // Nets back to the post-sale state: debt re-charged to 100, stock
      // consumed again (back down by 1 from the post-refund figure), profit
      // restored.
      expect(clientNetDebtUsd(db, clientId)).toBeCloseTo(100, 5);
      expect(stockQty()).toBe(stockAfterRefund - 1);
      const refundedQty = (
        db.prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`).get(itemIds[0]) as {
          refunded_quantity: number;
        }
      ).refunded_quantity;
      expect(refundedQty).toBe(0);

      const profitAfterUndo = (
        db.prepare(`SELECT COALESCE(SUM(profit_usd),0) AS p FROM transactions`).get() as {
          p: number;
        }
      ).p;
      // The refund negated 40 profit (100-60); the undo restores it exactly.
      expect(profitAfterUndo - profitBeforeUndo).toBeCloseTo(40, 5);
    });

    it("nets drawer back to its pre-refund balance — CASH basket, pool-split money-back leg", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "item", price: 50, cost: 30 },
      ]);
      payCash(sessionId, 50);

      const drawerBeforeRefund = balance(db, "General", "USD");

      const refundResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      expect(balance(db, "General", "USD")).toBeCloseTo(drawerBeforeRefund - 50, 5);

      txnRepo.undoSessionBasketItemRefund({
        refundTransactionId: refundResult.refundTransactionId,
        userId: USER_ID,
      });
      expect(balance(db, "General", "USD")).toBeCloseTo(drawerBeforeRefund, 5);
    });

    it("refuses a double-undo", () => {
      const sessionId = seedSession();
      const { txnId, itemIds } = sellIntoSession(sessionId, null, [
        { name: "item", price: 50, cost: 30 },
      ]);
      payCash(sessionId, 50);
      const refundResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: txnId,
        saleItemId: itemIds[0],
        quantity: 1,
        userId: USER_ID,
      });
      txnRepo.undoSessionBasketItemRefund({
        refundTransactionId: refundResult.refundTransactionId,
        userId: USER_ID,
      });
      expect(() =>
        txnRepo.undoSessionBasketItemRefund({
          refundTransactionId: refundResult.refundTransactionId,
          userId: USER_ID,
        }),
      ).toThrow(/already been undone/i);
    });

    it("refuses to undo when the refunded unit has already been sold again under a different sale", () => {
      const sessionId = seedSession();
      const productId = insertProduct(db, "phone", 200);
      const unitId = insertUnit(db, productId, "IMEI-253-1");
      const result = salesRepo.processSale(
        {
          client_id: null,
          items: [{ product_id: productId, quantity: 1, price: 300, product_unit_id: unitId }],
          total_amount: 300,
          discount: 0,
          final_amount: 300,
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
      const saleTxnRow = db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
        )
        .get(saleId) as { id: number };
      db.prepare(
        `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
         VALUES (?, 'sale', ?, ?, ?, 0)`,
      ).run(sessionId, saleId, saleTxnRow.id, 300);
      const itemId = (
        db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as { id: number }
      ).id;
      payCash(sessionId, 300);

      const refundResult = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: saleTxnRow.id,
        saleItemId: itemId,
        quantity: 1,
        userId: USER_ID,
      });

      // Unit is back IN_STOCK — sell it again under a brand-new sale.
      salesRepo.processSale(
        {
          client_id: null,
          items: [{ product_id: productId, quantity: 1, price: 300, product_unit_id: unitId }],
          total_amount: 300,
          discount: 0,
          final_amount: 300,
          payment_usd: 300,
          payment_lbp: 0,
          exchange_rate: RATE,
          status: "completed",
        },
        USER_ID,
      );

      expect(() =>
        txnRepo.undoSessionBasketItemRefund({
          refundTransactionId: refundResult.refundTransactionId,
          userId: USER_ID,
        }),
      ).toThrow(/already been sold again/i);
    });
  });
});

describe("TransactionRepository.getSessionItemRefundPreview (LIRA-232 phase 1)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let sessionPaymentService: SessionPaymentService;
  const USER_ID = 1;
  const RATE = 90000;

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
    resetSessionPaymentService();
  });

  it("previews the account reduction and default legs WITHOUT writing anything", () => {
    const sessionId = Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
    const productId = insertProduct(db, "charger", 8);
    const result = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 15 }],
        total_amount: 15,
        discount: 0,
        final_amount: 15,
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
      .prepare(`SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`)
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, 15, 0)`,
    ).run(sessionId, saleId, txnRow.id);
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as { id: number }
    ).id;
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
      exchangeRate: RATE,
      userId: USER_ID,
    });

    const before = db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number };
    const preview = txnRepo.getSessionItemRefundPreview({
      sessionId,
      transactionId: txnRow.id,
      saleItemId: itemId,
      quantity: 1,
    });
    const after = db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number };

    expect(preview.itemAmountUsd).toBeCloseTo(15, 6);
    expect(preview.remainderUsd).toBeCloseTo(15, 6);
    expect(preview.defaultLegs).toHaveLength(1);
    expect(preview.defaultLegs[0].method).toBe("CASH");
    expect(after.c).toBe(before.c); // no row written
  });

  it("round-2 finding #10 (LOW): accountClientName names the client the Session Debt was charged to, present only when there's an account reduction", () => {
    const clientId = Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES ('Charged Client')`).run()
        .lastInsertRowid,
    );
    const sessionId = Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
    const productId = insertProduct(db, "item", 8);
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: [{ product_id: productId, quantity: 1, price: 15 }],
        total_amount: 15,
        discount: 0,
        final_amount: 15,
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
      .prepare(`SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`)
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, 15, 0)`,
    ).run(sessionId, saleId, txnRow.id);
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as { id: number }
    ).id;
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 15 }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });

    const preview = txnRepo.getSessionItemRefundPreview({
      sessionId,
      transactionId: txnRow.id,
      saleItemId: itemId,
      quantity: 1,
    });

    expect(preview.accountReductionUsd).toBeCloseTo(15, 6);
    expect(preview.accountClientName).toBe("Charged Client");
  });
});
