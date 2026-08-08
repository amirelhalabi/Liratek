/**
 * LIRA-108 — "Commission (Settled)" must apply the counterparty recognition
 * gates (permanent regression test; replaces the throwaway lira108 repro).
 *
 * Domain rule (docs/COUNTERPARTY_LEDGERS.md §8.1, PFT-6 + DBT-1): commission
 * profit is real only when the money is real on EVERY axis —
 *   - supplier-settled  (fs.is_settled = 1),
 *   - not partner-pending (no uncovered FOR_% partner_ledger row — for-partner
 *     rows defer until partner settlement FIFO covers them),
 *   - not debt-pending  (no uncovered module-debt charge — CUSTOMER_ACCOUNT
 *     charged services defer until the client repays).
 *
 * Pre-fix, `getRealizedCommissionTotals` (feeds ProfitService.
 * getByPaymentMethod's "Commission (Settled)" row) applied only the
 * is_settled axis, while its sibling `getFinancialSettledByCurrency`
 * (Summary per-currency view) applied all three — the two profit views
 * disagreed and the by-payment-method total overstated. Both real-flow
 * producible: SupplierRepository.settleTransactions stamps is_settled = 1
 * checking NO partner coverage, and supplier settlement is fully independent
 * of a client's CUSTOMER_ACCOUNT repayment.
 *
 * Mirror-image decision (deliberate, matches the per-currency sibling pair):
 * `getPendingCommissionTotals` keys purely on is_settled = 0 (the
 * PRE-recognition bucket) and gets NO partner/debt gates — a settled but
 * partner-/debt-pending row appears in NEITHER by-payment commission row;
 * it is visible in getDeferredProfit until settlement/repayment, exactly
 * like getFinancialPendingByCurrency treats it (see the documented exclusion
 * in profitRecognition.guard.test.ts).
 *
 * Rule 17: the realized-totals assertions below were OBSERVED failing against
 * the pre-fix query (actual 28 / count 5 vs expected 10 / count 3) before the
 * gates were added — see LIRA-108 in current_sprint.md.
 *
 * Fixture pattern copied from ProfitRepository.tenantIsolation.test.ts
 * (in-memory better-sqlite3 + __LIRATEK_TEST_DB__ + runWithTenant).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    );

    -- Referenced by notPartnerPending (PFT-6). An uncovered FOR_% row makes
    -- its source partner-pending.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- Referenced by notDebtPending (DBT-1, v129). An uncovered 'Service Debt'
    -- charge row keyed to the unified txn id makes its source debt-pending.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );
  `);
}

/** Insert a settled OMT commission fs row + its FINANCIAL_SERVICE txn. */
function seedSettledCommission(
  db: Database.Database,
  commission: number,
): { fsId: number; txnId: number } {
  const fs = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, amount, currency, commission, cost, price, is_settled, is_refunded, created_at)
       VALUES (1, 'OMT', 100, 'USD', ?, 0, 0, 1, 0, ?)`,
    )
    .run(commission, D);
  const fsId = Number(fs.lastInsertRowid);
  const txn = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 100, ?, ?)`,
    )
    .run(fsId, commission, D);
  return { fsId, txnId: Number(txn.lastInsertRowid) };
}

function seedPartnerRow(
  db: Database.Database,
  fsId: number,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
     VALUES (1, 1, 'FOR_OMT_SEND', 'financial_services', ?, ?, 'USD', 'DEBIT', ?, ?)`,
  ).run(fsId, amount, coveredAmount, D);
}

function seedDebtRow(
  db: Database.Database,
  txnId: number,
  amountUsd: number,
  coveredUsd: number,
): void {
  db.prepare(
    `INSERT INTO debt_ledger
       (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, is_refunded, covered_usd, covered_lbp, created_at)
     VALUES (1, 1, 'Service Debt', ?, 0, ?, 0, ?, 0, ?)`,
  ).run(amountUsd, txnId, coveredUsd, D);
}

describe("LIRA-108 — getRealizedCommissionTotals counterparty gates", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  // Five settled OMT commission rows in the same window:
  //   (a) CONTROL         $5  — no counterparty rows           → realized
  //   (b) PARTNER-PENDING $7  — uncovered FOR_% row            → deferred
  //   (c) DEBT-PENDING    $11 — open 'Service Debt' charge     → deferred
  //   (d) PARTNER-COVERED $3  — FOR_% row fully covered (FIFO) → realized
  //   (e) DEBT-COVERED    $2  — 'Service Debt' fully repaid    → realized
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    seedSettledCommission(db, 5); // (a)

    const b = seedSettledCommission(db, 7); // (b)
    seedPartnerRow(db, b.fsId, 107, 0);

    const c = seedSettledCommission(db, 11); // (c)
    seedDebtRow(db, c.txnId, 111, 0);

    const d = seedSettledCommission(db, 3); // (d)
    seedPartnerRow(db, d.fsId, 103, 103);

    const e = seedSettledCommission(db, 2); // (e)
    seedDebtRow(db, e.txnId, 102, 102);

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getFinancialSettledByCurrency (gated sibling, parity anchor): control + covered rows only", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].commission).toBe(10); // 5 + 3 + 2 — (b) and (c) withheld
    expect(rows[0].count).toBe(3);
  });

  it("getRealizedCommissionTotals withholds partner-pending and debt-pending commission (LIRA-108)", () => {
    const realized = runWithTenant(1, () =>
      repo.getRealizedCommissionTotals(FROM, TO),
    );
    // LIRA-108 gates: pre-fix this was 28 / count 5 (it summed the
    // partner-pending $7 and debt-pending $11 too). Gated expectation:
    // control 5 + partner-covered 3 + debt-covered 2 = 10, count 3.
    expect(realized.total_usd).toBe(10);
    expect(realized.total_lbp).toBe(0);
    expect(realized.count).toBe(3);
  });

  it("the two settled-commission views agree (divergence was 18 USD pre-fix)", () => {
    const { total_usd } = runWithTenant(1, () =>
      repo.getRealizedCommissionTotals(FROM, TO),
    );
    const gated = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    const gatedUsd = gated
      .filter((r) => r.currency !== "LBP")
      .reduce((s, r) => s + r.commission, 0);
    expect(total_usd - gatedUsd).toBe(0);
  });

  it("mirror-image: settled-but-pending rows appear in NEITHER by-payment commission row", () => {
    // Deliberate (matches the per-currency sibling pair): pending keys purely
    // on is_settled = 0, so a settled partner-/debt-pending row is excluded
    // from realized by the gates AND from pending by its is_settled = 1 —
    // it lives in getDeferredProfit until the partner settles / client repays.
    const pending = runWithTenant(1, () =>
      repo.getPendingCommissionTotals(FROM, TO),
    );
    expect(pending.total_usd).toBe(0);
    expect(pending.total_lbp).toBe(0);
    expect(pending.count).toBe(0);
  });
});
