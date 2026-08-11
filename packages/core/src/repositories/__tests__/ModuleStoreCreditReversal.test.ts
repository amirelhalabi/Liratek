/**
 * ModuleStoreCreditReversal — closes the rule-17 coverage gap left by
 * ServiceStoreCreditReversal.test.ts.
 *
 * The store-credit reversal fix (CLAUDE.md rule 20; `DebtRepository.addCredit`
 * / `DebtService.addCredit` accepting an optional `transactionId`, threaded
 * through `TransactionRepository._cancelDebt`'s widened
 * `[...MODULE_DEBT_TRANSACTION_TYPES, 'CREDIT_DEPOSIT']` scan) touched ~7 call
 * sites. `ServiceStoreCreditReversal.test.ts` exercises only the 3 inside
 * `FinancialServiceRepository`; a separate verifier proved `SalesRepository`.
 * These three were backed ONLY by code symmetry, with no executable test:
 *
 *   - `RechargeRepository.processRecharge`      — return-leg loop, CUSTOMER_ACCOUNT
 *     change kept as credit (~line 1028).
 *   - `CustomServiceRepository.createService`   — non-drawer OUT leg, change
 *     kept on account (~line 364).
 *   - `DebtRepository.addRepayment`             — overpayment kept as credit
 *     (~line 584).
 *
 * Each case here proves, per CLAUDE.md rule 17, that it FAILS on the pre-fix
 * code (the one `transactionId: txnId` argument removed from that flow's
 * `addCredit`/`this.addCredit` call) — see the verbatim pre-fix run captured
 * in the task report — then passes once restored.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { TransactionRepository } from "../TransactionRepository";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CLIENT_ID = 601;

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
      VALUES (${CLIENT_ID}, 'Module Credit Client', '71000000', 1);

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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 100000000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC',     'USD', 5000);

    -- Full production shape (covered_usd/covered_lbp, is_refunded) — needed
    -- by DebtRepository.addRepayment's FIFO coverage + _cancelDebt's widened
    -- CREDIT_DEPOSIT scan + _restoreRepaymentDebt's give-back.
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
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty in every test here — only exists so DebtRepository.addRepayment's
    -- Service-Debt routing query (JOIN financial_services) doesn't fail with
    -- "no such table: financial_services".
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- Empty in every test here — only exists so DebtRepository's FIFO
    -- coverage queries (_markSalesPaidFIFO / _unwindSalesPaidFifo) don't
    -- fail with "no such table: sales".
    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER DEFAULT 1,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      status                 TEXT NOT NULL DEFAULT 'completed',
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER DEFAULT 1,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  REAL NOT NULL,
      cost                    REAL NOT NULL DEFAULT 0,
      price                   REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL DEFAULT NULL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by                TEXT DEFAULT NULL,
      edited_at                TEXT DEFAULT NULL,
      is_refunded              INTEGER DEFAULT 0,
      refunded_at              TEXT DEFAULT NULL
    );

    CREATE TABLE custom_services (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER DEFAULT 1,
      description  TEXT NOT NULL,
      cost_usd     REAL NOT NULL DEFAULT 0,
      cost_lbp     REAL NOT NULL DEFAULT 0,
      price_usd    REAL NOT NULL DEFAULT 0,
      price_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd   REAL GENERATED ALWAYS AS (price_usd - cost_usd) STORED,
      profit_lbp   REAL GENERATED ALWAYS AS (price_lbp - cost_lbp) STORED,
      paid_by      TEXT NOT NULL DEFAULT 'CASH',
      status       TEXT NOT NULL DEFAULT 'completed',
      client_id    INTEGER,
      client_name  TEXT,
      phone_number TEXT,
      note         TEXT,
      category     TEXT DEFAULT NULL,
      created_by   INTEGER,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by    TEXT DEFAULT NULL,
      edited_at    TEXT DEFAULT NULL,
      is_refunded  INTEGER DEFAULT 0,
      refunded_at  TEXT DEFAULT NULL,
      product_id   INTEGER
    );
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

function journalRows(
  db: Database.Database,
  clientId: number,
): Array<{ transaction_type: string; amount_usd: number; amount_lbp: number }> {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp
       FROM debt_ledger WHERE client_id = ? ORDER BY id ASC`,
    )
    .all(clientId) as Array<{
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
  }>;
}

/** The unified transactions.id for a given (source_table, source_id) pair —
 *  createTransaction() returns the module's own row id, not the unified one. */
