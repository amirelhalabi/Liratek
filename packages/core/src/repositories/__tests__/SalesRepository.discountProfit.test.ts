/**
 * SalesRepository — POS discount reduces stamped profit (profit-audit fix 2)
 *
 * Pre-fix, the SALE transaction's profit_usd was the sum of gross item margins
 * (sold − cost) × qty; the sale-level discount was subtracted from the amount
 * the customer owes (final_amount = total − discount) but NEVER from profit.
 * Every discounted sale overstated profit by the full discount.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

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
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Phone case', 60, 10)`,
  ).run();
  return db;
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

describe("SalesRepository — discount reduces stamped profit", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("stamps profit = item margins − discount (pre-fix: margins only)", () => {
    // 2 units @ $100, cost $60 → gross margin $80; $10 discount → profit $70.
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 100 }],
        total_amount: 200,
        discount: 10,
        final_amount: 190,
        payment_usd: 190,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(stampedSaleProfit(db)).toBe(70);
  });

  it("leaves profit at gross margin when there is no discount", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 100,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(stampedSaleProfit(db)).toBe(40);
  });

  // ── Review fix: per-item refund allocates a pro-rata share of the discount ──
  // Pre-fix, refundSaleItem negated the GROSS item margin, so a fully-refunded
  // discounted sale left a phantom loss equal to the discount instead of $0.
  it("nets SALE + item REFUNDs of a discounted sale to zero (pro-rata discount)", () => {
    // 2 units @ $100, cost $60 → gross margin $80; $20 discount → SALE profit $60.
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 100 }],
        total_amount: 200,
        discount: 20,
        final_amount: 180,
        payment_usd: 180,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;
    const itemId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? LIMIT 1`)
        .get(saleId) as { id: number }
    ).id;

    const netProfit = () =>
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions
             WHERE source_table = 'sales' AND source_id = ?`,
          )
          .get(saleId) as { p: number }
      ).p;

    expect(netProfit()).toBe(60); // SALE only

    // Refund 1 of 2 units: gross margin 40 − pro-rata discount (20 × 100/200 = 10)
    // = 30. Net = 60 − 30 = 30 (pre-fix: 60 − 40 = 20).
    repo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
    });
    expect(netProfit()).toBe(30);

    // Refund the 2nd unit → fully reversed → net 0 (pre-fix: 60 − 80 = −20).
    repo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
    });
    expect(netProfit()).toBe(0);
  });
});
