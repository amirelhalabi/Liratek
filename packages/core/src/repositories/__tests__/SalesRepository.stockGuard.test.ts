/**
 * SalesRepository — stock oversell guard (concurrency correctness).
 *
 * Pre-fix, a completed sale decremented stock with a blind
 * `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ?`
 * (no `stock_quantity >= ?` guard, no rows-affected check). Two sales that grab
 * the last unit(s) concurrently both subtract, driving stock NEGATIVE (inventory
 * sold that doesn't exist).
 *
 * The fix makes the decrement a guarded conditional write and checks
 * `result.changes`; when the row didn't update (insufficient stock), it throws a
 * BusinessRuleError, and the surrounding db.transaction rolls the whole sale
 * back — so the second sale of the last unit fails cleanly instead of overselling.
 *
 * A single in-process jest connection can't reproduce true multi-process write
 * SERIALIZATION (that's OS-level file locking) — this proves the GUARD: once
 * stock is 0, the next completed sale of that item is rejected and stock never
 * goes negative.
 *
 * Rule 17: temporarily revert the guard (blind decrement) and this test FAILS —
 * the second sale succeeds and stock goes to -1.
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
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  // The last unit in stock.
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Charger', 5, 1)`,
  ).run();
  return db;
}

describe("SalesRepository — stock oversell guard", () => {
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

  const sellOneCharger = () =>
    repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 10,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );

  const stock = () =>
    (
      db.prepare(`SELECT stock_quantity FROM products WHERE id = 1`).get() as {
        stock_quantity: number;
      }
    ).stock_quantity;

  const saleItemCount = () =>
    (db.prepare(`SELECT COUNT(*) AS n FROM sale_items`).get() as { n: number })
      .n;

  it("sells the last unit, then rejects the next sale instead of overselling", () => {
    // First sale takes the last unit.
    const first = sellOneCharger();
    expect(first.success).toBe(true);
    expect(stock()).toBe(0);
    const itemsAfterFirst = saleItemCount();

    // Second sale of the (now depleted) item must fail — never drive stock < 0.
    const second = sellOneCharger();
    expect(second.success).toBe(false);
    expect(second.error ?? "").toMatch(/not enough stock/i);

    // The delta that matters (rule 15): stock stayed at 0, never -1 ...
    expect(stock()).toBe(0);
    // ... and the rejected sale was fully rolled back — no orphan sale_items.
    expect(saleItemCount()).toBe(itemsAfterFirst);
  });

  it("allows overselling into negative stock when allowOutOfStock is set", () => {
    // Stock is 1; selling 2 with out-of-stock sales allowed must SUCCEED and let
    // stock go negative (the shop opted in; the shortfall is surfaced by the
    // Negative-Stock report for reconciliation).
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 10 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 20,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
      { allowOutOfStock: true },
    );
    expect(res.success).toBe(true);
    expect(stock()).toBe(-1);
  });
});
