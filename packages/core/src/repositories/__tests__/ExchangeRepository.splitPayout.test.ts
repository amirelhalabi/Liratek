/**
 * ExchangeRepository — split payout (owner-requested 2026-07-30)
 *
 * The shop can pay the customer's `amountOut` across several legs (e.g.
 * $100 + 11,050,000 LBP for one 20,000,000 LBP payout). Rules, mirroring the
 * app-wallet RECEIVE payout fix shipped the same day:
 *   - legs are reconciled hard-reject (S2, `reconcileLegs`) against
 *     `amountOut` in `toCurrency`, at the tender rate when provided;
 *   - each leg debits its OWN drawer in its OWN currency (§4 / lira-074);
 *   - no legs → the single-lump fallback (unchanged legacy behavior);
 *   - guards: USD/LBP target only, IN legs only, drawer methods only,
 *     never in for-partner mode.
 * Reversal owner (rule 20): the generic `_reversePayments` — per-leg payout
 * rows are ordinary payments rows, proven by the void test below.
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (mirrors ExchangeRepository.forPartner.test.ts) ─────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT
    );
    INSERT INTO users (id, username, role) VALUES (1, 'Admin', 'admin');

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

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
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
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
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
  return row ? row.balance : 0;
}

function seedPartner(db: Database.Database): number {
  const res = db
    .prepare("INSERT INTO partners (name, is_active) VALUES ('P1', 1)")
    .run();
  return Number(res.lastInsertRowid);
}

/** The owner's shape: USD→LBP, 222.22 USD in, 20,000,000 LBP out. */
const BASE_TX = {
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 222.22,
  amountOut: 20_000_000,
  leg1Rate: 90_000,
  leg1MarketRate: 89_750,
  leg1ProfitUsd: 0.62,
  totalProfitUsd: 0.62,
};

describe("ExchangeRepository — split payout", () => {
  let db: Database.Database;
  let repo: ExchangeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new ExchangeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("posts EACH payout leg in its own currency ($100 + 11,050,000 LBP for a 20,000,000 LBP payout)", () => {
    repo.createTransaction({
      ...BASE_TX,
      // 100 × 89,500 + 11,050,000 = 20,000,000 exactly at the tender rate.
      tender_exchange_rate: 89_500,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 100 },
        { method: "CASH", currencyCode: "LBP", amount: 11_050_000 },
      ],
    });

    // Inflow +222.22 USD, payout leg −100 USD ⇒ net +122.22 USD.
    expect(balance(db, "General", "USD")).toBeCloseTo(122.22, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(-11_050_000, 2);

    // Identity: the payout is two legs, not one lump (rule 15).
    const outRows = db
      .prepare(
        "SELECT currency_code, amount FROM payments WHERE amount < 0 ORDER BY id ASC",
      )
      .all() as Array<{ currency_code: string; amount: number }>;
    expect(outRows).toEqual([
      expect.objectContaining({ currency_code: "USD", amount: -100 }),
      expect.objectContaining({ currency_code: "LBP", amount: -11_050_000 }),
    ]);
  });

  it("hard-rejects legs that do not sum to amountOut, rolling back everything (S2)", () => {
    expect(() =>
      repo.createTransaction({
        ...BASE_TX,
        tender_exchange_rate: 89_500,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 100 },
          { method: "CASH", currencyCode: "LBP", amount: 10_000_000 }, // short
        ],
      }),
    ).toThrow(/do not reconcile/);

    expect(balance(db, "General", "USD")).toBe(0);
    expect(balance(db, "General", "LBP")).toBe(0);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM exchange_transactions").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it("rejects OUT-direction legs — an exchange payout has no return legs", () => {
    expect(() =>
      repo.createTransaction({
        ...BASE_TX,
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: 20_000_000 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 1_000_000,
            direction: "OUT" as const,
          },
        ],
      }),
    ).toThrow(/no return legs/);
  });

  it("rejects non-drawer methods (CUSTOMER_ACCOUNT) — exchange has no client_id to credit", () => {
    expect(() =>
      repo.createTransaction({
        ...BASE_TX,
        payments: [
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "LBP",
            amount: 20_000_000,
          },
        ],
      }),
    ).toThrow(/not supported/);
  });

  it("rejects a split payout on an exotic target currency (reconciliation is USD/LBP-native)", () => {
    expect(() =>
      repo.createTransaction({
        ...BASE_TX,
        toCurrency: "EUR",
        amountOut: 190,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 190 }],
      }),
    ).toThrow(/USD or LBP/);
  });

  it("rejects payout legs in for-partner mode — the disbursement books as the single outflow", () => {
    const partnerId = seedPartner(db);
    expect(() =>
      repo.createTransaction({
        ...BASE_TX,
        partnerId,
        partnerMode: "FOR",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 20_000_000 }],
      }),
    ).toThrow(/no payout legs/);
  });

  it("no legs → the single-lump fallback is unchanged (legacy/scripted callers)", () => {
    repo.createTransaction({ ...BASE_TX });

    expect(balance(db, "General", "USD")).toBeCloseTo(222.22, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(-20_000_000, 2);
    const outRows = db
      .prepare("SELECT COUNT(*) AS n FROM payments WHERE amount < 0")
      .get() as { n: number };
    expect(outRows.n).toBe(1);
  });

  it("create + void nets every drawer to 0, per currency (rule 20 — generic _reversePayments owns the legs)", () => {
    const { id } = repo.createTransaction({
      ...BASE_TX,
      tender_exchange_rate: 89_500,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 100 },
        { method: "CASH", currencyCode: "LBP", amount: 11_050_000 },
      ],
    });

    const txn = db
      .prepare(
        "SELECT id FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ?",
      )
      .get(id) as { id: number };
    getTransactionRepository().voidTransaction(txn.id, 1);

    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(0, 2);
  });
});