function txnIdFor(
  db: Database.Database,
  sourceTable: string,
  sourceId: number,
): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = ? AND source_id = ?`,
    )
    .get(sourceTable, sourceId) as { id: number };
  return row.id;
}

describe("ModuleStoreCreditReversal — RechargeRepository / CustomServiceRepository / DebtRepository.addRepayment CUSTOMER_ACCOUNT credit rows get a named reversal owner (rule 20)", () => {
  let db: Database.Database;
  let rechargeRepo: RechargeRepository;
  let customServiceRepo: CustomServiceRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetDebtService();
    resetDebtRepository();
    rechargeRepo = new RechargeRepository();
    customServiceRepo = new CustomServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
    resetDebtService();
    resetDebtRepository();
    resetTenantContext();
  });

  // ── (a) RechargeRepository.processRecharge — CUSTOMER_ACCOUNT return leg ──

  it("(a-void) MTC CREDIT_TRANSFER with $5 change kept as CUSTOMER_ACCOUNT credit: void restores the credit to 0 and General/MTC net to 0", () => {
    const generalBefore = drawer(db, "General", "USD");
    const mtcBefore = drawer(db, "MTC", "USD");

    // $20 recharge, customer hands over $25 cash, $5 change kept on account.
    const result = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 20,
      cost: 15,
      price: 20,
      currency: "USD",
      clientId: CLIENT_ID,
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
    });
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "recharges", result.id as number);

    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -5, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore + 25, 2);
    expect(drawer(db, "MTC", "USD")).toBeLessThan(mtcBefore);

    txnRepo.voidTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $5 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(mtcBefore, 2);

    // Journal model: original CREDIT_DEPOSIT row untouched, a separate
    // 'Refund Reversal' row appended — never mutated in place.
    const rows = journalRows(db, CLIENT_ID);
    const deposit = rows.find((r) => r.transaction_type === "CREDIT_DEPOSIT");
    const reversal = rows.find((r) => r.transaction_type === "Refund Reversal");
    expect(deposit?.amount_usd).toBe(-5);
    expect(reversal?.amount_usd).toBe(5);
  });

  it("(a-refund) MTC CREDIT_TRANSFER with $5 change kept as CUSTOMER_ACCOUNT credit: refund restores the credit to 0 and General/MTC net to 0", () => {
    const generalBefore = drawer(db, "General", "USD");
    const mtcBefore = drawer(db, "MTC", "USD");

    const result = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 20,
      cost: 15,
      price: 20,
      currency: "USD",
      clientId: CLIENT_ID,
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
    });
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "recharges", result.id as number);

    txnRepo.refundTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $5 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(mtcBefore, 2);

    const rows = journalRows(db, CLIENT_ID);
    const deposit = rows.find((r) => r.transaction_type === "CREDIT_DEPOSIT");
    const reversal = rows.find((r) => r.transaction_type === "Refund Reversal");
    expect(deposit?.amount_usd).toBe(-5);
    expect(reversal?.amount_usd).toBe(5);
  });

  // ── (b) CustomServiceRepository.createService — non-drawer OUT leg ──

  it("(b-void) Custom service with $5 change kept as CUSTOMER_ACCOUNT credit: void restores the credit to 0 and General nets to 0", () => {
    const generalBefore = drawer(db, "General", "USD");

    // $20 service, customer hands over $25 cash, $5 change kept on account.
    const result = customServiceRepo.createService(
      {
        description: "Phone repair",
        cost_usd: 10,
        cost_lbp: 0,
        price_usd: 20,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        client_id: CLIENT_ID,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 25 },
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 5,
            direction: "OUT",
          },
        ],
      },
      1,
    );
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "custom_services", result.id as number);

    // General nets +25 (CASH IN); §2 FINAL SPEC means cost_usd=10 never posts
    // a drawer movement, so the full $25 lands; the $5 change never touches
    // a drawer at all.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -5, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore + 25, 2);

    txnRepo.voidTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $5 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);

    const rows = journalRows(db, CLIENT_ID);
    const deposit = rows.find((r) => r.transaction_type === "CREDIT_DEPOSIT");
    const reversal = rows.find((r) => r.transaction_type === "Refund Reversal");
    expect(deposit?.amount_usd).toBe(-5);
    expect(reversal?.amount_usd).toBe(5);
  });

  it("(b-refund) Custom service with $5 change kept as CUSTOMER_ACCOUNT credit: refund restores the credit to 0 and General nets to 0", () => {
    const generalBefore = drawer(db, "General", "USD");

    const result = customServiceRepo.createService(
      {
        description: "Phone repair",
        cost_usd: 10,
        cost_lbp: 0,
        price_usd: 20,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        client_id: CLIENT_ID,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 25 },
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 5,
            direction: "OUT",
          },
        ],
      },
      1,
    );
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "custom_services", result.id as number);

    txnRepo.refundTransaction(txnId, 1);

    // Pre-fix: this fails — the customer keeps the $5 store credit.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);

    const rows = journalRows(db, CLIENT_ID);
    const deposit = rows.find((r) => r.transaction_type === "CREDIT_DEPOSIT");
    const reversal = rows.find((r) => r.transaction_type === "Refund Reversal");
    expect(deposit?.amount_usd).toBe(-5);
    expect(reversal?.amount_usd).toBe(5);
  });

  // ── (c) DebtRepository.addRepayment — overpayment kept as credit ──

  it("(c-void) Debt repayment overpaid by $5 kept as CUSTOMER_ACCOUNT credit: void restores the credit AND the repaid debt, General nets to 0", () => {
    const generalBefore = drawer(db, "General", "USD");

    // Client repays $20 of debt; hands over $25 cash; $5 overpayment kept as
    // store credit.
    const result = getDebtService().addRepayment({
      clientId: CLIENT_ID,
      amountUSD: 20,
      amountLBP: 0,
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
    });
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "debt_ledger", result.id as number);

    // -20 (Repayment) + -5 (CREDIT_DEPOSIT) = -25.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -25, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore + 25, 2);

    txnRepo.voidTransaction(txnId, 1);

    // Pre-fix: the CREDIT_DEPOSIT row survives the void, leaving the client's
    // balance at -5 instead of 0 (the $20 debt-reduction restore worked via
    // _restoreRepaymentDebt regardless — this isolates the CREDIT_DEPOSIT gap).
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);

    const rows = journalRows(db, CLIENT_ID);
    expect(
      rows.find((r) => r.transaction_type === "Repayment")?.amount_usd,
    ).toBe(-20);
    expect(
      rows.find((r) => r.transaction_type === "Repayment Reversal")?.amount_usd,
    ).toBe(20);
    const deposit = rows.find((r) => r.transaction_type === "CREDIT_DEPOSIT");
    const reversal = rows.find((r) => r.transaction_type === "Refund Reversal");
    expect(deposit?.amount_usd).toBe(-5);
    expect(reversal?.amount_usd).toBe(5);
  });

  it("(c-refund) Debt repayment overpaid by $5 kept as CUSTOMER_ACCOUNT credit: refund restores the credit AND the repaid debt, General nets to 0", () => {
    const generalBefore = drawer(db, "General", "USD");

    const result = getDebtService().addRepayment({
      clientId: CLIENT_ID,
      amountUSD: 20,
      amountLBP: 0,
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
    });
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "debt_ledger", result.id as number);

    txnRepo.refundTransaction(txnId, 1);

    // Pre-fix: the CREDIT_DEPOSIT row survives the refund.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: 0, lbp: 0 });
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);

    const rows = journalRows(db, CLIENT_ID);
    expect(
      rows.find((r) => r.transaction_type === "Repayment")?.amount_usd,
    ).toBe(-20);
    expect(
      rows.find((r) => r.transaction_type === "Repayment Reversal")?.amount_usd,
    ).toBe(20);
    const deposit = rows.find((r) => r.transaction_type === "CREDIT_DEPOSIT");
    const reversal = rows.find((r) => r.transaction_type === "Refund Reversal");
    expect(deposit?.amount_usd).toBe(-5);
    expect(reversal?.amount_usd).toBe(5);
  });

  // ── (d) Negative control: a manual credit is untouched by an unrelated void ──

  it("(d) negative control: a manual credit added with NO transactionId is untouched by voiding an unrelated recharge for the same client", () => {
    const manual = getDebtService().addCredit({
      clientId: CLIENT_ID,
      amountUsd: 40,
      amountLbp: 0,
      note: "Manual goodwill credit",
      userId: 1,
    });
    expect(manual.success).toBe(true);
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -40, lbp: 0 });

    // A normal CASH recharge — reversible, but books no debt_ledger row at all.
    const result = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 20,
      cost: 15,
      price: 20,
      currency: "USD",
      clientId: CLIENT_ID,
      userId: 1,
      paid_by_method: "CASH",
    });
    expect(result.success).toBe(true);
    const txnId = txnIdFor(db, "recharges", result.id as number);

    txnRepo.voidTransaction(txnId, 1);

    // The manual $40 credit is completely untouched.
    expect(clientBalance(db, CLIENT_ID)).toEqual({ usd: -40, lbp: 0 });
    const rows = journalRows(db, CLIENT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_usd).toBe(-40);
    expect(rows[0].transaction_type).toBe("CREDIT_DEPOSIT");
  });
});
