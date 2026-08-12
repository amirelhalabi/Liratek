/**
 * LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — a bills-only Katsh/
 * iPick settlement (`SupplierRepository.settleTransactions`'s
 * `isBillsOnlyBatch` branch, commit 4fd0ad1) stamps the operator's entered
 * commission as `profit_usd`/`profit_lbp` directly on the SUPPLIER_SETTLEMENT
 * transaction — but nothing in `ProfitRepository` ever read that type, so the
 * profit was stamped and permanently invisible. Owner: "our profit entirely."
 *
 * Double-count analysis (see task report for the full audit trail): confirmed
 * SAFE — no other ProfitRepository query reads a supplier_ledger-sourced
 * transaction, and a BILL row's `financial_services.commission` column stays
 * 0 forever (LIRA-112: bills are born with `cost === price`, so
 * `commission = price - cost = 0` at creation; settlement never writes the
 * entered commission back to that column). `getSupplierCommissionTotals` is
 * this commission's ONE and ONLY home.
 *
 * Rule 17 — these assertions were run against the pre-fix code (no
 * `getSupplierCommissionTotals` method, `SUPPLIER_SETTLEMENT` absent from
 * `PROFIT_TXN_TYPES`) and observed failing: `getSupplierCommissionTotals` did
 * not exist (TypeError: repo.getSupplierCommissionTotals is not a function).
 * Restored after confirming red — see the task report for the exact output.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository.js";

let db: Database.Database;
let repo: ProfitRepository;

const FROM = "2026-08-01 00:00:00";
const TO = "2026-08-01 23:59:59";
const TS = "2026-08-01 12:00:00";

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER DEFAULT 1,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER,
      created_at TEXT
    );
  `);
}

function insertTxn(opts: {
  type: string;
  sourceTable?: string;
  sourceId?: number;
  status?: string;
  profitUsd?: number;
  profitLbp?: number;
  reversesId?: number;
  createdAt?: string;
}): number {
  const info = db
    .prepare(
      `INSERT INTO transactions
        (type, status, source_table, source_id, amount_usd, amount_lbp, profit_usd, profit_lbp, reverses_id, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      opts.type,
      opts.status ?? "ACTIVE",
      opts.sourceTable ?? "supplier_ledger",
      opts.sourceId ?? 1,
      opts.profitUsd ?? 0,
      opts.profitLbp ?? 0,
      opts.reversesId ?? null,
      opts.createdAt ?? TS,
    );
  return Number(info.lastInsertRowid);
}

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  repo = new ProfitRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ProfitRepository.getSupplierCommissionTotals — LIRA-137 fix", () => {
  it("sums a bills-only settlement's USD commission", () => {
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 1, profitUsd: 5.5 });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_usd).toBe(5.5);
    expect(totals.profit_lbp).toBe(0);
    expect(totals.count).toBe(1);
  });

  it("sums a bills-only settlement's LBP commission (Katsh's real shape — 20,000 LBP/bill, RATE mode)", () => {
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 1, profitLbp: 100000 });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_usd).toBe(0);
    expect(totals.profit_lbp).toBe(100000);
    expect(totals.count).toBe(1);
  });

  it("excludes a VOIDed settlement (status != ACTIVE) — rule 20 net-to-zero via VOID", () => {
    insertTxn({
      type: "SUPPLIER_SETTLEMENT",
      sourceId: 1,
      profitLbp: 20000,
      status: "VOIDED",
    });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_lbp).toBe(0);
  });

  it("nets a REFUNDed settlement back to 0 — rule 20 net-to-zero via REFUND", () => {
    const originalId = insertTxn({
      type: "SUPPLIER_SETTLEMENT",
      sourceId: 1,
      profitLbp: 20000,
    });
    // TransactionRepository._refundTransactionInternal: the REFUND row shares
    // the original's source_table/source_id and carries the NEGATED stamp;
    // the original stays ACTIVE.
    insertTxn({
      type: "REFUND",
      sourceId: 1,
      profitLbp: -20000,
      reversesId: originalId,
    });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_lbp).toBe(0);
  });

  it("an OMT/legacy (commission_model = 0) settlement — profit stamped 0/0 — contributes nothing", () => {
    // Mirrors SupplierRepository.settleTransactions's real stamp for every
    // shape OTHER than isBillsOnlyBatch: `profit_usd: 0, profit_lbp: 0`.
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 1, profitUsd: 0, profitLbp: 0 });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_usd).toBe(0);
    expect(totals.profit_lbp).toBe(0);
    expect(totals.count).toBe(0);
  });

  it("a same-source_table SUPPLIER_PAYMENT (never stamps profit) does not inflate the total", () => {
    // SupplierRepository's SUPPLIER_PAYMENT / journal-entry createTransaction
    // calls never pass profit_usd/profit_lbp (verified: defaults to 0) — this
    // proves the source_table match alone is harmless.
    insertTxn({ type: "SUPPLIER_PAYMENT", sourceId: 2, profitUsd: 0, profitLbp: 0 });
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 1, profitLbp: 20000 });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_lbp).toBe(20000);
    expect(totals.count).toBe(1);
  });

  it("multiple bills-only settlements in the window sum across currencies independently", () => {
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 1, profitLbp: 20000 });
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 2, profitLbp: 40000 });
    insertTxn({ type: "SUPPLIER_SETTLEMENT", sourceId: 3, profitUsd: 2 });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_lbp).toBe(60000);
    expect(totals.profit_usd).toBe(2);
    expect(totals.count).toBe(3);
  });

  it("respects the date range (LIRA-137 shape only counted inside [from, to])", () => {
    insertTxn({
      type: "SUPPLIER_SETTLEMENT",
      sourceId: 1,
      profitLbp: 20000,
      createdAt: "2026-07-31 12:00:00",
    });

    const totals = repo.getSupplierCommissionTotals(FROM, TO);
    expect(totals.profit_lbp).toBe(0);
    expect(totals.count).toBe(0);
  });
});
