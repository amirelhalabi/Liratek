/**
 * ServiceStoreCreditReversal — service-created store-credit rows get a named
 * reversal owner (CLAUDE.md rule 20; owner-reported real-money leak).
 *
 * `DebtRepository.addCredit` wrote a 'CREDIT_DEPOSIT' debt_ledger row WITHOUT
 * linking it to the enclosing unified transaction. Three FinancialService
 * flows (a RECEIVE cashed out to CUSTOMER_ACCOUNT, a SEND with a
 * CUSTOMER_ACCOUNT change-return leg, and the Binance/app-wallet equivalent)
 * — plus RechargeRepository/SalesRepository/CustomServiceRepository/
 * DebtRepository.addRepayment's own change-return legs — all created these
 * unlinked credit rows. Because `transaction_id` was never set, the generic
 * void/refund (`TransactionRepository._cancelDebt`) could reverse the
 * drawers and payment legs but had no way to find the credit — so the
 * customer kept the store credit for free.
 *
 * Fix: `DebtRepository.addCredit`/`DebtService.addCredit` accept an optional
 * `transactionId`; every flow-embedded call site now passes it (the same
 * `txnId` already in scope); `_cancelDebt` locally widens its scan to
 * `[...MODULE_DEBT_TRANSACTION_TYPES, 'CREDIT_DEPOSIT']` (kept OUT of the
 * exported, guarded whitelist — see constants/transactionTypes.ts's doc).
 *
 * Every "pre-fix" case here FAILS on the pre-fix code (CLAUDE.md rule 17) —
 * see the verbatim pre-fix run captured in the PR/task report.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { TransactionRepository } from "../TransactionRepository";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CLIENT_ID = 501;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role     TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      notes        TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number, tenant_id)
      VALUES (${CLIENT_ID}, 'Store Credit Client', '70000000', 1);

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0
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
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General',    'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General',    'LBP', 100000000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_System', 'USD', 5000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_App',    'USD', 500);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Binance',    'USDT', 500);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  return db;
}

function setTestDb(db: Database.Database): void {
  (
    globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
  ).__LIRATEK_TEST_DB__ = db;
}

function clearTestDb(): void {
  delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database })
    .__LIRATEK_TEST_DB__;
}

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function clientBalance(
  db: Database.Database,
  clientId: number,
): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(clientId) as { usd: number; lbp: number };
  return row;
}

function creditRows(
  db: Database.Database,
  clientId: number,
): Array<{
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  transaction_id: number | null;
}> {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp, transaction_id
       FROM debt_ledger WHERE client_id = ? ORDER BY id ASC`,
    )
    .all(clientId) as Array<{
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    transaction_id: number | null;
  }>;
}

/** The unified transactions.id for a given financial_services row — createTransaction()
 *  returns the financial_services.id, not the unified transaction id. */
function txnIdFor(db: Database.Database, financialServiceId: number): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
    )
    .get(financialServiceId) as { id: number };
  return row.id;
}

