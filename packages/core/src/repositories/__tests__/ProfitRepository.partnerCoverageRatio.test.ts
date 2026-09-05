/**
 * `partnerCoverageRatio` — unit tests for the proportional-recognition
 * foundation fragment (2026-09-05 owner decision; see
 * `docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md`).
 *
 * This exercises the raw SQL expression directly against a minimal in-memory
 * schema — it does NOT go through `ProfitRepository`'s tenant-scoped query
 * methods, because `partnerCoverageRatio` is not yet wired into any of them
 * (Step 1 of 3 builds only the fragment; conversion is a later, separate
 * step). Each test embeds the fragment in a tiny `SELECT ... FROM
 * source_rows sr WHERE sr.id = ?` and reads back the scalar `ratio` column.
 *
 * Schema enumerated in full (the documented test-schema trap: a missing
 * table/column here would make the query throw and every test would look
 * like a broken assertion instead of a schema gap):
 *   - `source_rows(id)` — a generic stand-in for ANY module's source table
 *     (sales/financial_services/recharges/…); the fragment only needs a
 *     table name + an id column to correlate against.
 *   - `partner_ledger(reference_table, reference_id, transaction_type,
 *     amount, covered_amount, tenant_id)` — the exact columns the fragment
 *     reads, matching `notPartnerPending`'s own required columns plus
 *     `covered_amount`/`amount` for the ratio itself.
 */

import Database from "better-sqlite3";
import { partnerCoverageRatio, notPartnerPending } from "../ProfitRepository";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE source_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT
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

function seedSourceRow(db: Database.Database): number {
  const res = db.prepare(`INSERT INTO source_rows DEFAULT VALUES`).run();
  return Number(res.lastInsertRowid);
}

function seedPartnerRow(
  db: Database.Database,
  refTable: string,
  referenceId: number,
  transactionType: string,
  amount: number,
  coveredAmount: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO partner_ledger
         (tenant_id, reference_table, reference_id, transaction_type, amount, covered_amount)
       VALUES (1, ?, ?, ?, ?, ?)`,
    )
    .run(refTable, referenceId, transactionType, amount, coveredAmount);
  return Number(res.lastInsertRowid);
}

/** Reads the ratio for a single `source_rows` row via the fragment under test. */
function ratioFor(db: Database.Database, id: number): number {
  const row = db
    .prepare(
      `SELECT ${partnerCoverageRatio("source_rows", "sr.id")} AS ratio
       FROM source_rows sr
       WHERE sr.id = ?`,
    )
    .get(id) as { ratio: number };
  return row.ratio;
}

/** Reads notPartnerPending's own boolean (1 = not pending / fully covered) for the same row. */
function notPendingFor(db: Database.Database, id: number): boolean {
  const row = db
    .prepare(
      `SELECT (CASE WHEN ${notPartnerPending("source_rows", "sr.id")} THEN 1 ELSE 0 END) AS not_pending
       FROM source_rows sr
       WHERE sr.id = ?`,
    )
    .get(id) as { not_pending: number };
  return row.not_pending === 1;
}

describe("partnerCoverageRatio", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("defaults to 1.0 when the row has no FOR_% partner_ledger rows at all", () => {
    const id = seedSourceRow(db);
    expect(ratioFor(db, id)).toBe(1.0);
  });

  it("returns 0 for zero coverage", () => {
    const id = seedSourceRow(db);
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, 0);
    expect(ratioFor(db, id)).toBe(0);
  });

  it("returns 0.5 for half coverage", () => {
    const id = seedSourceRow(db);
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, 50);
    expect(ratioFor(db, id)).toBeCloseTo(0.5, 6);
  });

  it("returns 1.0 for full coverage", () => {
    const id = seedSourceRow(db);
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, 100);
    expect(ratioFor(db, id)).toBe(1.0);
  });

  it("clamps over-coverage to 1.0", () => {
    const id = seedSourceRow(db);
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, 150);
    expect(ratioFor(db, id)).toBe(1.0);
  });

  it("clamps a defensively-negative ratio to 0", () => {
    const id = seedSourceRow(db);
    // Should never occur in practice (covered_amount is only ever moved by
    // FIFO allocation/unwind, both of which stay >= 0), but the fragment's
    // clamp must not let a negative figure through either.
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, -20);
    expect(ratioFor(db, id)).toBe(0);
  });

  it("aggregates multiple FOR_% rows by total dollars, not a per-row average", () => {
    const id = seedSourceRow(db);
    // Row A: fully covered ($100 of $100 → ratio 1.0 on its own).
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, 100);
    // Row B: fully uncovered ($0 of $300 → ratio 0 on its own).
    seedPartnerRow(db, "source_rows", id, "FOR_WHISH_RECEIVE", 300, 0);
    // A naive average of the two per-row ratios would be (1.0 + 0) / 2 = 0.5.
    // The dollar-weighted aggregate is SUM(covered)/SUM(amount) = 100/400 = 0.25.
    expect(ratioFor(db, id)).toBeCloseTo(0.25, 6);
    expect(ratioFor(db, id)).not.toBeCloseTo(0.5, 6);
  });

  it("selects the SAME rows notPartnerPending does — a THROUGH_% row must not count", () => {
    const id = seedSourceRow(db);
    // An uncovered THROUGH_% row: notPartnerPending's own LIKE 'FOR\_%' gate
    // does not match it, so it must not affect the ratio either (rule 14 —
    // one definition of "what counts as a partner row", shared by both
    // fragments).
    seedPartnerRow(db, "source_rows", id, "THROUGH_OMT_SEND", 1000, 0);

    // With no FOR_% row present, both fragments must agree: fully realized.
    expect(ratioFor(db, id)).toBe(1.0);
    expect(notPendingFor(db, id)).toBe(true);

    // Now add a genuinely uncovered FOR_% row for the SAME source row — both
    // fragments must now agree the row is partner-pending/partial.
    seedPartnerRow(db, "source_rows", id, "FOR_OMT_SEND", 100, 40);
    expect(ratioFor(db, id)).toBeCloseTo(0.4, 6);
    expect(notPendingFor(db, id)).toBe(false);
  });

  it("is a per-source-row correlation, not a global scan (a different row's coverage is irrelevant)", () => {
    const idA = seedSourceRow(db);
    const idB = seedSourceRow(db);
    // Row A: uncovered.
    seedPartnerRow(db, "source_rows", idA, "FOR_OMT_SEND", 100, 0);
    // Row B: fully covered.
    seedPartnerRow(db, "source_rows", idB, "FOR_OMT_SEND", 100, 100);

    expect(ratioFor(db, idA)).toBe(0);
    expect(ratioFor(db, idB)).toBe(1.0);
  });
});
