/**
 * `saleRecognitionWeight` — unit tests for the sales-path proportional-
 * recognition fragment (owner decision 2026-09-05; Lane A of
 * docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md).
 *
 * Mirrors `ProfitRepository.partnerCoverageRatio.test.ts`'s own precedent:
 * this exercises the raw SQL expression directly against a minimal in-memory
 * schema, NOT through `getSalesRevCost`/`getSalesProfit`/`getByDate` (those
 * still call the pre-existing binary `salePaidOrPartnerSettled` gate
 * unchanged — wiring them to multiply by this weight instead is the next
 * step, out of this lane's fenced line range; see the fragment's own doc
 * comment in ProfitRepository.ts).
 *
 * Schema enumerated in full (the documented test-schema trap — a missing
 * table/column makes the query throw and every test looks like a broken
 * assertion instead of a schema gap):
 *   - `sales(id, paid_usd, paid_lbp, exchange_rate_snapshot,
 *     final_amount_usd)` — exactly the columns {@link saleFullyPaid} reads.
 *   - `partner_ledger(reference_table, reference_id, transaction_type,
 *     amount, covered_amount, tenant_id)` — the same shape
 *     `partnerCoverageRatio.test.ts` uses.
 */

import Database from "better-sqlite3";
import { saleRecognitionWeight } from "../ProfitRepository";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 89500,
      final_amount_usd REAL NOT NULL DEFAULT 0
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
  `);
}

function insertSale(
  db: Database.Database,
  paidUsd: number,
  finalAmountUsd: number,
): number {
  const info = db
    .prepare(
      `INSERT INTO sales (paid_usd, final_amount_usd) VALUES (?, ?)`,
    )
    .run(paidUsd, finalAmountUsd);
  return Number(info.lastInsertRowid);
}

function seedPartnerRow(
  db: Database.Database,
  saleId: number,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, reference_table, reference_id, transaction_type, amount, covered_amount)
     VALUES (1, 'sales', ?, 'FOR_OMT_SEND', ?, ?)`,
  ).run(saleId, amount, coveredAmount);
}

/** Reads the weight for a single `sales` row via the fragment under test. */
function weightFor(db: Database.Database, id: number): number {
  const row = db
    .prepare(
      `SELECT ${saleRecognitionWeight("s")} AS weight
       FROM sales s
       WHERE s.id = ?`,
    )
    .get(id) as { weight: number };
  return row.weight;
}

describe("saleRecognitionWeight", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("a customer-paid sale (no partner row at all) recognises at 1.0", () => {
    const id = insertSale(db, 100, 100);
    expect(weightFor(db, id)).toBe(1.0);
  });

  it("a for-partner sale at 0% partner coverage recognises at 0 (matches the old gate at this endpoint)", () => {
    const id = insertSale(db, 0, 100); // paid_usd = 0 — no counter cash, per saleFullyPaid/salePaidOrPartnerSettled's own doc comment
    seedPartnerRow(db, id, 100, 0);
    expect(weightFor(db, id)).toBe(0);
  });

  it("a for-partner sale at 50% partner coverage recognises at 0.5 (the actual conversion — pre-fix this would be 0)", () => {
    const id = insertSale(db, 0, 100);
    seedPartnerRow(db, id, 100, 50);
    expect(weightFor(db, id)).toBeCloseTo(0.5, 6);
  });

  it("a for-partner sale at 100% partner coverage recognises at 1.0 (matches the old gate at this endpoint)", () => {
    const id = insertSale(db, 0, 100);
    seedPartnerRow(db, id, 100, 100);
    expect(weightFor(db, id)).toBe(1.0);
  });

  it("a genuinely pending, non-partner sale (ordinary customer debt) recognises at 0 — untouched by this change (DBT-1 out of scope)", () => {
    const id = insertSale(db, 0, 100); // unpaid, no partner_ledger row at all
    expect(weightFor(db, id)).toBe(0);
  });

  it("saleFullyPaid takes priority over the partner branch — no double-counting risk in the disjunction", () => {
    // Should never occur in practice (a for-partner sale carries paid_usd = 0),
    // but defensively: if a sale were BOTH fully paid AND carried an
    // uncovered FOR_% row, it must still recognise at 1.0, not be dragged
    // down to the partner ratio.
    const id = insertSale(db, 100, 100);
    seedPartnerRow(db, id, 100, 0); // would be ratio 0 if the partner branch won
    expect(weightFor(db, id)).toBe(1.0);
  });

  it("aggregates multiple FOR_% rows by total dollars for the partner branch (delegates to partnerCoverageRatio, not a hand copy)", () => {
    const id = insertSale(db, 0, 100);
    seedPartnerRow(db, id, 100, 100); // fully covered leg
    seedPartnerRow(db, id, 300, 0); // fully uncovered leg
    // Dollar-weighted: 100 / 400 = 0.25 (not a naive per-row average of 0.5).
    expect(weightFor(db, id)).toBeCloseTo(0.25, 6);
  });

  it("is a per-sale correlation, not a global scan", () => {
    const idA = insertSale(db, 0, 100);
    const idB = insertSale(db, 0, 100);
    seedPartnerRow(db, idA, 100, 0);
    seedPartnerRow(db, idB, 100, 100);

    expect(weightFor(db, idA)).toBe(0);
    expect(weightFor(db, idB)).toBe(1.0);
  });
});
