/**
 * LIRA-064 — TransactionRepository.getRecent() structured payment legs.
 *
 * Verifies that getRecent() attaches a structured `payments` array (in/out
 * legs joined from the payments table) to each row, WITHOUT modifying the
 * stored `summary` text. This is the data contract future LIRA-067 consumes.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT
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
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();

  return db;
}

function insertTxn(
  db: Database.Database,
  opts: { id: number; type?: string; summary?: string; createdAt?: string },
): void {
  db.prepare(
    `INSERT INTO transactions (id, type, status, user_id, summary, created_at)
     VALUES (?, ?, 'ACTIVE', 1, ?, ?)`,
  ).run(
    opts.id,
    opts.type ?? "SALE",
    opts.summary ?? null,
    opts.createdAt ?? `2026-06-17 10:0${opts.id}:00`,
  );
}

function insertPayment(
  db: Database.Database,
  txnId: number,
  method: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
     VALUES (?, ?, 'General', ?, ?)`,
  ).run(txnId, method, currency, amount);
}

describe("TransactionRepository.getRecent — structured payment legs (LIRA-064)", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__ =
      db;
    resetTransactionRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database })
      .__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  it("attaches in/out legs with currency + method per row", () => {
    insertTxn(db, { id: 1, summary: "Sale #1" });
    // Customer paid $50 cash (in) + 100,000 LBP cash (in), got 20,000 LBP change (out)
    insertPayment(db, 1, "CASH", "USD", 50);
    insertPayment(db, 1, "CASH", "LBP", 100_000);
    insertPayment(db, 1, "CASH", "LBP", -20_000);

    const rows = repo.getRecent(10);
    const row = rows.find((r) => r.id === 1);

    expect(row).toBeTruthy();
    expect(row!.payments).toHaveLength(3);

    const inLegs = row!.payments.filter((p) => p.direction === "in");
    const outLegs = row!.payments.filter((p) => p.direction === "out");
    expect(inLegs).toHaveLength(2);
    expect(outLegs).toHaveLength(1);

    const usdIn = inLegs.find((p) => p.currency_code === "USD");
    expect(usdIn).toMatchObject({
      direction: "in",
      amount: 50,
      signed_amount: 50,
      currency_code: "USD",
      method: "CASH",
    });

    const lbpOut = outLegs[0];
    expect(lbpOut).toMatchObject({
      direction: "out",
      amount: 20_000,
      signed_amount: -20_000,
      currency_code: "LBP",
    });
  });

  it("does NOT modify the stored summary text", () => {
    insertTxn(db, { id: 1, summary: "Plain summary" });
    insertPayment(db, 1, "CASH", "USD", 30);

    const rows = repo.getRecent(10);
    const row = rows.find((r) => r.id === 1);

    expect(row!.summary).toBe("Plain summary");
    expect(row!.summary).not.toMatch(/in:|out:/);
  });

  it("returns an empty array for transactions with no payments", () => {
    insertTxn(db, { id: 1, type: "CLIENT_CREATED", summary: "No payment" });

    const rows = repo.getRecent(10);
    const row = rows.find((r) => r.id === 1);

    expect(row!.payments).toEqual([]);
  });

  it("groups legs by their own transaction across multiple rows", () => {
    insertTxn(db, { id: 1, summary: "First" });
    insertTxn(db, { id: 2, summary: "Second" });
    insertPayment(db, 1, "CASH", "USD", 10);
    insertPayment(db, 2, "WHISH", "USD", 99);

    const rows = repo.getRecent(10);
    const r1 = rows.find((r) => r.id === 1)!;
    const r2 = rows.find((r) => r.id === 2)!;

    expect(r1.payments).toHaveLength(1);
    expect(r1.payments[0]).toMatchObject({ method: "CASH", amount: 10 });
    expect(r2.payments).toHaveLength(1);
    expect(r2.payments[0]).toMatchObject({ method: "WHISH", amount: 99 });
  });
});
