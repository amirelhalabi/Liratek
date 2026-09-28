/**
 * LIRA-244 follow-up, round 2 (coordinator correction, 2026-09-28) —
 * "Cash Collected (Today)" must equal the net cash that POS sales, customer-
 * session checkouts and debt repayments actually moved into the drawers
 * today, agreeing with the drawer delta, for every shape this file's own
 * matrix enumerates.
 *
 * CORRECTION (not pre-existing — a regression introduced by the FIRST
 * LIRA-244 follow-up, THIS session, earlier today): the fix that made
 * session-basket checkouts visible (`cashFromSessionsResult`, a raw sum of
 * session-pooled `payments` rows with no link to `sales.status`) is
 * asymmetric with `cashFromSalesResult`, which still filtered on
 * `s.status = 'completed'` and bucketed by the SALE's `created_at` rather
 * than the payment leg's own day. A session sale fully refunded the SAME
 * day: the session's pooled IN leg counts unconditionally (new query), but
 * the refund's OUT leg — posted on a REFUND transaction with
 * `source_table='sales'` — stops counting the moment `sales.status` flips
 * to 'refunded' (old query's WHERE clause). Net effect: Cash Collected
 * OVERSTATES the drawer by the refunded amount.
 *
 * ROOT FIX (this file): `cashFromSalesResult` now buckets by the PAYMENT
 * LEG's own `created_at` (`isToday('p.created_at')`, rule 27's `isToday`
 * helper) — never `sales.created_at` — and drops the `sales.status` filter
 * entirely. Every IN and its later reversal/refund OUT count on the day
 * they actually happened, matching `cashFromSessionsResult`'s (already
 * leg-day-scoped, already status-blind) design — one rule (rule 14),
 * applied consistently to both sale-linked and session-pooled legs.
 *
 * RULE 17 — RED, actually run (`npx jest
 * SalesRepository.dashboardCashCollected.matrix --maxWorkers=2`,
 * 2026-09-28) against the CURRENT (pre-this-fix, `cashFromSessionsResult`
 * already shipped) `getDashboardStats`:
 *
 *   FAIL … › REGRESSION — session full-refund same day...
 *     Expected cashCollectedUSD == drawer delta (0) / Received: 100
 *   The session's $100 pooled IN leg counted; the $100 refund's OUT leg did
 *   not (`sales.status` had flipped to 'refunded').
 *
 * GREEN after the fix — this file's full matrix (12 cases) all assert
 * Cash Collected's delta equals the ACTUAL drawer delta for the day,
 * measured independently via `drawer_balances`, never inferred from the
 * dashboard's own math.
 *
 * Fixture: extends `TransactionRepository.refundSessionBasketItem.test.ts`'s
 * schema (already has every session-refund table this file also needs) with
 * `products.min_stock_level`/`is_active` (`getDashboardStats`'s low-stock
 * query reads both) and `product_units`'s warranty column already present.
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
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository.js";
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
import { resetDebtService } from "../../services/DebtService.js";

const RATE = 90_000;
const USER_ID = 1;

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
      min_stock_level INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
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
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
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

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT
    );

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT
    );

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

function generalUsd(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'`,
    )
    .get() as { balance: number };
  return row.balance;
}

function insertProduct(db: Database.Database, name: string, costUsd = 10): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (name, cost_price_usd, stock_quantity, min_stock_level, is_active) VALUES (?, ?, 100, 0, 1)`,
      )
      .run(name, costUsd).lastInsertRowid,
  );
}

describe("Cash Collected (Today) — regression + full matrix (coordinator follow-up, 2026-09-28)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let debtRepo: DebtRepository;
  let sessionRepo: CustomerSessionRepository;
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
    resetDebtService();
    salesRepo = new SalesRepository();
    txnRepo = new TransactionRepository();
    debtRepo = new DebtRepository();
    sessionRepo = new CustomerSessionRepository();
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
    resetDebtService();
  });

  function seedSession(): number {
    return Number(
      db
        .prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')")
        .run().lastInsertRowid,
    );
  }

  function seedClient(name = "client"): number {
    return Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES (?)`).run(name).lastInsertRowid,
    );
  }

  /** A REAL, non-session, non-deferred cash sale. */
  function plainCashSale(
    priceUsd: number,
    tenderedUsd: number,
    clientId: number | null = null,
  ): { saleId: number; itemId: number } {
    const productId = insertProduct(db, "Item");
    const changeUsd = Math.max(0, tenderedUsd - priceUsd);
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: [{ product_id: productId, quantity: 1, price: priceUsd }],
        total_amount: priceUsd,
        discount: 0,
        final_amount: priceUsd,
        payment_usd: tenderedUsd,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: tenderedUsd }],
        change_given_usd: changeUsd,
        exchange_rate: RATE,
        status: "completed",
      },
      USER_ID,
    );
    expect(result.success).toBe(true);
    const saleId = result.id!;
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as {
        id: number;
      }
    ).id;
    return { saleId, itemId };
  }

  function saleTxnId(saleId: number): number {
    return (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
        )
        .get(saleId) as { id: number }
    ).id;
  }

  function sellIntoSession(
    sessionId: number,
    clientId: number | null,
    priceUsd: number,
  ): { saleId: number; txnId: number; itemId: number } {
    const productId = insertProduct(db, "Session Item");
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: [{ product_id: productId, quantity: 1, price: priceUsd }],
        total_amount: priceUsd,
        discount: 0,
        final_amount: priceUsd,
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
    const txnId = saleTxnId(saleId);
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'sale', ?, ?, ?, 0)`,
    ).run(sessionId, saleId, txnId, priceUsd);
    const itemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as {
        id: number;
      }
    ).id;
    return { saleId, txnId, itemId };
  }

  function payCash(sessionId: number, amountUsd: number, clientId?: number | null): void {
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: amountUsd }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });
  }

  /** Directly rewrites every row tied to `saleId`'s SALE transaction to
   *  look like it happened `daysAgo` days ago — a test-only "time travel"
   *  (never a production code path) so case 12 can prove cross-day
   *  bucketing without mocking the system clock. */
  function backdateSale(saleId: number, daysAgo: number): void {
    const txnId = saleTxnId(saleId);
    db.prepare(
      `UPDATE transactions SET created_at = datetime('now', ?) WHERE id = ?`,
    ).run(`-${daysAgo} days`, txnId);
    db.prepare(
      `UPDATE payments SET created_at = datetime('now', ?) WHERE transaction_id = ?`,
    ).run(`-${daysAgo} days`, txnId);
    db.prepare(
      `UPDATE sales SET created_at = datetime('now', ?) WHERE id = ?`,
    ).run(`-${daysAgo} days`, saleId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REGRESSION — written and run FIRST against the pre-fix code (rule 17).
  // ═══════════════════════════════════════════════════════════════════════
  it("REGRESSION — session sale fully refunded the SAME day: Cash Collected must equal the drawer delta (0), not overstate it", () => {
    // Ground-truth window starts BEFORE the sale — a same-day sell+refund
    // round trip must net the drawer to exactly where it started.
    const drawerBefore = generalUsd(db);
    const clientId = seedClient();
    const sessionId = seedSession();
    const { saleId, txnId, itemId } = sellIntoSession(sessionId, clientId, 100);
    payCash(sessionId, 100, clientId);

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: itemId,
      quantity: 1,
      userId: USER_ID,
    });
    const drawerAfter = generalUsd(db);
    const drawerDelta = drawerAfter - drawerBefore;

    // Ground truth: $100 came in, $100 went straight back out, same day —
    // the drawer nets to exactly where it started.
    expect(drawerDelta).toBeCloseTo(0, 6);
    // Sanity: the sale really is fully refunded (status flips).
    const saleStatus = (
      db.prepare(`SELECT status FROM sales WHERE id = ?`).get(saleId) as {
        status: string;
      }
    ).status;
    expect(saleStatus).toBe("refunded");

    const stats = salesRepo.getDashboardStats();
    expect(stats.cashCollectedUSD).toBeCloseTo(drawerDelta, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1–6: plain (non-session) sales
  // ═══════════════════════════════════════════════════════════════════════

  it("1. plain cash sale", () => {
    const before = generalUsd(db);
    plainCashSale(100, 100);
    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(100, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("2. sale with change given", () => {
    const before = generalUsd(db);
    plainCashSale(100, 150); // tenders 150, gets 50 back
    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(100, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("3. partial item refund, same day", () => {
    const before = generalUsd(db);
    const { saleId, itemId } = plainCashSale(100, 100);
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    // (This product's sale had only 1 unit — a "partial" refund in the
    // sense of using the standalone per-item refund path rather than a
    // whole-sale void; the item happens to be the sale's only line.)
    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(0, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("4. full refund, same day", () => {
    const before = generalUsd(db);
    const { saleId, itemId } = plainCashSale(100, 100);
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const saleStatus = (
      db.prepare(`SELECT status FROM sales WHERE id = ?`).get(saleId) as {
        status: string;
      }
    ).status;
    expect(saleStatus).toBe("refunded");
    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(0, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("5. void, same day", () => {
    const before = generalUsd(db);
    const { saleId } = plainCashSale(100, 100);
    const txnId = saleTxnId(saleId);
    txnRepo.voidTransaction(txnId, USER_ID);
    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(0, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("6. draft saved (and re-saved) then completed", () => {
    const before = generalUsd(db);
    const productId = insertProduct(db, "Draft Item");

    // Save as draft.
    const draft = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "draft",
      },
      USER_ID,
    );
    expect(draft.success).toBe(true);
    // A draft moves no drawer and posts no transaction row at all — the
    // dashboard must stay at $0 while it's still a draft.
    expect(generalUsd(db)).toBeCloseTo(before, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(0, 6);

    // Re-save the SAME draft (id passed back in) — still a draft.
    const resaved = salesRepo.processSale(
      {
        id: draft.id,
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "draft",
      },
      USER_ID,
    );
    expect(resaved.success).toBe(true);
    expect(generalUsd(db)).toBeCloseTo(before, 6);

    // Now complete it, tendering cash.
    const completed = salesRepo.processSale(
      {
        id: draft.id,
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 100,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
        exchange_rate: RATE,
        status: "completed",
      },
      USER_ID,
    );
    expect(completed.success).toBe(true);

    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(100, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7–10: session-basket flows
  // ═══════════════════════════════════════════════════════════════════════

  it("7. session checkout", () => {
    const before = generalUsd(db);
    const sessionId = seedSession();
    sellIntoSession(sessionId, null, 75);
    payCash(sessionId, 75, null);
    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(75, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("8. session single-item refund (partial refund of a multi-item basket)", () => {
    const before = generalUsd(db);
    const sessionId = seedSession();
    const first = sellIntoSession(sessionId, null, 40);
    const second = sellIntoSession(sessionId, null, 60);
    payCash(sessionId, 100, null);

    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: first.txnId,
      saleItemId: first.itemId,
      quantity: 1,
      userId: USER_ID,
    });
    // The second item was never refunded — the basket keeps $60 collected.
    void second;

    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(60, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("9. Refund basket (refundSessionBasket)", () => {
    const before = generalUsd(db);
    const sessionId = seedSession();
    sellIntoSession(sessionId, null, 50);
    payCash(sessionId, 50, null);

    txnRepo.refundSessionBasket(sessionId, USER_ID);

    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(0, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  it("10. Void basket (voidSessionBasket)", () => {
    const before = generalUsd(db);
    const sessionId = seedSession();
    sellIntoSession(sessionId, null, 50);
    payCash(sessionId, 50, null);

    txnRepo.voidSessionBasket(sessionId, USER_ID);

    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(0, 6);
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11: the existing LIRA-244 guard, restated in this file's matrix shape
  // ═══════════════════════════════════════════════════════════════════════

  it("11. same-day repayment of a same-day credit sale (existing LIRA-244 guard)", () => {
    const before = generalUsd(db);
    const clientId = seedClient();
    // $10 sale, $6 tendered cash — `processSale` itself books the $4
    // remainder as a real 'Sale Debt' row (`bookClientDebtCharge`, since
    // `payment_usd` ($6) is less than `final_amount` ($10) and a client is
    // attached) — no manual debt_ledger insert needed.
    plainCashSale(10, 6, clientId);

    const repayment = debtRepo.addRepayment({
      client_id: clientId,
      amount_usd: 4,
      amount_lbp: 0,
      created_by: USER_ID,
      paid_by_method: "CASH",
    });
    expect(repayment.id).toBeGreaterThan(0);

    const delta = generalUsd(db) - before;
    expect(delta).toBeCloseTo(10, 6); // 6 (sale) + 4 (repayment)
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(delta, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12: cross-day
  // ═══════════════════════════════════════════════════════════════════════

  it("12. cross-day: sale YESTERDAY, refund TODAY — today's dashboard must show only today's real drawer movement", () => {
    const { saleId, itemId } = plainCashSale(100, 100);
    backdateSale(saleId, 1);

    // Today's dashboard, before any action today: the sale is dated
    // yesterday, so it must NOT show in today's Cash Collected even though
    // it's still sitting in the drawer from before today started.
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(0, 6);

    const drawerBeforeRefund = generalUsd(db);
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const drawerAfterRefund = generalUsd(db);
    const todaysRealDrawerDelta = drawerAfterRefund - drawerBeforeRefund;

    // Ground truth: refunding $100 today moves $100 OUT of the drawer
    // TODAY, regardless of when the original sale happened.
    expect(todaysRealDrawerDelta).toBeCloseTo(-100, 6);

    // Today's dashboard must show that same -$100 — the refund's OUT leg
    // is dated today (isToday('p.created_at')), even though the original
    // sale it reverses is dated yesterday.
    expect(salesRepo.getDashboardStats().cashCollectedUSD).toBeCloseTo(
      todaysRealDrawerDelta,
      6,
    );
  });
});
