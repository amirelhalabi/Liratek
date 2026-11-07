/**
 * moneyPosting.ts — a Binance payment line posts to the Binance drawer as USDT.
 *
 * Cornertech 2026-11-06 (txns 16174 / 16188): Whish App sends paid with the
 * Binance method opened a USD balance inside the Binance drawer, which only
 * holds USDT. Every money flow writes through `insertPaymentRow` +
 * `applyDrawerDelta`, so the rule lives there: Binance + USD posts as USDT
 * (1 USDT = $1), Binance + LBP is refused. Checkpoint rows keep their literal
 * currency so a counted stray balance can still be corrected.
 */

import Database from "better-sqlite3";
import { applyDrawerDelta, insertPaymentRow } from "../moneyPosting";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      created_at TEXT
    );
  `);
  return db;
}

function balances(db: Database.Database, drawer: string) {
  return db
    .prepare(
      "SELECT currency_code, balance FROM drawer_balances WHERE drawer_name = ? ORDER BY currency_code",
    )
    .all(drawer);
}

function post(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
  amount: number,
  method = "BINANCE",
) {
  insertPaymentRow(db, {
    transactionId: 1,
    method,
    drawerName,
    currencyCode,
    amount,
    tenantId: 1,
  });
  applyDrawerDelta(db, {
    drawerName,
    currencyCode,
    delta: amount,
    tenantId: 1,
  });
}

describe("moneyPosting — Binance line posts as USDT", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createDb();
  });
  afterEach(() => db.close());

  it("a USD line into Binance is journaled and posted as USDT at 1:1", () => {
    post(db, "Binance", "USD", 301);
    expect(balances(db, "Binance")).toEqual([
      { currency_code: "USDT", balance: 301 },
    ]);
    expect(
      db.prepare("SELECT currency_code, amount FROM payments").all(),
    ).toEqual([{ currency_code: "USDT", amount: 301 }]);
  });

  it("a refund of a legacy USD row comes back out of USDT, and create + refund nets 0", () => {
    post(db, "Binance", "USD", 601);
    post(db, "Binance", "USD", -601);
    expect(balances(db, "Binance")).toEqual([
      { currency_code: "USDT", balance: 0 },
    ]);
  });

  it("an LBP line into Binance is refused with nothing written", () => {
    expect(() => post(db, "Binance", "LBP", 27_000_000)).toThrow(
      /Binance only takes USDT/,
    );
    expect(balances(db, "Binance")).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM payments").get()).toEqual({
      n: 0,
    });
  });

  it("USDT into Binance and USD into other drawers are unchanged", () => {
    post(db, "Binance", "USDT", 50);
    post(db, "General", "USD", 20, "CASH");
    expect(balances(db, "Binance")).toEqual([
      { currency_code: "USDT", balance: 50 },
    ]);
    expect(balances(db, "General")).toEqual([
      { currency_code: "USD", balance: 20 },
    ]);
  });

  it("a checkpoint correction keeps its literal currency so a stray Binance USD balance can be zeroed", () => {
    db.prepare(
      "INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Binance', 'USD', 301)",
    ).run();
    insertPaymentRow(db, {
      transactionId: 2,
      method: "CHECKPOINT_ADJUSTMENT",
      drawerName: "Binance",
      currencyCode: "USD",
      amount: -301,
      tenantId: 1,
      literalCurrency: true,
    });
    applyDrawerDelta(db, {
      drawerName: "Binance",
      currencyCode: "USD",
      delta: -301,
      tenantId: 1,
      literalCurrency: true,
    });
    expect(balances(db, "Binance")).toEqual([
      { currency_code: "USD", balance: 0 },
    ]);
  });
});
