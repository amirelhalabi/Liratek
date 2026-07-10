/**
 * CustomServiceRepository — structured payment legs (owner-reported family,
 * 2026-07-03)
 *
 * The CustomServices form has ALWAYS sent structured legs
 * (`toSnakeLegs(paymentLines, returnLegs)`) — but the repository ignored
 * `data.payments` entirely and booked `paid_by × price` instead. Split
 * payments, paying in a different currency, and change/return legs were all
 * silently wrong (same class as the loto paid-currency bug).
 *
 * After the fix: legs are booked per currency (IN +, OUT change −,
 * CUSTOMER_ACCOUNT share → debt); the legacy no-legs path is unchanged.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
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

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (7, 'CS Client');

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      description TEXT NOT NULL,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      status TEXT DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
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

    -- tenant_id joins the PRIMARY KEY (multi-tenant retrofit v123 — matches
    -- production's per-tenant drawer_balances rebuild).
    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function balance(db: Database.Database, currency: string): number {
  return (
    db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code=?`,
      )
      .get(currency) as { balance: number }
  ).balance;
}

function legs(db: Database.Database) {
  return db
    .prepare(
      `SELECT method, currency_code, amount FROM payments ORDER BY id ASC`,
    )
    .all() as Array<{ method: string; currency_code: string; amount: number }>;
}

describe("CustomServiceRepository — structured payment legs", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new CustomServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("LBP-priced service paid in USD with LBP change books the ACTUAL legs", () => {
    const usdBefore = balance(db, "USD");
    const lbpBefore = balance(db, "LBP");

    // Service worth 900,000 LBP (cost 500,000). Customer hands $20 (=1.8M at
    // 90k) and receives 900,000 LBP change.
    const res = repo.createService(
      {
        description: "phone unlock",
        cost_usd: 0,
        cost_lbp: 500_000,
        price_usd: 0,
        price_lbp: 900_000,
        paid_by: "CASH",
        status: "completed",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 20 },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
      },
      1,
    );
    expect(res.success).toBe(true);

    // Pre-fix: General +900,000 LBP price inflow (phantom), the $20 never
    // booked, no change. Now: +$20 in, −900,000 LBP change, −500,000 LBP cost.
    expect(balance(db, "USD")).toBeCloseTo(usdBefore + 20, 2);
    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore - 900_000 - 500_000, 2);

    const all = legs(db);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ currency_code: "USD", amount: 20 });
    expect(all[1]).toMatchObject({ currency_code: "LBP", amount: -900_000 });
    expect(all[2]).toMatchObject({ currency_code: "LBP", amount: -500_000 }); // cost
  });

  it("split CASH + CUSTOMER_ACCOUNT legs book cash and the on-account share as debt", () => {
    const res = repo.createService(
      {
        description: "software install",
        cost_usd: 5,
        cost_lbp: 0,
        price_usd: 40,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        client_id: 7,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 25 },
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 },
        ],
      },
      1,
    );
    expect(res.success).toBe(true);

    const debt = db
      .prepare(`SELECT amount_usd, amount_lbp FROM debt_ledger`)
      .get() as { amount_usd: number; amount_lbp: number };
    expect(debt.amount_usd).toBeCloseTo(15, 2);

    const cash = legs(db).find((l) => l.amount === 25);
    expect(cash).toMatchObject({ method: "CASH", currency_code: "USD" });
  });

  it("legacy path (no legs) books paid_by × price unchanged", () => {
    const lbpBefore = balance(db, "LBP");

    const res = repo.createService(
      {
        description: "legacy call",
        cost_usd: 0,
        cost_lbp: 0,
        price_usd: 0,
        price_lbp: 300_000,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore + 300_000, 2);
  });

  it("stamps client name/phone on the unified transaction (rule 11 — walk-in, no client row)", () => {
    const res = repo.createService(
      {
        description: "walk-in client stamp",
        cost_usd: 0,
        cost_lbp: 0,
        price_usd: 20,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        client_name: "L094 Walk-in",
        phone_number: "76111222",
      },
      1,
    );
    expect(res.success).toBe(true);

    const txn = db
      .prepare(
        `SELECT client_name, client_phone FROM transactions WHERE source_table = 'custom_services' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { client_name: string | null; client_phone: string | null };
    // Pre-fix: both were NULL — the transactions table showed "—".
    expect(txn.client_name).toBe("L094 Walk-in");
    expect(txn.client_phone).toBe("76111222");
  });
});
