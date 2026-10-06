/**
 * LIRA-258 / POSTING_INTEGRITY_PLAN.md item 3.4 / POSTING_MAP.md G20 —
 * characterization: REFUNDING a parent whose auto sibling is cascaded.
 *
 * `_applyGenericItemReversal` (the refund path) calls the same
 * `_cascadeExpenseSiblingVoid` / `_cascadeSupplierSiblingVoid` helpers the
 * void path does, and those always reverse the hidden sibling with VOID
 * semantics (`_voidTransactionInternal`: sibling status VOIDED, reversal row
 * of the sibling's own type, profit 0) — never a REFUND row. G20 asked
 * whether that mismatch produces any wrong NUMBER or is a label only.
 *
 * This file pins the expense-sibling half (a real MTC CREDIT_TRANSFER with
 * its auto `SMS_Transfer_Fee` expense, refunded through the generic
 * `refundTransaction`). The supplier-sibling half lives in
 * TransactionRepository.supplierSiblingVoidCascade.test.ts case (e).
 *
 * NOT failing-first: these tests were written against the unchanged code and
 * passed on first run — they are characterization tests proving "label
 * only", not guards for a fix (rule 17 — stated plainly, nothing re-broken).
 *
 * Schema copied verbatim from RechargeRepository.creditSaleSmsFeeOnLine.test.ts.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { activeExpense } from "../ProfitRepository";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

const FUTURE_EXPIRY = "2099-01-01";

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

    CREATE TABLE system_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER NOT NULL DEFAULT 1,
      key_name   TEXT NOT NULL,
      value      TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, key_name)
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC',     'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Alfa',    'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 5000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 100000000);

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

    CREATE TABLE financial_services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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
      edited_at               TEXT DEFAULT NULL,
      is_refunded             INTEGER DEFAULT 0,
      refunded_at             TEXT DEFAULT NULL
    );

    CREATE TABLE expenses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      description       TEXT,
      category          TEXT,
      expense_type      TEXT,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      paid_by_method    TEXT DEFAULT 'CASH',
      status            TEXT NOT NULL DEFAULT 'active',
      expense_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
      note              TEXT DEFAULT NULL,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      source_ref_table  TEXT DEFAULT NULL,
      source_ref_id     INTEGER DEFAULT NULL,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed           INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      days_owed_delta               INTEGER NOT NULL DEFAULT 0,
      previous_days_owed            INTEGER NOT NULL DEFAULT 0,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
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

function getLineCredits(db: Database.Database, id: number): number {
  return (
    db.prepare(`SELECT credits FROM carrier_lines WHERE id = ?`).get(id) as {
      credits: number;
    }
  ).credits;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency = "USD",
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Σ profit stamped on ACTIVE unified rows, per currency — the shape every
 *  ProfitRepository module arm sums (`t.status = 'ACTIVE'`). */
function activeProfit(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
}

/** Σ expenses that still count, through the ONE production predicate. */
function activeExpenseTotal(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM expenses WHERE ${activeExpense("expenses")}`,
    )
    .get() as { usd: number; lbp: number };
}

/** Σ unified-row amounts over ACTIVE rows, per type (Transactions-view math). */
function activeAmountByType(
  db: Database.Database,
  type: string,
): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE' AND type = ?`,
    )
    .get(type) as { usd: number; lbp: number };
}

