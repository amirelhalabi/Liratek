/**
 * RechargeRepository — FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2.
 *
 * Slice 1 (cc45227) tightened `assertNoCounterPayment` to require the
 * caller's REAL legacy single-payment field as an explicit second argument
 * — closing the omission by construction — but left this repo passing
 * `undefined` as a mechanical, zero-behavior-change placeholder ("wiring in
 * `data.paid_by_method` is a later slice's fix, not this one's").
 *
 * THE GAP this file proves closed: `data.paid_by_method` is read
 * independently by the walk-in single-payment fallback (the `paidBy` local
 * inside `processRecharge`) and is ALSO stamped into
 * `metadata_json.paid_by`/`recharges.paid_by` at row-creation time —
 * REGARDLESS of `isForPartner`. Nothing before slice 2 folded it into
 * `inPayments`, so a stale non-CASH value left over from before the operator
 * ticked "For Partner" (e.g. "CUSTOMER_ACCOUNT") sailed through: the
 * transaction succeeded, no customer account was ever credited, yet the
 * audit trail recorded a payment method that never executed — the exact
 * LIRA-114 bug class, for this repo's own field.
 *
 * No jest fixture previously exercised RechargeRepository's FOR-partner
 * dispatch at all (moneyPosting.ts's CQ-4 comment notes this — only e2e
 * lira-115 covers it, and that spec never sends `paid_by_method`). This file
 * is new coverage, not a rewrite of an existing characterization test.
 *
 * Rule 17: every REJECTS case below was run against the pre-slice-2 source
 * (`assertNoCounterPayment(inPayments.length > 0, undefined, "recharge")`)
 * and observed to NOT throw — confirming this was a live gap, not a stale
 * comment. Reverted after observing the failure.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";

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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier                TEXT NOT NULL,
      recharge_type          TEXT NOT NULL,
      amount                 REAL NOT NULL,
      cost                   REAL NOT NULL DEFAULT 0,
      price                  REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code          TEXT DEFAULT 'USD',
      paid_by                TEXT DEFAULT 'CASH',
      phone_number           TEXT,
      client_id              INTEGER,
      client_name            TEXT,
      note                   TEXT,
      created_by             INTEGER DEFAULT 1,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by              TEXT,
      edited_at              TEXT
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      phone       TEXT,
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id       INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table  TEXT,
      reference_id     INTEGER,
      amount           REAL NOT NULL,
      currency         TEXT NOT NULL DEFAULT 'USD',
      direction        TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes            TEXT,
      user_id          INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount   REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id    INTEGER,
      client_name  TEXT,
      client_phone TEXT,
      reverses_id  INTEGER,
      profit_usd   REAL NOT NULL DEFAULT 0,
      profit_lbp   REAL NOT NULL DEFAULT 0,
      summary      TEXT,
      metadata_json TEXT,
      device_id    TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      to_code    TEXT,
      sell_rate  REAL,
      market_rate REAL
    );
    INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 500000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

function seedPartner(db: Database.Database, name = "TestPartner"): number {
  return Number(
    db.prepare("INSERT INTO partners (name) VALUES (?)").run(name)
      .lastInsertRowid,
  );
}

function partnerLedgerRows(db: Database.Database, partnerId: number) {
  return db
    .prepare("SELECT * FROM partner_ledger WHERE partner_id = ? ORDER BY id")
    .all(partnerId) as Array<{ direction: string; amount: number }>;
}

function drawerBalance(
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

function rechargeRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM recharges").get() as { n: number }
  ).n;
}

describe("RechargeRepository — §3 slice 2: legacy paid_by_method wiring under FOR-partner", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetPartnerRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
    resetPartnerRepository();
  });

  it("rejects a stale CUSTOMER_ACCOUNT paid_by_method on a FOR-partner recharge (dead legacy field — no walk-in customer to credit)", () => {
    const partnerId = seedPartner(db);
    const before = rechargeRowCount(db);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5,
      price: 6,
      currency: "USD",
      phoneNumber: "03000199",
      paid_by_method: "CUSTOMER_ACCOUNT",
      payments: [],
      partnerId,
      partnerMode: "FOR",
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/customer account/i);
    // Atomic: nothing committed.
    expect(rechargeRowCount(db)).toBe(before);
  });

  it("rejects a stale non-CASH paid_by_method (e.g. a wallet method) on a FOR-partner recharge — the branch takes the full price straight to partner_ledger, no drawer leg of any kind", () => {
    const partnerId = seedPartner(db);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5,
      price: 6,
      currency: "USD",
      phoneNumber: "03000198",
      paid_by_method: "OMT",
      payments: [],
      partnerId,
      partnerMode: "FOR",
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/no counter payment/i);
  });

  it("does NOT over-block a legitimate FOR-partner recharge — the real TelecomForm.tsx payload (paid_by_method omitted, payments: []) still succeeds and books the partner ledger", () => {
    const partnerId = seedPartner(db);
    const generalBefore = drawerBalance(db, "General", "USD");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5,
      price: 6,
      currency: "USD",
      phoneNumber: "03000197",
      // paid_by_method intentionally omitted — mirrors TelecomForm.tsx's
      // handleForPartnerSubmit, which never sends this field.
      payments: [],
      partnerId,
      partnerMode: "FOR",
      userId: 1,
    });

    expect(result.success).toBe(true);
    // No walk-in cash — General is untouched.
    expect(drawerBalance(db, "General", "USD")).toBe(generalBefore);

    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("DEBIT");
    expect(entries[0].amount).toBeCloseTo(6, 2);
  });

  it("does NOT over-block an explicit CASH paid_by_method under FOR-partner (the neutral default every legacy field falls back to)", () => {
    const partnerId = seedPartner(db);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5,
      price: 6,
      currency: "USD",
      phoneNumber: "03000196",
      paid_by_method: "CASH",
      payments: [],
      partnerId,
      partnerMode: "FOR",
      userId: 1,
    });

    expect(result.success).toBe(true);
  });
});
