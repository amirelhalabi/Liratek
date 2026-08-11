/**
 * LotoTicketRepository — book what the customer ACTUALLY paid (owner feedback
 * 2026-07-03)
 *
 * A loto ticket is LBP-denominated, but the customer may pay in USD (or split
 * across currencies). Pre-fix, the sale ALWAYS credited the ticket's LBP face
 * value into General — a 500,000 LBP ticket paid with $5 booked a phantom
 * +500,000 LBP and the $5 never reached the books.
 *
 * After the fix: structured `payments` legs are booked per currency (IN
 * positive, OUT change negative); the no-legs legacy path is unchanged.
 */

import Database from "better-sqlite3";
import { LotoTicketRepository } from "../LotoTicketRepository";
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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      ticket_number TEXT,
      sale_amount REAL NOT NULL,
      commission_rate REAL DEFAULT 0.0445,
      commission_amount REAL NOT NULL,
      is_winner INTEGER DEFAULT 0,
      prize_amount REAL DEFAULT 0,
      sale_date TEXT,
      payment_method TEXT,
      currency TEXT DEFAULT 'LBP',
      note TEXT,
      client_id INTEGER,
      client_name TEXT,
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
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 100, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 10000000, CURRENT_TIMESTAMP);

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      due_date TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);
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

describe("LotoTicketRepository — paid-currency legs", () => {
  let db: Database.Database;
  let repo: LotoTicketRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new LotoTicketRepository(db);
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("500,000 LBP ticket paid with $5 books General +5 USD — NOT +500,000 LBP", () => {
    const usdBefore = balance(db, "USD");
    const lbpBefore = balance(db, "LBP");

    repo.createTicket({
      sale_amount: 500_000,
      commission_amount: 22_250,
      sale_date: "2026-07-03",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    });

    expect(balance(db, "USD")).toBeCloseTo(usdBefore + 5, 2);
    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore, 2); // untouched
  });

  it("split USD + LBP payment books each leg in its own currency", () => {
    const usdBefore = balance(db, "USD");
    const lbpBefore = balance(db, "LBP");

    repo.createTicket({
      sale_amount: 500_000,
      commission_amount: 22_250,
      sale_date: "2026-07-03",
      payment_method: "SPLIT",
      currency: "LBP",
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 3 },
        { method: "CASH", currencyCode: "LBP", amount: 200_000 },
      ],
    });

    expect(balance(db, "USD")).toBeCloseTo(usdBefore + 3, 2);
    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore + 200_000, 2);
  });

  it("OUT (change) legs book negative", () => {
    const lbpBefore = balance(db, "LBP");

    repo.createTicket({
      sale_amount: 500_000,
      commission_amount: 22_250,
      sale_date: "2026-07-03",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "LBP", amount: 600_000 },
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 100_000,
          direction: "OUT",
        },
      ],
    });

    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore + 500_000, 2);
  });

  it("legacy path (no legs) still books the denominated amount", () => {
    const lbpBefore = balance(db, "LBP");

    repo.createTicket({
      sale_amount: 500_000,
      commission_amount: 22_250,
      sale_date: "2026-07-03",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });

    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore + 500_000, 2);
  });

  // ── lira-093 fix: CUSTOMER_ACCOUNT legs book 'Loto Debt' ──────────────────
  // Pre-fix, non-drawer legs were silently dropped: the ticket sold and the
  // supplier debt accrued, but the customer owed NOTHING anywhere.

  const debtRows = (database: Database.Database) =>
    database
      .prepare(
        `SELECT client_id, transaction_type, amount_usd, amount_lbp FROM debt_ledger`,
      )
      .all() as Array<{
      client_id: number;
      transaction_type: string;
      amount_usd: number;
      amount_lbp: number;
    }>;

  it("CUSTOMER_ACCOUNT leg books a 'Loto Debt' row and leaves the drawer untouched", () => {
    const lbpBefore = balance(db, "LBP");

    repo.createTicket({
      sale_amount: 150_000,
      commission_amount: 6_675,
      sale_date: "2026-07-04",
      payment_method: "CUSTOMER_ACCOUNT",
      currency: "LBP",
      userId: 1,
      clientId: 7,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 150_000 },
      ],
    });

    const rows = debtRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_type).toBe("Loto Debt");
    expect(rows[0].client_id).toBe(7);
    expect(rows[0].amount_lbp).toBe(150_000);
    expect(rows[0].amount_usd).toBe(0);
    // No cash changed hands.
    expect(balance(db, "LBP")).toBeCloseTo(lbpBefore, 2);
  });

  it("legacy single-payment CUSTOMER_ACCOUNT (no legs) books the full ticket as debt", () => {
    repo.createTicket({
      sale_amount: 200_000,
      commission_amount: 8_900,
      sale_date: "2026-07-04",
      payment_method: "CUSTOMER_ACCOUNT",
      currency: "LBP",
      userId: 1,
      clientId: 7,
    });

    const rows = debtRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_lbp).toBe(200_000);
  });

  it("CUSTOMER_ACCOUNT leg without a client is rejected", () => {
    expect(() =>
      repo.createTicket({
        sale_amount: 100_000,
        commission_amount: 4_450,
        sale_date: "2026-07-04",
        payment_method: "CUSTOMER_ACCOUNT",
        currency: "LBP",
        userId: 1,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 100_000 },
        ],
      }),
    ).toThrow(/without a client/);
  });
});
