/**
 * SalesRepository — the SALE transaction's profit stamp must match the FIFO
 * cost actually charged to the sale line, not the product's CURRENT
 * cost_price_usd.
 *
 * Pre-fix, processSale's early per-item loop (which builds saleProfitUsd)
 * ran BEFORE the sale_items row existed and BEFORE FIFO batch consumption,
 * so it had no choice but to price every line at the product's LIVE
 * cost_price_usd. FIFO consumption ran later and correctly overwrote
 * sale_items.cost_price_snapshot_usd with the real batch-weighted cost, but
 * never fed that number back into saleProfitUsd — so a product restocked at
 * a HIGHER cost after the FIFO-covered unit was bought stamped the
 * transaction with a loss while sale_items (and the true economics) showed a
 * profit. The Profits page reads transactions.profit_usd, so it showed the
 * wrong number even though sale_items had the right one all along.
 *
 * This reproduces the owner's live-DB report almost exactly: an iPhone sold
 * for $1,300 whose oldest batch cost $1,200 (true profit +$100), but a later
 * restock at $1,450 stamped the transaction profit_usd = 1300 − 1450 = −150.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

// Schema copied from SalesRepository.discountProfit.test.ts (same repo, same
// FK-less-but-FK-enforced fixture trap — core jest runs with foreign keys ON
// and resolves targets at INSERT time, so every table processSale/consume()
// unconditionally touches must exist even with plain columns and no
// REFERENCES clauses).
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
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1
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
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

function seedProduct(
  db: Database.Database,
  costPriceUsd: number,
  stockQuantity: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('iPhone', ?, ?)`,
    )
    .run(costPriceUsd, stockQuantity);
  return Number(res.lastInsertRowid);
}

function stampedSaleProfit(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT profit_usd FROM transactions WHERE type = 'SALE' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { profit_usd: number }
  ).profit_usd;
}

function snapshotCost(db: Database.Database, saleId: number): number {
  return (
    db
      .prepare(
        `SELECT cost_price_snapshot_usd FROM sale_items WHERE sale_id = ? LIMIT 1`,
      )
      .get(saleId) as { cost_price_snapshot_usd: number }
  ).cost_price_snapshot_usd;
}

describe("SalesRepository — SALE profit stamp agrees with the FIFO cost charged to the line", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetStockBatchRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetStockBatchRepository();
    resetTenantContext();
  });

  it("stamps the transaction with the OLDEST batch's margin, matching the sale line's own cost snapshot (fails pre-fix: stamps the product's CURRENT cost_price_usd instead)", () => {
    // Product's CURRENT cost is $1,450 (a later restock), but the oldest
    // open batch — the one FIFO actually draws from — cost only $1,200.
    // Selling one unit at $1,300 must record a $100 profit (1300 − 1200),
    // never a $150 loss (1300 − 1450).
    const productId = seedProduct(db, 1450, 6);
    getStockBatchRepository().createBatch({
      product_id: productId,
      supplier_id: null,
      quantity: 1,
      unit_cost_usd: 1200,
      books_debt: false,
      created_by: 1,
    });
    getStockBatchRepository().createBatch({
      product_id: productId,
      supplier_id: null,
      quantity: 5,
      unit_cost_usd: 1450,
      books_debt: false,
      created_by: 1,
    });

    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 1300 }],
        total_amount: 1300,
        discount: 0,
        final_amount: 1300,
        payment_usd: 1300,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );

    expect(res.success).toBe(true);
    // sale_items already recorded the true FIFO cost pre-fix — this line is
    // not what regressed, it is the oracle the transaction stamp must match.
    expect(snapshotCost(db, res.id!)).toBe(1200);
    // Pre-fix this reads -150 (1300 - the product's CURRENT cost_price_usd
    // of 1450), disagreeing with sale_items and understating the sale as a
    // loss on the Profits page.
    expect(stampedSaleProfit(db)).toBe(100);
  });

  it("scales the correction by the line's own quantity (2 units off one batch, still priced at the batch's cost, not the product's current cost)", () => {
    // Same drift (current cost $1,450 vs. the actual batch cost $1,200),
    // but selling 2 units off ONE batch — proves the correction multiplies
    // the per-unit delta by item.quantity rather than applying it once. A
    // fix that forgot the `* item.quantity` scaling would stamp 200 - 250 =
    // -50 here instead of the correct 200.
    const productId = seedProduct(db, 1450, 6);
    getStockBatchRepository().createBatch({
      product_id: productId,
      supplier_id: null,
      quantity: 5,
      unit_cost_usd: 1200,
      books_debt: false,
      created_by: 1,
    });

    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 2, price: 1300 }],
        total_amount: 2600,
        discount: 0,
        final_amount: 2600,
        payment_usd: 2600,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );

    expect(res.success).toBe(true);
    expect(snapshotCost(db, res.id!)).toBe(1200);
    expect(stampedSaleProfit(db)).toBe(200); // (1300 - 1200) * 2
  });

  it("a DRAFT sale is untouched — it consumes no batches, so both cost readings stay at the provisional cost_price_usd", () => {
    // A draft never moves stock or consumes batches (status !== "completed"
    // guards both), so it must not run the correction either — even though
    // an open batch exists at a different cost.
    const productId = seedProduct(db, 1450, 6);
    getStockBatchRepository().createBatch({
      product_id: productId,
      supplier_id: null,
      quantity: 5,
      unit_cost_usd: 1200,
      books_debt: false,
      created_by: 1,
    });

    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 1300 }],
        total_amount: 1300,
        discount: 0,
        final_amount: 1300,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );

    expect(res.success).toBe(true);
    // Draft: no FIFO draw, so sale_items keeps the plain subquery cost
    // (current cost_price_usd) and the transaction stamp is still the
    // provisional (price - currentCost) figure — the two still agree
    // because neither was corrected, not because the correction ran.
    expect(snapshotCost(db, res.id!)).toBe(1450);
    expect(stampedSaleProfit(db)).toBe(1300 - 1450);
  });
});
