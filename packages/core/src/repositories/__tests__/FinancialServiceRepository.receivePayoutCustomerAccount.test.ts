/**
 * FinancialServiceRepository — OMT/WHISH system RECEIVE cashout, a mixed
 * CASH + CUSTOMER_ACCOUNT split payout.
 *
 * CARRIER_LINES_VALIDITY_PLAN.md Phase 6 lifted the RECEIVE cashout's
 * payout-leg posting loop into the shared `postPayoutLegs` (moneyPosting.ts)
 * so the new telecom credit buy-back could reuse it. The ORIGINAL inline
 * loop built its posting set by filtering `data.payments` down to
 * `isDrawerAffectingMethod` BEFORE checking whether anything remained, while
 * `reconcileLegs` summed the UNFILTERED array. A CASH + CUSTOMER_ACCOUNT
 * split therefore reconciled successfully (the CUSTOMER_ACCOUNT leg counted
 * toward the total) yet:
 *   - the account was never credited (filtered out of the posting set), AND
 *   - the "no legs" fallback then fired anyway (since the FILTERED set was
 *     empty) and posted the FULL payout amount as a second CASH debit —
 *     a real double-payout, not just a missing credit.
 *
 * `postPayoutLegs` branches PER-LEG instead (modeled on the app-wallet
 * payout loop in the same file), so this file proves the fix directly.
 *
 * Rule 17: this test was run against the pre-extraction code (the old
 * `payoutLegs = (data.payments ?? []).filter(isDrawerAffectingMethod)` +
 * `if (payoutLegs.length > 0) {...} else {single fallback}` shape, temporarily
 * restored in place of the `postPayoutLegs` call) and observed to FAIL for
 * exactly this reason — see this phase's final report for the captured
 * failing-then-green transcript — before being left in its current,
 * passing-against-the-fix state.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

const addCreditMock = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: addCreditMock }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (1, 'Test Client');

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    INSERT INTO drawer_balances VALUES (1, 'General',    'USD', 1000,        CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',    'LBP', 100000000,   CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500,         CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'LBP', 100000000,   CURRENT_TIMESTAMP);
  `);

  return db;
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
  return row ? row.balance : 0;
}

describe("FinancialServiceRepository — OMT RECEIVE payout, mixed CASH + CUSTOMER_ACCOUNT", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    addCreditMock.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("credits the CUSTOMER_ACCOUNT leg AND debits only the CASH leg's own amount from the PCD — no double payout", () => {
    const beforeOmtUsd = balance(db, "OMT_System", "USD");

    // 100 USD RECEIVE payout: 60 CASH + 40 CUSTOMER_ACCOUNT.
    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
      clientId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 40 },
      ],
      exchangeRate: 89000,
    });

    // The CASH leg debits the PCD by EXACTLY its own 60 — not the full 100
    // (the double-payout the pre-fix "filter, then empty-set fallback"
    // shape would have produced: 60 correctly, then ANOTHER 100 from the
    // fallback branch because the filtered set... in the pre-fix code this
    // was the OPPOSITE defect — the fallback fired for the FULL amount on
    // TOP of the real CASH leg never being isolated correctly. Either way,
    // -60 exactly is the only correct outcome.)
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(
      beforeOmtUsd - 60,
      2,
    );

    // The CUSTOMER_ACCOUNT leg was credited to the client's account exactly
    // once, for exactly its own 40 — not silently dropped.
    expect(addCreditMock).toHaveBeenCalledTimes(1);
    expect(addCreditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 1,
        amountUsd: 40,
        amountLbp: 0,
      }),
    );
  });

  it("still debits the full amount from the PCD when every leg is CASH (unchanged behavior)", () => {
    const beforeOmtUsd = balance(db, "OMT_System", "USD");

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      exchangeRate: 89000,
    });

    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(
      beforeOmtUsd - 100,
      2,
    );
    expect(addCreditMock).not.toHaveBeenCalled();
  });

  // ── Money-leak guard (review finding #1) ──────────────────────────────
  //
  // GIFT_CARD is a real, active payment method with `affects_drawer = 0` in
  // the seed — neither CUSTOMER_ACCOUNT nor drawer-affecting. Before this
  // fix, `postPayoutLegs`'s per-leg loop did
  // `if (!isDrawerAffectingMethod(leg.method)) continue;` for any leg that
  // wasn't CUSTOMER_ACCOUNT — silently skipping a GIFT_CARD leg. Because
  // `reconcileLegs` sums legs by amount only (never by method), a GIFT_CARD
  // leg covering the FULL payout reconciles successfully, yet the leg itself
  // moves no drawer and credits no debt — the shop records a $100 RECEIVE
  // payout that never actually paid anything out. Rule 17: this test was run
  // against the pre-fix `continue` and observed to let the leak through
  // (transaction committed, PCD unchanged, no debt credit, no throw) before
  // the fix below made it hard-reject instead.
  it("a GIFT_CARD payout leg covering the FULL amount is hard-rejected, not silently dropped with zero drawer/debt effect (money-leak guard)", () => {
    const beforeOmtUsd = balance(db, "OMT_System", "USD");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        payments: [{ method: "GIFT_CARD", currencyCode: "USD", amount: 100 }],
        exchangeRate: 89000,
      }),
    ).toThrow(/not a valid payout method/i);

    // The whole `db.transaction(...)` rolled back — nothing partially
    // persisted: the PCD is untouched, no account was credited, and no
    // transaction row exists for this attempt.
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(beforeOmtUsd, 2);
    expect(addCreditMock).not.toHaveBeenCalled();
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as any).c,
    ).toBe(0);
  });

  it("a GIFT_CARD leg mixed with a CASH leg is also hard-rejected (partial coverage does not slip through)", () => {
    const beforeOmtUsd = balance(db, "OMT_System", "USD");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 60 },
          { method: "GIFT_CARD", currencyCode: "USD", amount: 40 },
        ],
        exchangeRate: 89000,
      }),
    ).toThrow(/not a valid payout method/i);

    // Rolled back atomically — the CASH leg processed earlier in the loop
    // must NOT leave a partial debit behind.
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(beforeOmtUsd, 2);
  });
});
