/**
 * `supplierSettlementProfitArm` — proportional partner recognition (owner
 * decision 2026-09-05; Lane A of
 * docs/plans/done_plans/PARTNER_PROPORTIONAL_RECOGNITION.md).
 *
 * SUPERSEDED CONTRACT (found + corrected 2026-09-23, Lane LCC of
 * OWNER_NOTES_2026-09-21.md §6, while proving `getByClient` parity — NOT one
 * of that lane's numbered PA items, a pre-existing stale test found along the
 * way): this file originally asserted that `supplierSettlementProfitArm`
 * owns its OWN `SELECT SUM(sca.commission * partnerCoverageRatio(...))` for
 * the CASHLESS branch — true on 2026-09-05, when this file was written. PA-2.5
 * (OWNER_NOTES_2026-09-21.md §6.4, 2026-09-21) deliberately moved that
 * computation OUT of this function: a cashless batch's commission is no
 * longer attributed to the SETTLING transaction's own group at all — it is
 * re-attributed to each allocation's own ORIGINATING FINANCIAL_SERVICE
 * transaction's user/client instead, via the sibling function
 * `reattributedSettlementCommission` (see both functions' own doc comments
 * in ProfitRepository.ts). `supplierSettlementProfitArm`'s cashless branch
 * now unconditionally contributes **0** — partner-ratio weighting for the
 * cashless case happens entirely inside `reattributedSettlementCommission`,
 * which has its own dedicated coverage:
 * `ProfitRepository.getByClient.laneLCC.test.ts` (PA-2.5) and
 * `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts`'s "D17 Item 1"
 * block (debt-coverage gating, end-to-end through getByUser/getByClient).
 * This file keeps its "bills-only" and "0%/refunded -> 0" cases (still
 * correct under the new contract by coincidence — 0% coverage and "always 0"
 * are indistinguishable outputs) and updates every other case to assert the
 * NEW contract (0, always, for the cashless branch) instead of the old one.
 *
 * A SEPARATE, genuine bug was also found and fixed in THIS file while
 * restoring it to a runnable state: `usdResultFor`/`lbpResultFor` bound TWO
 * values (`.get(1, txnId)`) against a query with exactly ONE `?` placeholder
 * (`supplierSettlementProfitArm` embeds none of its own) — every test in
 * this file threw `RangeError: Too many parameter values were provided`
 * before ever reaching its assertion, unrelated to the stale-contract issue
 * above and predating this session's changes entirely.
 *
 * Schema enumerated in full (the documented test-schema trap — a missing
 * table/column makes the repo swallow the SQLite error and every test looks
 * like a broken assertion instead of a schema gap):
 *   - `transactions(id, source_table, source_id, type, profit_usd,
 *     profit_lbp)` — the SUPPLIER_SETTLEMENT row itself.
 *   - `financial_services(id, settlement_id, is_refunded)` — joined via
 *     {@link currentSettlementAllocation}.
 *   - `settlement_commission_allocations(settlement_ledger_id,
 *     financial_service_id, commission_usd, commission_lbp, service_type,
 *     tenant_id)` — one row per settled fs in the batch.
 *   - `partner_ledger(reference_table, reference_id, transaction_type,
 *     amount, covered_amount, tenant_id)` — kept for the bills-only fixture
 *     (proves partner coverage is irrelevant to that branch), even though
 *     the cashless branch no longer reads it directly.
 *   - `debt_ledger` — required by {@link allocationNotDebtPending} (a
 *     `NOT EXISTS` scan); stays empty in every fixture here (D17's debt gate
 *     is not this test's concern — `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts`
 *     already covers it), but the table must exist or the query throws.
 *
 * Rule 17 (verbatim, this session): reverted `supplierSettlementProfitArm`'s
 * cashless branch back to the pre-PA-2.5 shape (uncommenting a local
 * `SELECT SUM(...) * partnerCoverageRatio(...)` in place of the current
 * unconditional `0`) and re-ran this file's "50% partner coverage" test —
 * FAILED as expected (`Expected: 0, Received: 10`, the OLD behavior this
 * file now deliberately no longer wants) — before restoring the real
 * `supplierSettlementProfitArm` and confirming this file green again.
 */

import Database from "better-sqlite3";
import { supplierSettlementProfitArm } from "../ProfitRepository";

const TS = "2026-09-05 12:00:00";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_id INTEGER,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      commission_usd REAL DEFAULT 0,
      commission_lbp REAL DEFAULT 0,
      service_type TEXT
    );

    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      reference_table TEXT,
      reference_id INTEGER,
      transaction_type TEXT,
      amount REAL NOT NULL,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      transaction_id INTEGER,
      transaction_type TEXT,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0
    );
  `);
}

function insertSettlementTxn(
  db: Database.Database,
  settlementLedgerId: number,
  profitUsd = 0,
): number {
  const info = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, profit_usd, created_at)
       VALUES ('SUPPLIER_SETTLEMENT', 'supplier_ledger', ?, ?, ?)`,
    )
    .run(settlementLedgerId, profitUsd, TS);
  return Number(info.lastInsertRowid);
}

