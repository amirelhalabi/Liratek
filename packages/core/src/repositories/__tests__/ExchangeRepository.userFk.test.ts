/**
 * ExchangeRepository — user_id FK on the stamped rows
 * (owner-reported: Exchange "Statement execution failed" on Proceed to Pay)
 *
 * The unified `transactions` row and every `payments` row a new exchange
 * writes carry `FOREIGN KEY (…) REFERENCES users(id)`, and the app enables
 * `PRAGMA foreign_keys = ON` (main.ts). `createTransaction()` used to
 * hardcode `createdBy = 1`, so on any database whose admin is NOT user id 1
 * (here the only user is id 2) the transactions/payments INSERTs failed the
 * FK — surfaced through BaseRepository.execute() as "Statement execution
 * failed".
 *
 * This harness reproduces the REAL schema conditions: foreign_keys ON, a
 * users FK on user_id/created_by, and NO user 1. Mirrors the scaffold in
 * FinancialServiceRepository.userFk.test.ts (the reference fix for this
 * exact bug class).
 *
 * Rule 17: proven to FAIL on the pre-fix repository (createdBy hardcoded to 1).
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

const ADMIN_ID = 2; // real DB: admin is id 2, there is NO user 1

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON"); // matches electron-app/main.ts at runtime

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL,
      base_rate REAL,
      profit_usd REAL,
      leg1_rate REAL,
      leg1_market_rate REAL,
      leg1_profit_usd REAL,
      leg2_rate REAL,
      leg2_market_rate REAL,
      leg2_profit_usd REAL,
      via_currency TEXT,
      client_name TEXT,
      note TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      decimal_places INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)   REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  // The only user is id 2 — reproducing the reported DB (no user id 1).
  db.prepare(
    "INSERT INTO users (id, username, role) VALUES (?, 'Admin', 'admin')",
  ).run(ADMIN_ID);

  return db;
}

describe("ExchangeRepository — user_id FK on stamped rows", () => {
  let db: Database.Database;
  let repo: ExchangeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new ExchangeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  it("creates a walk-in exchange with no FK violation when the only user is id 2 (not 1)", () => {
    // Pre-fix: hardcoded createdBy=1 -> "FOREIGN KEY constraint failed" because
    // there is no user id 1 in this database.
    expect(() =>
      repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 9_000_000,
        leg1Rate: 90_000,
        leg1MarketRate: 90_000,
        leg1ProfitUsd: 5,
        totalProfitUsd: 5,
      }),
    ).not.toThrow();
  });

  it("stamps a real (admin) user id on the unified transaction — never a bare 1", () => {
    repo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9_000_000,
      leg1Rate: 90_000,
      leg1MarketRate: 90_000,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
    });

    const txn = db
      .prepare(
        `SELECT user_id FROM transactions WHERE source_table='exchange_transactions' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { user_id: number };
    expect(txn.user_id).toBe(ADMIN_ID);
  });

  it("stamps the same admin user id on the payment (payout) rows", () => {
    repo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9_000_000,
      leg1Rate: 90_000,
      leg1MarketRate: 90_000,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
    });

    const badLegs = db
      .prepare(`SELECT COUNT(*) c FROM payments WHERE created_by IS NOT ?`)
      .get(ADMIN_ID) as { c: number };
    expect(badLegs.c).toBe(0);
  });
});
