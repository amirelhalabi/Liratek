/**
 * RechargeRepository — Whish App top-up tests
 *
 * Covers the two LIRA-057 acquisition flows:
 *   - topUpFromPartner: partner extends Whish credit (CREDIT partner_ledger,
 *     no source drawer deducted)
 *   - topUpFromClient: client transfers Whish credits for cash out of the
 *     General drawer (profit = credits received − cash paid)
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";

// ─── In-memory schema ─────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
    );

    CREATE TABLE transactions (
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
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed Whish_App drawer and General
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedPartner(db: Database.Database, name = "Whish Partner"): number {
  const res = db
    .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
    .run(name);
  return Number(res.lastInsertRowid);
}

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RechargeRepository.topUpFromPartner()", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new RechargeRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("increases Whish_App drawer and creates a CREDIT partner_ledger entry", () => {
    const partnerId = seedPartner(db);

    const result = repo.topUpFromPartner({
      provider: "WHISH_APP",
      partnerId,
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Whish_App/USD increased by 100
    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(100, 2);

    // partner_ledger has exactly one CREDIT/WHISH_TOPUP row for 100
    const entries = db
      .prepare("SELECT * FROM partner_ledger WHERE partner_id = ?")
      .all(partnerId) as any[];
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("CREDIT");
    expect(entries[0].transaction_type).toBe("WHISH_TOPUP");
    expect(entries[0].amount).toBeCloseTo(100, 2);
    expect(entries[0].currency).toBe("USD");
    expect(entries[0].reference_table).toBe("recharges");

    // No other drawer was deducted — General stays at 0
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);

    // Recharge row recorded with paid_by = PARTNER
    const recharge = db
      .prepare("SELECT * FROM recharges WHERE carrier = 'WHISH_APP'")
      .get() as any;
    expect(recharge.recharge_type).toBe("TOP_UP");
    expect(recharge.paid_by).toBe("PARTNER");
    expect(recharge.amount).toBeCloseTo(100, 2);

    // Ledger reference_id points at the recharge row
    expect(entries[0].reference_id).toBe(recharge.id);

    // Unified transaction created
    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'RECHARGE_TOPUP'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(100, 2);
  });

  it("returns an error for an unknown partner", () => {
    const result = repo.topUpFromPartner({
      provider: "WHISH_APP",
      partnerId: 999,
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Partner not found");

    // Nothing was written
    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(0, 2);
    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM partner_ledger").get() as any
    ).cnt;
    expect(ledgerCount).toBe(0);
    const rechargeCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM recharges").get() as any
    ).cnt;
    expect(rechargeCount).toBe(0);
  });
});

describe("RechargeRepository.topUpFromClient()", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new RechargeRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("Whish_App += amount, General -= cashPaid, profit = amount - cashPaid", () => {
    // Seed General/USD = 500
    db.prepare(
      "UPDATE drawer_balances SET balance = 500 WHERE drawer_name = 'General' AND currency_code = 'USD'",
    ).run();

    const result = repo.topUpFromClient({
      amount: 100,
      cashPaid: 99,
      currency: "USD",
      clientName: "Walk-in",
      userId: 1,
    });

    expect(result.success).toBe(true);

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(100, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(401, 2); // 500 - 99

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'RECHARGE_TOPUP'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(100, 2);
    expect(txn.profit_usd).toBeCloseTo(1, 2); // 100 - 99
    expect(txn.profit_lbp).toBeCloseTo(0, 2);

    const recharge = db
      .prepare("SELECT * FROM recharges WHERE carrier = 'WHISH_APP'")
      .get() as any;
    expect(recharge.paid_by).toBe("CLIENT");
    expect(recharge.price).toBeCloseTo(100, 2);
    expect(recharge.cost).toBeCloseTo(99, 2);
  });

  it("returns an error and mutates no drawer when General balance is insufficient", () => {
    // Seed General/USD = 50 (less than cashPaid of 99)
    db.prepare(
      "UPDATE drawer_balances SET balance = 50 WHERE drawer_name = 'General' AND currency_code = 'USD'",
    ).run();

    const result = repo.topUpFromClient({
      amount: 100,
      cashPaid: 99,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient balance");

    // Nothing mutated
    expect(balance(db, "General", "USD")).toBeCloseTo(50, 2);
    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(0, 2);
    const rechargeCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM recharges").get() as any
    ).cnt;
    expect(rechargeCount).toBe(0);
  });

  it("handles the LBP currency path with profit_lbp set correctly", () => {
    // Seed General/LBP = 10,000,000
    db.prepare(
      "UPDATE drawer_balances SET balance = 10000000 WHERE drawer_name = 'General' AND currency_code = 'LBP'",
    ).run();

    const result = repo.topUpFromClient({
      amount: 5_000_000,
      cashPaid: 4_900_000,
      currency: "LBP",
      userId: 1,
    });

    expect(result.success).toBe(true);

    expect(balance(db, "Whish_App", "LBP")).toBeCloseTo(5_000_000, 0);
    expect(balance(db, "General", "LBP")).toBeCloseTo(
      10_000_000 - 4_900_000,
      0,
    );

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'RECHARGE_TOPUP'")
      .get() as any;
    expect(txn.amount_lbp).toBeCloseTo(5_000_000, 0);
    expect(txn.amount_usd).toBeCloseTo(0, 2);
    expect(txn.profit_lbp).toBeCloseTo(100_000, 0); // 5,000,000 - 4,900,000
    expect(txn.profit_usd).toBeCloseTo(0, 2);
  });
});