describe("G20 — refunding a CREDIT_TRANSFER cascades its auto SMS-fee expense (label-only characterization)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let carrierLineRepo: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    repo = new RechargeRepository();
    carrierLineRepo = new CarrierLineRepository();
  });

  afterEach(() => {
    clearTestDb();
    resetTenantContext();
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    db.close();
  });

  it("refund nets every ledger, the line, profit and active expenses back to 0 per currency; sibling gets VOID semantics", () => {
    const shopLine = carrierLineRepo.createLine(
      {
        carrier: "mtc",
        phone_number: "03999990",
        credits: 50,
        validity_expires_at: FUTURE_EXPIRY,
      },
      1,
    );
    const before = snapshotLedgers(db);
    const profitBefore = activeProfit(db);
    const expensesBefore = activeExpenseTotal(db);
    const expenseTypeBefore = activeAmountByType(db, "EXPENSE");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123450",
      userId: 1,
    });
    expect(result.success).toBe(true);

    // Rule 28a — confirm the sibling really exists before trusting a net 0.
    const expense = db
      .prepare(
        `SELECT id, amount_usd, is_refunded FROM expenses WHERE source_ref_table = 'recharges'`,
      )
      .get() as { id: number; amount_usd: number; is_refunded: number };
    expect(expense).toBeDefined();
    expect(expense.amount_usd).toBeCloseTo(0.16, 6);
    expect(activeExpenseTotal(db).usd).toBeCloseTo(expensesBefore.usd + 0.16, 6);
    const profitAfterCreate = activeProfit(db);
    expect(profitAfterCreate.usd).not.toBeCloseTo(profitBefore.usd, 6);

    const txnRepo = getTransactionRepository();
    const parent = txnRepo.getBySourceId("recharges", 1)!;
    const sibling = txnRepo.getBySourceId("expenses", expense.id)!;
    expect(sibling.status).toBe("ACTIVE");

    txnRepo.refundTransaction(parent.id, 1);

    // ── Numbers: every ledger, per currency, back to pre-create ──
    expectPostings(before, snapshotLedgers(db), {});
    expect(getLineCredits(db, shopLine.id)).toBeCloseTo(50, 6);
    const profitAfter = activeProfit(db);
    expect(profitAfter.usd).toBeCloseTo(profitBefore.usd, 6);
    expect(profitAfter.lbp).toBeCloseTo(profitBefore.lbp, 6);
    const expensesAfter = activeExpenseTotal(db);
    expect(expensesAfter.usd).toBeCloseTo(expensesBefore.usd, 6);
    expect(expensesAfter.lbp).toBeCloseTo(expensesBefore.lbp, 6);
    // Σ ACTIVE EXPENSE unified rows: under VOID semantics the original is
    // VOIDED (excluded) and its reversal is ACTIVE with the opposite sign, so
    // this sum is +0.16 rather than 0 — the SAME shape every manual expense
    // void already produces (the void-reversal convention, isVoidReversalRow).
    // Pinned so a future refund-mode change is a visible decision.
    const expenseTypeAfter = activeAmountByType(db, "EXPENSE");
    expect(expenseTypeAfter.usd - expenseTypeBefore.usd).toBeCloseTo(0.16, 6);

    // ── Labels: parent REFUND semantics, sibling VOID semantics (G20) ──
    expect(txnRepo.findById(parent.id)!.status).toBe("ACTIVE");
    const refundRow = db
      .prepare(`SELECT type FROM transactions WHERE reverses_id = ?`)
      .get(parent.id) as { type: string };
    expect(refundRow.type).toBe("REFUND");
    expect(txnRepo.findById(sibling.id)!.status).toBe("VOIDED");
    const siblingReversal = db
      .prepare(
        `SELECT type, profit_usd, profit_lbp, metadata_json FROM transactions WHERE reverses_id = ?`,
      )
      .get(sibling.id) as {
      type: string;
      profit_usd: number;
      profit_lbp: number;
      metadata_json: string;
    };
    expect(siblingReversal.type).toBe("EXPENSE");
    expect(siblingReversal.profit_usd).toBe(0);
    expect(siblingReversal.profit_lbp).toBe(0);
    // Still hidden from the default Transactions view (rule 26).
    expect(JSON.parse(siblingReversal.metadata_json).is_auto).toBe(true);
    expect(
      (
        db
          .prepare(`SELECT is_refunded FROM expenses WHERE id = ?`)
          .get(expense.id) as { is_refunded: number }
      ).is_refunded,
    ).toBe(1);
  });
});
