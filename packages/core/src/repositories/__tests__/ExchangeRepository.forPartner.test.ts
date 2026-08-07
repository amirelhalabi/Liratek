/**
 * ExchangeRepository — LIRA-081 "For Partner" tests
 *
 * PFT-R model (owner-equivalent to every other FOR_% flow, verified against
 * ProfitRepository's PFT-6 deferral): a for-partner exchange takes NO counter
 * cash. The partner stands in for the walk-in customer — they owe exactly
 * what a customer would have paid (`amountIn` of `fromCurrency`) — while the
 * shop still disburses `amountOut` of `toCurrency` for real. The
 * discriminating test below (`create -> settle`) proves this is the ONLY
 * model consistent with the stamped profit: after the partner settles, the
 * shop's net cash position must be byte-identical to a normal walk-in
 * exchange of the same amounts.
 */

import Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import { getPartnerRepository } from "../PartnerRepository";
import { getProfitRepository } from "../ProfitRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ─────────────────────────────────────────────────────────

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
    -- table unconditionally with no existence check. EXCHANGE transactions
    -- never write module-charge debt, but the table must exist.
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
    );

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

function seedPartner(db: Database.Database, name = "Exchange Partner"): number {
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

const WIDE_RANGE: [string, string] = [
  "2020-01-01 00:00:00",
  "2030-01-01 23:59:59",
];

describe("ExchangeRepository.createTransaction() — for-partner (LIRA-081)", () => {
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

  it("skips the fromCurrency IN leg, keeps the toCurrency OUT leg for real, and books a FOR_EXCHANGE DEBIT for amountIn/fromCurrency", () => {
    const partnerId = seedPartner(db);

    const { id } = repo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9_000_000,
      leg1Rate: 90_000,
      leg1MarketRate: 90_000,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
      partnerId,
      partnerMode: "FOR",
    });

    // No customer cash: General/USD is untouched.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
    // Real disbursement: General/LBP decreases by the full amountOut.
    expect(balance(db, "General", "LBP")).toBeCloseTo(-9_000_000, 0);

    // Exactly one partner_ledger row: FOR_EXCHANGE DEBIT, amountIn/fromCurrency.
    const entries = db
      .prepare("SELECT * FROM partner_ledger WHERE partner_id = ?")
      .all(partnerId) as any[];
    expect(entries).toHaveLength(1);
    expect(entries[0].transaction_type).toBe("FOR_EXCHANGE");
    expect(entries[0].direction).toBe("DEBIT");
    expect(entries[0].amount).toBeCloseTo(100, 2);
    expect(entries[0].currency).toBe("USD");
    expect(entries[0].reference_table).toBe("exchange_transactions");
    expect(entries[0].reference_id).toBe(id);

    // Unified transaction row: profit stamped as usual, labeled with the partner.
    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'EXCHANGE'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.profit_usd).toBeCloseTo(5, 2);
    expect(txn.client_name).toBe("Exchange Partner [partner]");

    // Only ONE payment row was written (the toCurrency OUT leg) — no IN leg.
    const payments = db.prepare("SELECT * FROM payments").all() as any[];
    expect(payments).toHaveLength(1);
    expect(payments[0].currency_code).toBe("LBP");
    expect(payments[0].amount).toBeCloseTo(-9_000_000, 0);
  });

  it("rejects a for-partner exchange with no partnerId", () => {
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
        partnerMode: "FOR",
      }),
    ).toThrow(/partnerId is required/);

    // Nothing was written — the throw rolled back the whole db.transaction.
    expect(
      (db.prepare("SELECT COUNT(*) c FROM exchange_transactions").get() as any)
        .c,
    ).toBe(0);
    expect(balance(db, "General", "LBP")).toBeCloseTo(0, 2);
  });

  it("rejects a for-partner exchange whose fromCurrency is not USD/LBP", () => {
    const partnerId = seedPartner(db);

    expect(() =>
      repo.createTransaction({
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 100,
        amountOut: 108,
        leg1Rate: 1.08,
        leg1MarketRate: 1.08,
        leg1ProfitUsd: 2,
        totalProfitUsd: 2,
        partnerId,
        partnerMode: "FOR",
      }),
    ).toThrow(/Partner debt must be USD or LBP/);

    expect(
      (db.prepare("SELECT COUNT(*) c FROM exchange_transactions").get() as any)
        .c,
    ).toBe(0);
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
  });

  it("voiding a for-partner exchange restores the drawer and nets the partner ledger to 0", () => {
    const partnerId = seedPartner(db);

    repo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9_000_000,
      leg1Rate: 90_000,
      leg1MarketRate: 90_000,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
      partnerId,
      partnerMode: "FOR",
    });

    expect(balance(db, "General", "LBP")).toBeCloseTo(-9_000_000, 0);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTransactionRepository } = require("../TransactionRepository");
    const txnRepo = getTransactionRepository();
    const original = db
      .prepare("SELECT * FROM transactions WHERE type = 'EXCHANGE'")
      .get() as any;

    txnRepo.voidTransaction(original.id, 1);

    // Drawer restored — net effect of create + void is 0.
    expect(balance(db, "General", "LBP")).toBeCloseTo(0, 0);
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);

    // Partner ledger nets to 0 for this exchange (DEBIT 100 + CREDIT 100).
    const rows = db
      .prepare(
        "SELECT direction, amount, currency FROM partner_ledger WHERE partner_id = ?",
      )
      .all(partnerId) as any[];
    expect(rows).toHaveLength(2);
    const net = rows.reduce(
      (sum, r) => sum + (r.direction === "DEBIT" ? r.amount : -r.amount),
      0,
    );
    expect(net).toBeCloseTo(0, 2);
  });

  it("DISCRIMINATING TEST (rule 17 / advisor): after the partner settles, the shop's net cash position matches a normal walk-in exchange of the same amounts — proving profit is realized only once, not phantom", () => {
    const partnerId = seedPartner(db);

    repo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9_000_000,
      leg1Rate: 90_000,
      leg1MarketRate: 90_000,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
      partnerId,
      partnerMode: "FOR",
    });

    // Immediately after creation: only the toCurrency leg moved.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(-9_000_000, 0);

    // PFT-6 deferral: profit is NOT yet realized (partner hasn't settled).
    const profitRepo = getProfitRepository();
    const beforeSettle = profitRepo.getExchangeTotals(...WIDE_RANGE);
    expect(beforeSettle.profit_usd).toBeCloseTo(0, 2);

    // Partner settles in cash (pays the shop the $100 they owed).
    const partnerRepo = getPartnerRepository();
    const entry = partnerRepo.addLedgerEntry({
      partner_id: partnerId,
      transaction_type: "SETTLEMENT",
      amount: 100,
      currency: "USD",
      direction: "CREDIT",
      user_id: 1,
      settlement_method: "CASH",
    });
    partnerRepo.recordSettlementMoneyMovement(entry, 1);

    // Net cash position after create + settle == a normal walk-in exchange of
    // the same amounts (General USD +100, General LBP -9,000,000). A
    // "partner owes amountOut/toCurrency" model would instead return
    // General/LBP to 0 and leave General/USD untouched — losing the $100
    // spread entirely. This is what pins the model.
    expect(balance(db, "General", "USD")).toBeCloseTo(100, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(-9_000_000, 0);

    // Profit is now realized.
    const afterSettle = profitRepo.getExchangeTotals(...WIDE_RANGE);
    expect(afterSettle.profit_usd).toBeCloseTo(5, 2);
  });
});
