/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — every refund preview returns
 * `bookedRate`/`bookedRateSource`, and the generic (Transactions-page)
 * refund's `exchangeRate` option makes a cross-currency `refundLegs`
 * override work end to end (money actually moves the right drawers by the
 * right amounts, not just the validator in isolation — see
 * `TransactionRepository.validateRefundLegOverrideAmounts.crossCurrency.test.ts`
 * for that unit-level proof).
 *
 * Fixture: copied from `TransactionRepository.refundMethodOverride.test.ts`
 * (rule 14's spirit — same established schema, not a fourth reinvention),
 * trimmed to only what this file's own scenarios touch.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { SalesRepository, resetSalesRepository } from "../SalesRepository.js";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository.js";
import { resetRateRepository } from "../RateRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const RATE = 90_000;
const FALLBACK_RATE = 89_000;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, phone_number TEXT,
      tenant_id INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, exchange_rate REAL,
      client_id INTEGER, client_name TEXT, client_phone TEXT, reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0, profit_lbp REAL NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT,
      device_id TEXT, tenant_id INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, session_id INTEGER,
      method TEXT NOT NULL, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL, amount REAL NOT NULL,
      note TEXT, created_by INTEGER, tenant_id INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);

    CREATE TABLE payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, label TEXT NOT NULL, drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0, tenant_id INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, transaction_id INTEGER, note TEXT, due_date TEXT,
      created_by INTEGER, edited_by TEXT, edited_at DATETIME, session_id INTEGER, tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_refunded INTEGER DEFAULT 0, refunded_at DATETIME,
      covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, final_amount_usd REAL NOT NULL DEFAULT 0,
      total_amount_usd REAL NOT NULL DEFAULT 0, discount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed', tenant_id INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, stock_quantity INTEGER NOT NULL DEFAULT 0,
      cost_price_usd REAL NOT NULL DEFAULT 0, tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1, sold_price_usd REAL NOT NULL DEFAULT 0, cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0, refunded_quantity INTEGER DEFAULT 0, tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, tenant_id INTEGER DEFAULT 1
    );
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, product_id INTEGER, is_refunded INTEGER DEFAULT 0, refunded_at TEXT);
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0, refunded_at TEXT);

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, from_code TEXT NOT NULL DEFAULT 'USD', to_code TEXT NOT NULL,
      market_rate REAL NOT NULL, buy_rate REAL NOT NULL, sell_rate REAL NOT NULL, is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${FALLBACK_RATE}, ${FALLBACK_RATE}, ${FALLBACK_RATE}, 1);

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, batch_id INTEGER NOT NULL, sale_item_id INTEGER,
      custom_service_id INTEGER, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE', is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER
    );

    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, product_id INTEGER NOT NULL, supplier_id INTEGER,
      quantity INTEGER NOT NULL, quantity_remaining INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0, ledger_entry_id INTEGER, transaction_id INTEGER, is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function drawer(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(`SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`)
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("LIRA-236 — bookedRate/bookedRateSource + generic cross-currency refund", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;
  let salesRepo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetSalesRepository();
    resetPaymentMethodRepository();
    resetRateRepository();
    txnRepo = new TransactionRepository();
    salesRepo = new SalesRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTransactionRepository();
    resetSalesRepository();
    resetPaymentMethodRepository();
    resetRateRepository();
  });

  function insertSaleWithCashLeg(amountUsd: number): { saleId: number; txnId: number; itemId: number } {
    const saleId = Number(
      db
        .prepare(
          `INSERT INTO sales (final_amount_usd, total_amount_usd, paid_usd, exchange_rate_snapshot, status)
           VALUES (?, ?, ?, ?, 'completed')`,
        )
        .run(amountUsd, amountUsd, amountUsd, RATE).lastInsertRowid,
    );
    const productId = Number(
      db.prepare(`INSERT INTO products (name, stock_quantity) VALUES ('Item', 5)`).run().lastInsertRowid,
    );
    const itemId = Number(
      db
        .prepare(
          `INSERT INTO sale_items (sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .run(saleId, productId, amountUsd, amountUsd * 0.6).lastInsertRowid,
    );
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, exchange_rate, summary)
           VALUES ('SALE', 'sales', ?, 1, ?, ?, 'Cash sale')`,
        )
        .run(saleId, amountUsd, RATE).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, created_by)
       VALUES (?, 'CASH', 'General', 'USD', ?, 1)`,
    ).run(txnId, amountUsd);
    db.prepare(
      `UPDATE drawer_balances SET balance = balance + ? WHERE drawer_name = 'General' AND currency_code = 'USD'`,
    ).run(amountUsd);
    return { saleId, txnId, itemId };
  }

  it("getSaleRefundPreview: bookedRate comes from the sale's own exchange_rate_snapshot (source 'sale')", () => {
    const { saleId } = insertSaleWithCashLeg(50);
    const preview = txnRepo.getSaleRefundPreview(saleId);
    expect(preview.bookedRate).toBe(RATE);
    expect(preview.bookedRateSource).toBe("sale");
  });

  it("SalesRepository.getItemRefundPreview: bookedRate comes from the sale's own snapshot too", () => {
    const { saleId, itemId } = insertSaleWithCashLeg(50);
    const preview = salesRepo.getItemRefundPreview({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
    });
    expect(preview.bookedRate).toBe(RATE);
    expect(preview.bookedRateSource).toBe("sale");
  });

  it("getRefundBookedRate: 'transaction' source when the transaction itself recorded a rate", () => {
    const { txnId } = insertSaleWithCashLeg(50);
    const result = txnRepo.getRefundBookedRate(txnId);
    expect(result.bookedRate).toBe(RATE);
    // getRefundBookedRate re-checks source_table/type itself (see its own
    // doc) — a SALE row reads "sale", not the generic "transaction".
    expect(result.bookedRateSource).toBe("sale");
  });

  it("getRefundBookedRate: 'fallback' source (the day's rate) when the transaction recorded none", () => {
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, summary)
           VALUES ('FINANCIAL_SERVICE', 'financial_services', 1, 1, 25, 'No rate recorded')`,
        )
        .run().lastInsertRowid,
    );
    const result = txnRepo.getRefundBookedRate(txnId);
    expect(result.bookedRate).toBe(FALLBACK_RATE);
    expect(result.bookedRateSource).toBe("fallback");
  });

  it("refundTransaction: a USD sale refunded fully in LBP at a typed rate moves the RIGHT drawers by the RIGHT amounts (cross-currency, LIRA-236)", () => {
    const { txnId } = insertSaleWithCashLeg(50);
    const usdBefore = drawer(db, "General", "USD");
    const lbpBefore = drawer(db, "General", "LBP");

    const refundId = txnRepo.refundTransaction(txnId, 1, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4_450_000 }],
      exchangeRate: 89000,
    });
    expect(refundId).toBeGreaterThan(0);

    // The USD drawer is UNTOUCHED (the customer never gave USD back);
    // the LBP drawer pays out exactly 4,450,000.
    expect(drawer(db, "General", "USD")).toBeCloseTo(usdBefore, 6);
    expect(drawer(db, "General", "LBP")).toBeCloseTo(lbpBefore - 4_450_000, 1);

    // The rate is stamped on the REFUND row for audit (contract item 6).
    const refundRow = db
      .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
      .get(refundId) as { metadata_json: string | null };
    const meta = JSON.parse(refundRow.metadata_json ?? "{}");
    expect(meta.exchangeRate).toBe(89000);
  });

  it("refundTransaction: without exchangeRate, a cross-currency refundLegs override is still rejected (backward compatible)", () => {
    const { txnId } = insertSaleWithCashLeg(50);
    expect(() =>
      txnRepo.refundTransaction(txnId, 1, {
        refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4_450_000 }],
      }),
    ).toThrow(/do not match the original payment/);
  });

  it("SalesRepository.refundSaleItem (POS 'Refund item'): a USD item refunded in LBP at a typed rate moves the RIGHT drawers (cross-currency, LIRA-236)", () => {
    const { itemId, saleId } = insertSaleWithCashLeg(50);
    const usdBefore = drawer(db, "General", "USD");
    const lbpBefore = drawer(db, "General", "LBP");

    const refundTxnId = salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4_450_000 }],
      exchangeRate: 89000,
    });
    expect(refundTxnId).toBeGreaterThan(0);

    expect(drawer(db, "General", "USD")).toBeCloseTo(usdBefore, 6);
    expect(drawer(db, "General", "LBP")).toBeCloseTo(lbpBefore - 4_450_000, 1);

    const refundRow = db
      .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
      .get(refundTxnId) as { metadata_json: string | null };
    const meta = JSON.parse(refundRow.metadata_json ?? "{}");
    expect(meta.exchangeRate).toBe(89000);
  });

  // F12 (round-3 review, LOW) — a non-session REFUND row must ALWAYS record
  // the rate it used, even when the cashier never typed an override: the
  // booked rate (the sale's own recorded rate) is what actually drove the
  // refund's math, so it belongs in the audit stamp too, not just the
  // operator-typed case.
  it("refundBySaleId: with NO typed exchangeRate, the REFUND row still stamps the booked (sale's own recorded) rate", () => {
    const { saleId } = insertSaleWithCashLeg(50);

    const refundId = txnRepo.refundBySaleId(saleId, 1, {});

    const refundRow = db
      .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
      .get(refundId) as { metadata_json: string | null };
    const meta = JSON.parse(refundRow.metadata_json ?? "{}");
    expect(meta.exchangeRate).toBe(RATE);
  });

  it("SalesRepository.refundSaleItem: with NO typed exchangeRate, the REFUND row still stamps the booked (sale's own recorded) rate", () => {
    const { itemId, saleId } = insertSaleWithCashLeg(50);

    const refundTxnId = salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
    });

    const refundRow = db
      .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
      .get(refundTxnId) as { metadata_json: string | null };
    const meta = JSON.parse(refundRow.metadata_json ?? "{}");
    expect(meta.exchangeRate).toBe(RATE);
  });
});
