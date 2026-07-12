/**
 * SalesRepository — item-name enrichment on the transaction summary,
 * metadata_json, and debt-ledger note.
 *
 * Pre-fix, `processSale` stamped a generic `transactions.summary` of
 * `Sale #${id}: $${amount}` (no indication of what was sold), a
 * `metadata_json` with only an `item_count` (no names), and — when the sale
 * left an unpaid balance — a hardcoded `debt_ledger.note` of the literal
 * string "Balance from Sale". An operator scanning the transactions table or
 * a client's debt history had no way to tell what a sale actually contained.
 *
 * The fix resolves each line item's product name (already looked up
 * alongside cost_price_usd for the profit calculation) into a shared
 * "2× iPhone Case, 1× Charger" label, and uses it in all three places.
 *
 * Rule 17: every assertion below targets the exact resolved string (not a
 * loose substring check that could pass against either the old or new
 * code) — pinning on the literal old-format value would fail before the fix
 * and passes only after it.
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
      -- Nullable to match the real schema (electron-app/create_db.sql):
      -- inserting a sale_item for a since-deleted product_id stores a NULL
      -- cost snapshot rather than violating a NOT NULL constraint.
      cost_price_snapshot_usd REAL,
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
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'iPhone Case', 5, 20)`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (2, 'Charger', 3, 20)`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (3, 'Screen Protector', 2, 20)`,
  ).run();
  return db;
}

function lastSaleTransaction(db: Database.Database): {
  summary: string;
  metadata_json: string;
} {
  return db
    .prepare(
      `SELECT summary, metadata_json FROM transactions WHERE type = 'SALE' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { summary: string; metadata_json: string };
}

function lastDebtNote(db: Database.Database, clientId: number): string {
  return (
    db
      .prepare(
        `SELECT note FROM debt_ledger WHERE client_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(clientId) as { note: string }
  ).note;
}

describe("SalesRepository — item names on transaction summary/metadata/debt note", () => {
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

  it("stamps the item names — not just id/amount — into transactions.summary and metadata_json.items (fully paid, no debt)", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 2, price: 10 },
          { product_id: 2, quantity: 1, price: 8 },
        ],
        total_amount: 28,
        discount: 0,
        final_amount: 28,
        payment_usd: 28,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const txn = lastSaleTransaction(db);

    // Exact match (rule 17): pre-fix this would have been
    // `Sale #${saleId}: $28` — no item names at all.
    expect(txn.summary).toBe(
      `Sale #${saleId}: 2× iPhone Case, 1× Charger — $28`,
    );

    const metadata = JSON.parse(txn.metadata_json) as {
      item_count: number;
      items: { name: string; quantity: number }[];
    };
    // item_count is kept for backward compatibility with existing readers.
    expect(metadata.item_count).toBe(2);
    expect(metadata.items).toEqual([
      { name: "iPhone Case", quantity: 2 },
      { name: "Charger", quantity: 1 },
    ]);
  });

  it("falls back to 'Unknown Product' when a sale item's product row is gone", () => {
    // Product id 99 does not exist (e.g. deleted after the sale referenced
    // it). allowOutOfStock skips the stock guard's rows-affected check (which
    // would otherwise reject the sale as "not enough stock" for a phantom
    // product) so we can isolate the name-lookup fallback in metadata/summary.
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 99, quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 10,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
      { allowOutOfStock: true },
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;
    const txn = lastSaleTransaction(db);
    expect(txn.summary).toBe(`Sale #${saleId}: 1× Unknown Product — $10`);
  });

  it("stamps the item names into debt_ledger.note instead of the literal 'Balance from Sale' when the sale leaves an unpaid balance", () => {
    const clientId = db
      .prepare(
        `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES (?, ?, 1)`,
      )
      .run("Amir Client", "70000000").lastInsertRowid as number;

    const res = repo.processSale(
      {
        client_id: clientId,
        items: [{ product_id: 3, quantity: 3, price: 5 }],
        total_amount: 15,
        discount: 0,
        final_amount: 15,
        // Only 10 paid of 15 owed → 5 unpaid balance (> the 0.05 debt threshold).
        payment_usd: 10,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const note = lastDebtNote(db, clientId);
    // Rule 17: pinning on the exact literal the old code always wrote proves
    // this assertion fails pre-fix and only passes once the note is built
    // from the resolved item label.
    expect(note).not.toBe("Balance from Sale");
    // The note uses the SAME label as the unified transaction summary, so the
    // Debts history and the audit row read identically (incl. the amount and,
    // when present, the discount tail).
    expect(note).toBe(`Sale #${saleId}: 3× Screen Protector — $15`);
  });
});
