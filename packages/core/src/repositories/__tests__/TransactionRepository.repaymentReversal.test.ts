/**
 * D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md, owner-decided 2026-07-18) —
 * voiding/refunding a DEBT_REPAYMENT restores the debt AND unwinds the FIFO
 * coverage the repayment applied.
 *
 * Before this fix, `TransactionRepository.voidTransaction`/`refundTransaction`
 * reversed the repayment's CASH (`_reversePayments`) but left the 'Repayment'
 * `debt_ledger` row — and the `sales.paid_usd`/`debt_ledger.covered_usd/lbp`
 * FIFO stamps `DebtRepository.addRepayment` applied — completely untouched.
 * A long-documented, unowned rule-20 gap (docs/COUNTERPARTY_LEDGERS.md §7,
 * docs/FEATURE_GUIDE.md §9). `TransactionRepository._restoreRepaymentDebt`
 * (+ its two reverse-FIFO helpers) is now the owner.
 *
 * Rule-17 classification (which cases are FAILING-FIRST proofs vs. invariant/
 * boundary checks — verified manually by commenting out the two
 * `_restoreRepaymentDebt(...)` call sites in voidTransaction/refundTransaction
 * and re-running: every "restores"/"unwinds" assertion below goes red,
 * confirming these are true regression guards):
 *
 *   FAILING-FIRST (red pre-fix, green post-fix):
 *     - "VOID of a repayment" — debt restore + ledger net-to-0
 *     - "REFUND of a repayment" — debt restore + ledger net-to-0
 *     - "coverage unwind" — sales.paid_usd + covered_usd both un-stamp
 *     - "mixed-currency repayment" — both amount_usd AND amount_lbp restore
 *
 *   INVARIANT / BOUNDARY (green BOTH pre- and post-fix — not regressions,
 *   but required properties this change must not break):
 *     - "bundled discount boundary" — the discount's own ledger row/txn were
 *       never touched by the pre-fix code either (nothing reversed a
 *       repayment at all); what's new post-fix is that the coverage unwind
 *       correctly attributes ONLY the repayment's own budget, not the
 *       discount's — proven by asserting the exact partial covered_usd left
 *       behind, not just "something didn't change".
 *     - "double-void/refund guards" — pre-existing `_assertReversible` /
 *       double-refund guards, unrelated to this change; proven here only to
 *       show the new step doesn't interfere with a DEBT_REPAYMENT-typed call.
 *     - "T3 keep-change profit stamp" — already handled by the generic void
 *       (VOIDED status drops out of ACTIVE sums) / refund (negated stamp)
 *       paths; asserted here per CLAUDE.md rule 17's "verify, don't
 *       duplicate" instruction, not as a new fix.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const RATE = 90_000;
const CLIENT_ID = 1;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (${CLIENT_ID}, 'Repayment Client');

    CREATE TABLE transactions (
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
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 0, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'BILL',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${RATE}, ${RATE}, ${RATE}, 1);
  `);
  return db;
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** A raw manual debt charge — no transaction link needed: neither
 *  _coverServiceDebtsFIFO/_unwindServiceDebtCoverageFifo require one. */
function seedCharge(
  db: Database.Database,
  clientId: number,
  type: string,
  usd: number,
  lbp = 0,
): void {
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(clientId, type, usd, lbp);
}

/** An unpaid sale wired the way _markSalesPaidFIFO's JOIN expects: a SALE
 *  transaction with source_table='sales'/source_id=<sale>, client_id set. */
function seedUnpaidSale(
  db: Database.Database,
  clientId: number,
  finalAmountUsd: number,
): number {
  const sale = db
    .prepare(
      `INSERT INTO sales (final_amount_usd, paid_usd, status) VALUES (?, 0, 'completed')`,
    )
    .run(finalAmountUsd);
  const saleId = Number(sale.lastInsertRowid);
  db.prepare(
    `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, client_id, summary)
     VALUES ('SALE', 'sales', ?, 1, ?, ?, 'Sale on account')`,
  ).run(saleId, finalAmountUsd, clientId);
  return saleId;
}

function ledgerSum(
  db: Database.Database,
  clientId: number,
): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(clientId) as { usd: number; lbp: number };
}

