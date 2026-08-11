/**
 * WalletExchangeRepository — internal provider-wallet USD<->LBP exchange
 * (owner req 2026-07-28).
 *
 * Both legs post against the SAME wallet drawer (OMT_App / Whish_App) —
 * never General, never a customer. No profit/spread: profit_usd/profit_lbp
 * are always 0. Reversible via the generic void/refund path (proven below).
 */

import Database from "better-sqlite3";
import { WalletExchangeRepository } from "../WalletExchangeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE wallet_exchanges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawer_name TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

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
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
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
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty on purpose: _cancelDebt (run by every void/refund) queries this
    -- table unconditionally with no existence check.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 200);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 5_000_000);
  `);

  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("WalletExchangeRepository.createTransaction()", () => {
  let db: Database.Database;
  let repo: WalletExchangeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new WalletExchangeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("USD -> LBP: debits USD, credits LBP, on the SAME wallet drawer only", () => {
    const id = repo.createTransaction(
      {
        drawerName: "OMT_App",
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_900_000,
        rate: 89_000,
      },
      1,
    );

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(100, 2); // 200 - 100
    expect(balance(db, "OMT_App", "LBP")).toBeCloseTo(8_900_000, 0);
    // General and the OTHER provider wallet are untouched.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "Whish_App", "LBP")).toBeCloseTo(5_000_000, 0);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'WALLET_EXCHANGE'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.source_table).toBe("wallet_exchanges");
    expect(txn.source_id).toBe(id);
    expect(txn.amount_usd).toBeCloseTo(-100, 2);
    expect(txn.amount_lbp).toBeCloseTo(8_900_000, 0);
    // No spread: this moves the shop's own money, it doesn't sell anything.
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(0);

    const legs = db
      .prepare("SELECT * FROM payments WHERE transaction_id = ? ORDER BY id")
      .all(txn.id) as any[];
    expect(legs).toHaveLength(2);
    expect(legs[0].currency_code).toBe("USD");
    expect(legs[0].amount).toBeCloseTo(-100, 2);
    expect(legs[0].drawer_name).toBe("OMT_App");
    expect(legs[1].currency_code).toBe("LBP");
    expect(legs[1].amount).toBeCloseTo(8_900_000, 0);
    expect(legs[1].drawer_name).toBe("OMT_App");
  });

  it("LBP -> USD: debits LBP, credits USD, on the SAME wallet drawer only", () => {
    repo.createTransaction(
      {
        drawerName: "Whish_App",
        fromCurrency: "LBP",
        toCurrency: "USD",
        amountIn: 4_450_000,
        amountOut: 50,
        rate: 89_000,
      },
      1,
    );

    expect(balance(db, "Whish_App", "LBP")).toBeCloseTo(550_000, 0); // 5,000,000 - 4,450,000
    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(50, 2);
    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(200, 2); // untouched
  });

  it("rejects converting more than the wallet's available balance — writes nothing", () => {
    expect(() =>
      repo.createTransaction(
        {
          drawerName: "OMT_App",
          fromCurrency: "USD",
          toCurrency: "LBP",
          amountIn: 500, // only 200 available
          amountOut: 44_500_000,
          rate: 89_000,
        },
        1,
      ),
    ).toThrow(/Insufficient USD balance/);

    // Nothing written — the throw rolled back the whole db.transaction.
    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(200, 2);
    expect(balance(db, "OMT_App", "LBP")).toBeCloseTo(0, 2);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM wallet_exchanges").get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
  });

  it("void restores both legs — net effect of create + void is 0 on both currencies", () => {
    repo.createTransaction(
      {
        drawerName: "OMT_App",
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_900_000,
        rate: 89_000,
      },
      1,
    );

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(100, 2);
    expect(balance(db, "OMT_App", "LBP")).toBeCloseTo(8_900_000, 0);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTransactionRepository } = require("../TransactionRepository");
    const txnRepo = getTransactionRepository();
    const original = db
      .prepare("SELECT * FROM transactions WHERE type = 'WALLET_EXCHANGE'")
      .get() as any;

    txnRepo.voidTransaction(original.id, 1);

    // Back to the pre-exchange balances — net effect of create + void is 0.
    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(200, 2);
    expect(balance(db, "OMT_App", "LBP")).toBeCloseTo(0, 0);

    const sourceRow = db
      .prepare("SELECT * FROM wallet_exchanges WHERE id = ?")
      .get(original.source_id) as any;
    expect(sourceRow.is_refunded).toBe(1);
  });
});
