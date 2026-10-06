/**
 * SalesRepository — change kept as store credit must not be droppable
 * (LIRA-258, POSTING_INTEGRITY_PLAN.md item 2.3, POSTING_MAP.md §7 gap G13).
 *
 * A sale paid $15 for a $10 item, with the $5 change kept on the customer's
 * account (a CUSTOMER_ACCOUNT OUT leg), posts two things: +$15 to the General
 * USD drawer and a $5 CREDIT_DEPOSIT on the customer's account. Before the
 * fix, the credit went through `DebtService.addCredit`, which CATCHES any
 * error and returns `{ success: false }` — and processSale ignored the
 * result. So when the credit write failed, the sale (and the $15 drawer
 * posting) still committed and the customer silently lost their $5.
 *
 * The failure is forced at the database level (a BEFORE INSERT trigger on
 * CREDIT_DEPOSIT rows), so nothing in the code path is mocked.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { resetDebtRepository } from "../DebtRepository.js";
import { resetDebtService } from "../../services/DebtService.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert.js";

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
      created_by       TEXT,
      session_id       INTEGER,
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

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
  maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
);
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Walk-in Sami', '70111222')`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Charger', 5, 10)`,
  ).run();
  return db;
}

describe("SalesRepository — change kept as store credit (G13)", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  const resetSingletons = () => {
    resetTransactionRepository();
    resetDebtRepository();
    resetDebtService();
  };

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSingletons();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetSingletons();
    resetTenantContext();
  });

  // $10 charger, customer hands $15 cash, keeps $5 change on their account.
  const sellWithChangeKeptAsCredit = () =>
    repo.processSale(
      {
        client_id: 1,
        items: [{ product_id: 1, quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 15,
        payment_lbp: 0,
        exchange_rate: 90_000,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 15 },
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 5,
            direction: "OUT",
          },
        ],
      },
      1,
    );

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
      .n;

  it("control: posts +$15 to the drawer and a $5 credit to the customer", () => {
    const before = snapshotLedgers(db);
    const res = sellWithChangeKeptAsCredit();
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 15 },
      debt: { "1|USD": -5 },
    });
  });

  it("rolls the whole sale back when the store-credit write fails", () => {
    db.exec(`
      CREATE TRIGGER fail_credit_deposit BEFORE INSERT ON debt_ledger
      WHEN NEW.transaction_type = 'CREDIT_DEPOSIT'
      BEGIN SELECT RAISE(ABORT, 'simulated credit write failure'); END;
    `);
    const before = snapshotLedgers(db);
    const salesBefore = count("sales");
    const txnsBefore = count("transactions");
    const stockBefore = (
      db.prepare(`SELECT stock_quantity FROM products WHERE id = 1`).get() as {
        stock_quantity: number;
      }
    ).stock_quantity;

    const res = sellWithChangeKeptAsCredit();

    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/simulated credit write failure/);
    // Nothing moved: no drawer posting, no sale, no transaction, no stock.
    expectPostings(before, snapshotLedgers(db), {});
    expect(count("sales")).toBe(salesBefore);
    expect(count("transactions")).toBe(txnsBefore);
    expect(
      (
        db
          .prepare(`SELECT stock_quantity FROM products WHERE id = 1`)
          .get() as { stock_quantity: number }
      ).stock_quantity,
    ).toBe(stockBefore);
  });
});