function drawer(db: Database.Database, name: string, ccy: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Every 'Repayment'/'Repayment Reversal' row, oldest first. */
function repaymentRows(
  db: Database.Database,
): Array<{ transaction_type: string; amount_usd: number; amount_lbp: number }> {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp FROM debt_ledger
       WHERE transaction_type IN ('Repayment', 'Repayment Reversal')
       ORDER BY id ASC`,
    )
    .all() as Array<{
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
  }>;
}

/** The DEBT_REPAYMENT transaction id linked back from a repayment's own
 *  debt_ledger row (addRepayment returns the ledger row id, not the txn id). */
function repaymentTxnId(db: Database.Database, repaymentId: number): number {
  const row = db
    .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
    .get(repaymentId) as { transaction_id: number };
  return row.transaction_id;
}

describe("D3 — DEBT_REPAYMENT void/refund restores debt + unwinds coverage", () => {
  let db: Database.Database;
  let debtRepo: DebtRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    debtRepo = new DebtRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  // ── VOID ──────────────────────────────────────────────────────────────────

  describe("VOID of a repayment", () => {
    beforeEach(() => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
    });

    it("cash reversed AND debt restored — ledger nets to 0, drawer nets to 0", () => {
      const generalBefore = drawer(db, "General", "USD");
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
      });
      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(40, 2); // 100 charge - 60 repaid

      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.voidTransaction(txnId, 1);

      const original = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(original.status).toBe("VOIDED");

      // Debt fully restored to its pre-repayment value.
      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(100, 2);

      // 'Repayment' + 'Repayment Reversal' net to exactly 0.
      const rows = repaymentRows(db);
      expect(rows).toHaveLength(2);
      expect(rows.reduce((s, r) => s + r.amount_usd, 0)).toBeCloseTo(0, 2);

      // Cash given back — drawer returns to its pre-repayment balance.
      expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
    });

    // note 14 — thin-summary enrichment: append the client's name after the
    // existing "Debt Repayment: $X + Y LBP" prefix (byte-identical prefix).
    it("the DEBT_REPAYMENT transaction summary includes the client's name", () => {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
      });
      const txnId = repaymentTxnId(db, repaymentId);
      const txn = db
        .prepare(`SELECT summary FROM transactions WHERE id = ?`)
        .get(txnId) as { summary: string };
      expect(txn.summary.startsWith("Debt Repayment: $60 + 0 LBP")).toBe(true);
      expect(txn.summary).toContain("Repayment Client");
    });
  });

  // ── REFUND ────────────────────────────────────────────────────────────────

  describe("REFUND of a repayment", () => {
    beforeEach(() => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
    });

    it("restores debt AND reverses cash; original stays ACTIVE, a REFUND row is posted", () => {
      const generalBefore = drawer(db, "General", "USD");
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
      });
      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(40, 2);

      const txnId = repaymentTxnId(db, repaymentId);
      const refundId = txnRepo.refundTransaction(txnId, 1);

      const original = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(original.status).toBe("ACTIVE");

      const refundRow = db
        .prepare(
          `SELECT type, reverses_id, amount_usd FROM transactions WHERE id = ?`,
        )
        .get(refundId) as {
        type: string;
        reverses_id: number;
        amount_usd: number;
      };
      expect(refundRow.type).toBe("REFUND");
      expect(refundRow.reverses_id).toBe(txnId);
      expect(refundRow.amount_usd).toBeCloseTo(-60, 2);

      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(100, 2);
      const rows = repaymentRows(db);
      expect(rows.reduce((s, r) => s + r.amount_usd, 0)).toBeCloseTo(0, 2);
      expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
    });
  });

  // ── Coverage unwind ──────────────────────────────────────────────────────

  describe("coverage unwind: sales.paid_usd + module covered_usd/lbp", () => {
    let saleId: number;

    beforeEach(() => {
      saleId = seedUnpaidSale(db, CLIENT_ID, 30);
      seedCharge(db, CLIENT_ID, "Custom Service Debt", 50);
    });

    it("$70 cash repayment bumps paid_usd=30 + covered_usd=40; VOID restores both to their pre-repayment values (0)", () => {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: 1,
      });

      // Sanity: forward coverage applied as expected (sales first, remainder
      // to services — DBT-1 chaining).
      const saleAfterPay = db
        .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { paid_usd: number };
      expect(saleAfterPay.paid_usd).toBeCloseTo(30, 2);
      const serviceAfterPay = db
        .prepare(
          `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Custom Service Debt'`,
        )
        .get() as { covered_usd: number };
      expect(serviceAfterPay.covered_usd).toBeCloseTo(40, 2);

      // Client's overall balance before void: 50 charge - 70 repaid = -20
      // (client overpaid / has credit) — not asserted further here, the
      // ledger-restore assertion below is the load-bearing one.

      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.voidTransaction(txnId, 1);

      const saleAfterVoid = db
        .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { paid_usd: number };
      expect(saleAfterVoid.paid_usd).toBeCloseTo(0, 2);
      const serviceAfterVoid = db
        .prepare(
          `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Custom Service Debt'`,
        )
        .get() as { covered_usd: number };
      expect(serviceAfterVoid.covered_usd).toBeCloseTo(0, 2);

      // And the client's ledger balance is back to the pre-repayment value.
      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(50, 2);
    });

    it("REFUND does the same unwind as VOID (same coverage-restore code path)", () => {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: 1,
      });
      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.refundTransaction(txnId, 1);

      const sale = db
        .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { paid_usd: number };
      expect(sale.paid_usd).toBeCloseTo(0, 2);
      const service = db
        .prepare(
          `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Custom Service Debt'`,
        )
        .get() as { covered_usd: number };
      expect(service.covered_usd).toBeCloseTo(0, 2);
    });

    it("REGRESSION: refunding the underlying SALE independently must not make the repayment's later VOID double-count paid_usd", () => {
      // A SALE's refund/void row is inserted with the SAME source_table/
      // source_id/client_id as the original (reverses_id links them) — so a
      // naive sales↔transactions JOIN keyed only on source_table/source_id/
      // client_id (no status filter) matches the SAME sale TWICE once it has
      // a reversal row, and _unwindSalesPaidFifo would subtract its paid_usd
      // budget against it twice, driving paid_usd negative.
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 70,
        amount_lbp: 0,
        created_by: 1,
      });
      const saleAfterPay = db
        .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { paid_usd: number };
      expect(saleAfterPay.paid_usd).toBeCloseTo(30, 2);

      // Refund the SALE itself (independent of the repayment) — this leaves
      // the original SALE transaction row ACTIVE/unchanged and adds a second
      // REFUND transaction row carrying the SAME source_table='sales',
      // source_id=saleId, client_id.
      const saleTxn = db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'SALE' AND source_id = ?`,
        )
        .get(saleId) as { id: number };
      txnRepo.refundTransaction(saleTxn.id, 1);
      const saleAfterSaleRefund = db
        .prepare(`SELECT status, paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { status: string; paid_usd: number };
      expect(saleAfterSaleRefund.status).toBe("refunded");
      // paid_usd is a separate bookkeeping column — the sale's own refund
      // does not touch it.
      expect(saleAfterSaleRefund.paid_usd).toBeCloseTo(30, 2);

      // Now void the REPAYMENT. Its sales-unwind must not double-match the
      // now-refunded sale and must never drive paid_usd negative.
      const repaymentTxn = repaymentTxnId(db, repaymentId);
      txnRepo.voidTransaction(repaymentTxn, 1);

      // The sale is no longer 'completed' (it's 'refunded'), so — mirroring
      // the forward direction's own `s.status = 'completed'` filter — the
      // unwind correctly SKIPS it rather than touching its paid_usd twice:
      // it must never go negative, and (since this budget wasn't consumed
      // here) it stays at its post-repayment value, not reset to 0.
      const saleAfterVoid = db
        .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { paid_usd: number };
      expect(saleAfterVoid.paid_usd).toBeGreaterThanOrEqual(0);
      expect(saleAfterVoid.paid_usd).toBeCloseTo(30, 2);
    });
  });

  // ── Mixed currency ───────────────────────────────────────────────────────

  describe("mixed-currency repayment (USD+LBP) restores both columns", () => {
    beforeEach(() => {
      // A single charge row carrying both currencies — deliberately simple
      // (not a real Recharge/Service Debt) so the coverage FIFO stays out of
      // this test's way; it isolates the ledger-restore mechanics only.
      seedCharge(db, CLIENT_ID, "Sale Debt", 50, 3_000_000);
    });

    it("VOID restores amount_usd AND amount_lbp independently", () => {
      const generalUsdBefore = drawer(db, "General", "USD");
      const generalLbpBefore = drawer(db, "General", "LBP");
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 20,
        amount_lbp: 1_000_000,
        created_by: 1,
      });
      const afterRepay = ledgerSum(db, CLIENT_ID);
      expect(afterRepay.usd).toBeCloseTo(30, 2);
      expect(afterRepay.lbp).toBeCloseTo(2_000_000, 2);

      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.voidTransaction(txnId, 1);

      const afterVoid = ledgerSum(db, CLIENT_ID);
      expect(afterVoid.usd).toBeCloseTo(50, 2);
      expect(afterVoid.lbp).toBeCloseTo(3_000_000, 2);

      expect(drawer(db, "General", "USD")).toBeCloseTo(generalUsdBefore, 2);
      expect(drawer(db, "General", "LBP")).toBeCloseTo(generalLbpBefore, 2);
    });
  });

  // ── CQ-10 bundled-discount boundary ──────────────────────────────────────

  describe("bundled discount boundary — the discount is a SEPARATE, NON_REVERSIBLE transaction", () => {
    beforeEach(() => {
      seedCharge(db, CLIENT_ID, "Custom Service Debt", 100);
    });

    it("voiding the repayment leaves the bundled discount's ledger row/txn untouched, and only unwinds the repayment's OWN coverage share", () => {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
      });
      // 100 charge - 60 repaid - 40 forgiven = 0.
      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(0, 2);

      const discountRowBefore = db
        .prepare(
          `SELECT amount_usd, transaction_id FROM debt_ledger WHERE transaction_type = 'Debt Discount'`,
        )
        .get();
      const discountTxnBefore = db
        .prepare(
          `SELECT status, profit_usd FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT'`,
        )
        .get();
      // Combo (repayment $60 + discount $40) fully covered the $100 charge.
      const serviceBefore = db
        .prepare(
          `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Custom Service Debt'`,
        )
        .get() as { covered_usd: number };
      expect(serviceBefore.covered_usd).toBeCloseTo(100, 2);

      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.voidTransaction(txnId, 1);

      // The discount's own row and transaction are BIT-FOR-BIT unchanged.
      const discountRowAfter = db
        .prepare(
          `SELECT amount_usd, transaction_id FROM debt_ledger WHERE transaction_type = 'Debt Discount'`,
        )
        .get();
      expect(discountRowAfter).toEqual(discountRowBefore);
      const discountTxnAfter = db
        .prepare(
          `SELECT status, profit_usd FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT'`,
        )
        .get();
      expect(discountTxnAfter).toEqual(discountTxnBefore);

      // Only the repayment's $60 unwinds — the discount's $40 coverage share
      // stays applied (proves the give-back budget is scoped to the
      // 'Repayment' row's own amount, not the combined settlement).
      const serviceAfter = db
        .prepare(
          `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Custom Service Debt'`,
        )
        .get() as { covered_usd: number };
      expect(serviceAfter.covered_usd).toBeCloseTo(40, 2);

      // Balance: 100 charge - 40 discount (still forgiven) - 60 repaid + 60
      // reversal = 60 owed again.
      expect(ledgerSum(db, CLIENT_ID).usd).toBeCloseTo(60, 2);
    });
  });

  // ── Double-void/refund guards (existing, unrelated to D3) ───────────────

  describe("double-void/refund guards still apply to DEBT_REPAYMENT transactions", () => {
    beforeEach(() => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
    });

    function makeRepayment(): number {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
      });
      return repaymentTxnId(db, repaymentId);
    }

    it("refuses voiding an already-voided repayment", () => {
      const txnId = makeRepayment();
      txnRepo.voidTransaction(txnId, 1);
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        /already voided/i,
      );
    });

    it("refuses voiding a repayment that has already been refunded", () => {
      const txnId = makeRepayment();
      txnRepo.refundTransaction(txnId, 1);
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        /already been refunded/i,
      );
    });

    it("refuses refunding an already-refunded repayment", () => {
      const txnId = makeRepayment();
      txnRepo.refundTransaction(txnId, 1);
      expect(() => txnRepo.refundTransaction(txnId, 1)).toThrow(
        /already been refunded/i,
      );
    });

    it("refuses refunding a voided repayment", () => {
      const txnId = makeRepayment();
      txnRepo.voidTransaction(txnId, 1);
      expect(() => txnRepo.refundTransaction(txnId, 1)).toThrow(/voided/i);
    });

    it("a rejected double-void leaves the ledger with exactly one Repayment + one Repayment Reversal (no extra rows)", () => {
      const txnId = makeRepayment();
      txnRepo.voidTransaction(txnId, 1);
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow();
      expect(repaymentRows(db)).toHaveLength(2);
    });
  });

  // ── T3 keep-change profit stamp (verify, don't duplicate) ────────────────

  describe("T3 keep-change profit stamp — void/refund symmetry (already handled by the generic path)", () => {
    beforeEach(() => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
    });

    function activeProfitUsd(): number {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions WHERE status = 'ACTIVE'`,
        )
        .get() as { p: number };
      return row.p;
    }

    it("VOID: original goes VOIDED, dropping its kept-change stamp out of the ACTIVE sum", () => {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        kept_change_usd: 5,
      });
      expect(activeProfitUsd()).toBeCloseTo(5, 2);

      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.voidTransaction(txnId, 1);

      expect(activeProfitUsd()).toBeCloseTo(0, 2);
    });

    it("REFUND: negates the kept-change stamp — nets to 0 while original stays ACTIVE", () => {
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        kept_change_usd: 5,
      });

      const txnId = repaymentTxnId(db, repaymentId);
      txnRepo.refundTransaction(txnId, 1);

      expect(activeProfitUsd()).toBeCloseTo(0, 2);
    });
  });
});
