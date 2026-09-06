/**
 * `supplierSettlementProfitArm` — proportional partner recognition (owner
 * decision 2026-09-05; Lane A of
 * docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md).
 *
 * Unlike {@link saleRecognitionWeight} (see its sibling test file), this
 * fragment owns its OWN `SELECT SUM(...)` — the partner gate and the
 * monetary column live in the SAME function body — so the conversion is
 * complete end to end, in place, with no separate caller-side wiring
 * required. This exercises the raw SQL expression directly against a
 * minimal in-memory schema (mirrors `partnerCoverageRatio.test.ts` and
 * `ProfitRepository.supplierSettlementCommission.test.ts`'s own precedent),
 * embedding the fragment in a tiny `CASE ... ELSE 0 END` wrapper rather than
 * going through the full `getByUser`/`getByClient` methods that actually
 * call it (those live far outside this lane's fenced line range).
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
 *     amount, covered_amount, tenant_id)` — the fragment's own coverage
 *     source, keyed on `financial_services`.
 *   - `debt_ledger` — required by {@link allocationNotDebtPending} (a
 *     `NOT EXISTS` scan); stays empty in every fixture here (D17's debt gate
 *     is not this test's concern — `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts`
 *     already covers it), but the table must exist or the query throws.
 *
 * Rule 17 (verbatim in the task report): reverting the `SELECT SUM(...)` back
 * to the pre-conversion shape (no `* partnerCoverageRatio(...)` factor, WHERE
 * gated by the old binary `notPartnerPending` instead) and re-running the
 * "50% partner coverage" test below was observed FAILING — expected `10`,
 * received `0` (the old gate excludes a 50%-covered allocation from the SUM
 * entirely, same as any other uncovered row) — before the fix was restored.
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

/** Embeds the fragment under test in a minimal wrapper query (currency = "usd"). */
function usdResultFor(db: Database.Database, txnId: number): number {
  const row = db
    .prepare(
      `SELECT (CASE ${supplierSettlementProfitArm(true, "usd")} ELSE 0 END) AS result
       FROM transactions t
       WHERE t.id = ?`,
    )
    .get(1, txnId) as { result: number };
  return row.result;
}

function lbpResultFor(db: Database.Database, txnId: number): number {
  const row = db
    .prepare(
      `SELECT (CASE ${supplierSettlementProfitArm(true, "lbp")} ELSE 0 END) AS result
       FROM transactions t
       WHERE t.id = ?`,
    )
    .get(1, txnId) as { result: number };
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

  it("cashless batch, no partner_ledger row at all — full commission (ratio defaults to 1.0, same as the old gate's default pass-through)", () => {
    const settlementLedgerId = 501;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");

    expect(usdResultFor(db, txnId)).toBe(20);
  });

  it("cashless batch, 0% partner coverage — contributes 0 (matches the old binary gate at this endpoint)", () => {
    const settlementLedgerId = 502;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 0);

    expect(usdResultFor(db, txnId)).toBe(0);
  });

  it("cashless batch, 50% partner coverage — recognises HALF the commission (the actual conversion; pre-fix this was 0)", () => {
    const settlementLedgerId = 503;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 50);

    expect(usdResultFor(db, txnId)).toBeCloseTo(10, 6);
  });

  it("cashless batch, 100% partner coverage — full commission (matches the old binary gate at this endpoint)", () => {
    const settlementLedgerId = 504;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 100);

    expect(usdResultFor(db, txnId)).toBe(20);
  });

  it("aggregates multiple allocations in the SAME batch, each weighted by its OWN financial_service_id's ratio", () => {
    const settlementLedgerId = 505;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);

    const fsA = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsA, 20, "OMT");
    seedPartnerRow(db, fsA, 100, 50); // 50% covered -> 10

    const fsB = insertFs(db, settlementLedgerId);
    insertAllocationUsd(db, settlementLedgerId, fsB, 8, "WHISH"); // non-partner -> full 8

    expect(usdResultFor(db, txnId)).toBeCloseTo(18, 6);
  });

  it("weights the LBP commission column identically when currency = 'lbp'", () => {
    const settlementLedgerId = 506;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    insertAllocationLbp(db, settlementLedgerId, fsId, 40000, "OMT");
    seedPartnerRow(db, fsId, 100, 25); // 25% coverage

    expect(lbpResultFor(db, txnId)).toBeCloseTo(10000, 2);
  });

  it("a refunded fs row is still excluded (notRefunded gate untouched by this change)", () => {
    const settlementLedgerId = 507;
    const txnId = insertSettlementTxn(db, settlementLedgerId, 0);
    const fsId = insertFs(db, settlementLedgerId);
    db.prepare(`UPDATE financial_services SET is_refunded = 1 WHERE id = ?`).run(
      fsId,
    );
    insertAllocationUsd(db, settlementLedgerId, fsId, 20, "OMT");
    seedPartnerRow(db, fsId, 100, 100); // even fully covered — refund excludes it regardless

    expect(usdResultFor(db, txnId)).toBe(0);
  });
});