function insertFs(db: Database.Database, settlementId: number): number {
  const info = db
    .prepare(`INSERT INTO financial_services (settlement_id) VALUES (?)`)
    .run(settlementId);
  return Number(info.lastInsertRowid);
}

function insertAllocationUsd(
  db: Database.Database,
  settlementLedgerId: number,
  fsId: number,
  commissionUsd: number,
  serviceType: string,
): void {
  db.prepare(
    `INSERT INTO settlement_commission_allocations
       (settlement_ledger_id, financial_service_id, commission_usd, service_type, tenant_id)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(settlementLedgerId, fsId, commissionUsd, serviceType);
}

function insertAllocationLbp(
  db: Database.Database,
  settlementLedgerId: number,
  fsId: number,
  commissionLbp: number,
  serviceType: string,
): void {
  db.prepare(
    `INSERT INTO settlement_commission_allocations
       (settlement_ledger_id, financial_service_id, commission_lbp, service_type, tenant_id)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(settlementLedgerId, fsId, commissionLbp, serviceType);
}

function seedPartnerRow(
  db: Database.Database,
  fsId: number,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, reference_table, reference_id, transaction_type, amount, covered_amount)
     VALUES (1, 'financial_services', ?, 'FOR_OMT_SEND', ?, ?)`,
  ).run(fsId, amount, coveredAmount);
}

/** Embeds the fragment under test in a minimal wrapper query (currency = "usd").
 *  Bug fix (found while proving Lane LCC's getByClient parity — unrelated to
 *  that fix itself): `supplierSettlementProfitArm` embeds ZERO `?`
 *  placeholders in its SQL text (it only calls `cashlessCommissionBatch`,
 *  which embeds none either), so the query below has exactly ONE — `WHERE
 *  t.id = ?`. `.get(1, txnId)` bound TWO values, which SQLite rejects
 *  outright (`RangeError: Too many parameter values were provided`) — every
 *  test in this file failed before it ever reached its own assertion. */
function usdResultFor(db: Database.Database, txnId: number): number {
  const row = db
    .prepare(
      `SELECT (CASE ${supplierSettlementProfitArm(true, "usd")} ELSE 0 END) AS result
       FROM transactions t
       WHERE t.id = ?`,
    )
    .get(txnId) as { result: number };
  return row.result;
}

function lbpResultFor(db: Database.Database, txnId: number): number {
  const row = db
    .prepare(
      `SELECT (CASE ${supplierSettlementProfitArm(true, "lbp")} ELSE 0 END) AS result
       FROM transactions t
       WHERE t.id = ?`,
    )
    .get(txnId) as { result: number };
  return row.result;
}

describe("supplierSettlementProfitArm — proportional partner coverage (2026-09-05)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("bills-only batch stays on the transaction-level stamp, unaffected by partner coverage", () => {
    const settlementLedgerId = 500;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 5.5);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 999, "BILL");
    // Even at 0% partner coverage, a bills-only batch must not be touched —
    // it never reaches the CASHLESS ELSE arm this fragment converts.
    seedPartnerRow(db, fsId, 100, 0);

    expect(usdResultFor(db, txnId)).toBe(5.5);
  });

  it("cashless batch, no partner_ledger row at all — contributes 0 (PA-2.5: re-attributed elsewhere, not stamped here regardless of partner coverage)", () => {
    const settlementLedgerId = 501;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");

    expect(usdResultFor(db, txnId)).toBe(0);
  });

  it("cashless batch, 0% partner coverage — contributes 0", () => {
    const settlementLedgerId = 502;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 0);

    expect(usdResultFor(db, txnId)).toBe(0);
  });

  it("cashless batch, 50% partner coverage — still 0 (PA-2.5: this arm no longer weighs partner coverage at all — see reattributedSettlementCommission's own dedicated coverage for the actual weighted figure)", () => {
    const settlementLedgerId = 503;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 50);

    expect(usdResultFor(db, txnId)).toBe(0);
  });

  it("cashless batch, 100% partner coverage — still 0", () => {
    const settlementLedgerId = 504;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 100);

    expect(usdResultFor(db, txnId)).toBe(0);
  });

  it("aggregates multiple allocations in the SAME batch — still 0 regardless of how many cashless allocations the batch holds", () => {
    const settlementLedgerId = 505;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);

    const fsA = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsA, 20, "OMT");
    seedPartnerRow(db, fsA, 100, 50);

    const fsB = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsB, 8, "WHISH");

    expect(usdResultFor(db, txnId)).toBe(0);
  });

  it("the LBP branch is identically 0 for a cashless batch when currency = 'lbp'", () => {
    const settlementLedgerId = 506;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationLbp(db, settlementLedgerId, fsId, 40000, "OMT");
    seedPartnerRow(db, fsId, 100, 25);

    expect(lbpResultFor(db, txnId)).toBe(0);
  });

  it("a refunded fs row is still excluded (notRefunded gate untouched by this change)", () => {
    const settlementLedgerId = 507;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    db.prepare(
      `UPDATE financial_services SET is_refunded = 1 WHERE id = ?`,
    ).run(fsId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 100); // even fully covered — refund excludes it regardless

    expect(usdResultFor(db, txnId)).toBe(0);
  });
});