describe("ServiceStoreCreditReversal — CUSTOMER_ACCOUNT credit rows get a named reversal owner (rule 20)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetDebtService();
    resetDebtRepository();
    fsRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
    resetDebtService();
    resetDebtRepository();
    resetTenantContext();
  });

  // ── (a) RECEIVE cashed out to CUSTOMER_ACCOUNT (OMT, useSystemDrawerFlow) ──

  it("(a-void) OMT RECEIVE cashed to CUSTOMER_ACCOUNT: void restores the credit to 0 and OMT_System nets to 0", () => {
    const omtBefore = drawer(db, "OMT_System", "USD");

    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -100, lbp: 0 });
    // primary-cash-drawer model (2026-07-30): a RECEIVE cashed out ENTIRELY
    // to CUSTOMER_ACCOUNT moves no banknotes at all — there is no payout
    // CASH leg (the whole `x=100` becomes a receivable, per the invariant's
    // receivable term, §8.4/FEATURE_GUIDE §8.1) and no fee was charged
    // (`commission: 0`, no `omtFee`), so no fee leg lands in the PCD either.
    // The PCD (OMT_System) is real physical cash — with zero cash legs, it
    // must read UNCHANGED at omtBefore. (Was, float model, superseded: the
    // float unconditionally filled back UP by the bare principal on every
    // RECEIVE, including CUSTOMER_ACCOUNT cashouts that skip only the payout
    // DRAWER debit, not the system posting — so it read omtBefore + 100.)
    // rule 17: this file's PRE-existing assertion (`omtBefore + 100`) was run
    // against the implemented primary-cash-drawer production code and
    // observed to fail with `Received: 5000` (== omtBefore, unchanged) —
    // i.e. the old float-model expectation is red under the current
    // implementation, and "unchanged" is what the implementation actually
    // does for a cash-free CUSTOMER_ACCOUNT RECEIVE (verified by running
    // this suite, not re-derived by hand alone).
    expect(drawer(db, "OMT_System", "USD")).toBeCloseTo(omtBefore, 2);

    txnRepo.voidTransaction(txnId, 1);

    // Pre-fix: this fails — the credit stays at -100 (customer keeps $100 for free).
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "OMT_System", "USD")).toBeCloseTo(omtBefore, 2);
  });

  it("(a-refund) OMT RECEIVE cashed to CUSTOMER_ACCOUNT: refund restores the credit to 0 and OMT_System nets to 0", () => {
    const omtBefore = drawer(db, "OMT_System", "USD");

    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    txnRepo.refundTransaction(txnId, 1);

    // Pre-fix: this fails — the credit stays at -100.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "OMT_System", "USD")).toBeCloseTo(omtBefore, 2);
  });

  // ── (b) SEND with a CUSTOMER_ACCOUNT change-return leg (OMT_APP wallet transfer) ──

  it("(b-void) OMT_APP SEND with change kept as CUSTOMER_ACCOUNT credit: void restores the credit and both drawers net to 0", () => {
    const walletBefore = drawer(db, "OMT_App", "USD");
    const generalBefore = drawer(db, "General", "USD");

    // $20 transfer, customer hands over $25 cash, $5 change kept on account.
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -5, lbp: 0 });
    expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(walletBefore - 20, 2);
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore + 25, 2);

    txnRepo.voidTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $5 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(walletBefore, 2);
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
  });

  it("(b-refund) OMT_APP SEND with change kept as CUSTOMER_ACCOUNT credit: refund restores the credit and both drawers net to 0", () => {
    const walletBefore = drawer(db, "OMT_App", "USD");
    const generalBefore = drawer(db, "General", "USD");

    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    txnRepo.refundTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $5 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(walletBefore, 2);
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
  });

  // ── (c) Binance/app-wallet RECEIVE cashed out to CUSTOMER_ACCOUNT ──

  it("(c-void) BINANCE RECEIVE cashed to CUSTOMER_ACCOUNT: void restores the credit and Binance drawer nets to 0", () => {
    const binanceBefore = drawer(db, "Binance", "USDT");

    const { id: fsId } = fsRepo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 50,
      currency: "USDT",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -50, lbp: 0 });
    expect(drawer(db, "Binance", "USDT")).toBeCloseTo(binanceBefore + 50, 2);

    txnRepo.voidTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $50 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "Binance", "USDT")).toBeCloseTo(binanceBefore, 2);
  });

  it("(c-refund) BINANCE RECEIVE cashed to CUSTOMER_ACCOUNT: refund restores the credit and Binance drawer nets to 0", () => {
    const binanceBefore = drawer(db, "Binance", "USDT");

    const { id: fsId } = fsRepo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 50,
      currency: "USDT",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    txnRepo.refundTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $50 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "Binance", "USDT")).toBeCloseTo(binanceBefore, 2);
  });

  // ── (d) Negative control: a standalone/manual credit (no transaction) ──

  // Deliberately independent of whether the primary fix (transactionId
  // linking) is applied: this proves the reversal is surgical by construction
  // (transaction_id = NULL never matches `transaction_id = ?`), not merely
  // as a side effect of the main bug also being unfixed. The reversible
  // transaction here is a plain CASH cashout (no CUSTOMER_ACCOUNT leg of its
  // own), so the manual credit is the ONLY debt_ledger row this client has —
  // isolating the assertion from the (a)/(b)/(c) bug entirely.
  it("(d) negative control: a manual credit added with NO transactionId is untouched by voiding an unrelated transaction for the same client", () => {
    // Simulates the Accounts-page "add credit" action (debtHandlers.ts /
    // backend/src/api/debts.ts), which never passes a transactionId.
    const manual = getDebtService().addCredit({
      clientId: CLIENT_ID,
      amountUsd: 40,
      amountLbp: 0,
      note: "Manual goodwill credit",
      userId: 1,
    });
    expect(manual.success).toBe(true);
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -40, lbp: 0 });

    // A normal CASH cashout — reversible, but books no debt_ledger row at all.
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    txnRepo.voidTransaction(txnId, 1);

    // The manual $40 credit is completely untouched — same amount, same NULL link.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -40, lbp: 0 });

    const rows = creditRows(db, CLIENT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_usd).toBe(-40);
    expect(rows[0].transaction_id).toBeNull();
    expect(rows[0].transaction_type).toBe("CREDIT_DEPOSIT");
  });

  // ── (e) Double-reverse safety ──

  it("(e) double-reverse safety: voiding twice throws on the second attempt and does not double-cancel the credit", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    txnRepo.voidTransaction(txnId, 1);
    // Pre-fix: this fails — balance is still -100 after the first void.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });

    expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
      "Transaction is already voided",
    );
    // Still exactly 0 — the guard refused before any second reversal row could
    // be written; the credit was not un-cancelled or double-cancelled.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });

    const rows = creditRows(db, CLIENT_ID).filter(
      (r) => r.transaction_type === "Refund Reversal",
    );
    expect(rows).toHaveLength(1);
  });

  it("(e-refund) double-reverse safety: refunding twice throws on the second attempt and does not double-cancel the credit", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
    });
    const txnId = txnIdFor(db, fsId);

    txnRepo.refundTransaction(txnId, 1);
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });

    expect(() => txnRepo.refundTransaction(txnId, 1)).toThrow(
      "Transaction has already been refunded",
    );
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });

    const rows = creditRows(db, CLIENT_ID).filter(
      (r) => r.transaction_type === "Refund Reversal",
    );
    expect(rows).toHaveLength(1);
  });
});
