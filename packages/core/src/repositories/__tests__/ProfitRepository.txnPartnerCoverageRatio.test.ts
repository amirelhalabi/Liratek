/**
 * ProfitRepository — `txnPartnerCoverageRatio` fragment
 * (PARTNER_PROPORTIONAL_RECOGNITION.md Step 2, 2026-09-05).
 *
 * `txnPartnerCoverageRatio(alias)` is the transactions-alias sibling of
 * `partnerCoverageRatio(refTable, idExpr)` (documented in that plan's §1,
 * built by Step 1) — the SAME `SUM(covered_amount) / SUM(amount)` ratio,
 * COALESCEd to 1.0 when no FOR_% rows exist, clamped to `[0, 1]`,
 * `NULLIF`-guarded against divide-by-zero — but correlated on a
 * transactions row's OWN `source_table`/`source_id` columns instead of a
 * literal `refTable` string, mirroring the exact relationship
 * `txnNotPartnerPending` already has to `notPartnerPending`.
 *
 * Tests the raw SQL expression directly against a minimal in-memory schema
 * (`txn_fixture(id, source_table, source_id)` + `partner_ledger`),
 * independent of any `ProfitRepository` method — mirrors
 * `ProfitRepository.partnerCoverageRatio.test.ts`'s own approach (per
 * PARTNER_PROPORTIONAL_RECOGNITION.md §2), adapted for the alias
 * correlation. Cases 1-6 are the direct analogues of that sibling suite's
 * 9 cases (a couple collapsed together since they exercise the identical
 * MIN/MAX clamp expression); case 7 is this file's version of the sibling's
 * "THROUGH_% present, no FOR_%" cross-check, case 8 proves per-row
 * independence, and case 9 the correlation doesn't leak across an unrelated
 * reference_table/id. Case 10 is the task-mandated proof that this fragment
 * selects the SAME `partner_ledger` rows `txnNotPartnerPending` does, across
 * the full coverage spectrum (0%, 50%, 100%, non-partner) — not just the one
 * THROUGH_%-only fixture case 7 covers.
 *
 * `txn_fixture.id` (its own autoincrement PK) and `txn_fixture.source_id`
 * (the column `txnPartnerCoverageRatio`/`txnNotPartnerPending` actually
 * correlate on) are DELIBERATELY kept as two independent numbers throughout
 * this file — `seedTxn` returns the fixture row's own `id` (needed to
 * address the row via `WHERE tf.id = ?` in `ratioFor`/`notPendingFor`), and
 * every `seedLedger` call is given the SAME `sourceId` value that was passed
 * into the matching `seedTxn` call, never the returned fixture id. Mixing
 * the two up (passing the fixture id as `reference_id`) is exactly the kind
 * of correlation-key mistake `ProfitRepository.partnerPendingCorrelation
 * .test.ts` exists to catch on the production side — this comment is here
 * so it isn't reintroduced on the test side too.
 */

import Database from "better-sqlite3";
import {
  txnPartnerCoverageRatio,
  txnNotPartnerPending,
} from "../ProfitRepository";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE txn_fixture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL
    );

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
  `);
}

/** Inserts a txn_fixture row and returns ITS OWN id (not source_id). */
function seedTxn(
  db: Database.Database,
  sourceTable: string,
  sourceId: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO txn_fixture (source_table, source_id) VALUES (?, ?)`,
    )
    .run(sourceTable, sourceId);
  return Number(res.lastInsertRowid);
}

/**
 * Inserts a partner_ledger row. `refId` MUST be the same `sourceId` value
 * passed to the matching `seedTxn` call — NOT that call's returned fixture
 * id (see file header).
 */
function seedLedger(
  db: Database.Database,
  refTable: string,
  refId: number,
  txnType: string,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (partner_id, transaction_type, reference_table, reference_id, amount, direction, covered_amount)
     VALUES (1, ?, ?, ?, ?, 'DEBIT', ?)`,
  ).run(txnType, refTable, refId, amount, coveredAmount);
}

/** Runs txnPartnerCoverageRatio's SQL against fixture row `fixtureId`. */
function ratioFor(db: Database.Database, fixtureId: number): number {
  const row = db
    .prepare(
      `SELECT ${txnPartnerCoverageRatio("tf")} AS ratio FROM txn_fixture tf WHERE tf.id = ?`,
    )
    .get(fixtureId) as { ratio: number };
  return row.ratio;
}

/** Runs txnNotPartnerPending's SQL against fixture row `fixtureId`. */
function notPendingFor(db: Database.Database, fixtureId: number): boolean {
  const row = db
    .prepare(
      `SELECT (${txnNotPartnerPending("tf")}) AS not_pending FROM txn_fixture tf WHERE tf.id = ?`,
    )
    .get(fixtureId) as { not_pending: number };
  return row.not_pending === 1;
}

describe("ProfitRepository — txnPartnerCoverageRatio", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("1. no FOR_% rows at all -> defaults to 1.0", () => {
    const sourceId = 1;
    const fixtureId = seedTxn(db, "recharges", sourceId);
    expect(ratioFor(db, fixtureId)).toBe(1.0);
  });

  it("2. zero coverage -> 0", () => {
    const sourceId = 1;
    const fixtureId = seedTxn(db, "recharges", sourceId);
    seedLedger(db, "recharges", sourceId, "FOR_PARTNER", 100, 0);
    expect(ratioFor(db, fixtureId)).toBe(0);
  });

  it("3. half coverage -> 0.5", () => {
    const sourceId = 5;
    const fixtureId = seedTxn(db, "financial_services", sourceId);
    seedLedger(db, "financial_services", sourceId, "FOR_PARTNER", 100, 50);
    expect(ratioFor(db, fixtureId)).toBeCloseTo(0.5, 5);
  });

  it("4. full coverage -> 1.0", () => {
    const sourceId = 9;
    const fixtureId = seedTxn(db, "sales", sourceId);
    seedLedger(db, "sales", sourceId, "FOR_PARTNER", 100, 100);
    expect(ratioFor(db, fixtureId)).toBe(1.0);
  });

  it("5. over-coverage and defensively-negative coverage both clamp to [0, 1]", () => {
    const overSourceId = 10;
    const overFixtureId = seedTxn(db, "sales", overSourceId);
    seedLedger(db, "sales", overSourceId, "FOR_PARTNER", 100, 150); // over-covered
    expect(ratioFor(db, overFixtureId)).toBe(1.0);

    const negSourceId = 11;
    const negFixtureId = seedTxn(db, "sales", negSourceId);
    seedLedger(db, "sales", negSourceId, "FOR_PARTNER", 100, -20); // defensively negative
    expect(ratioFor(db, negFixtureId)).toBe(0);
  });

  it("6. multiple FOR_% rows aggregate dollar-weighted (SUM/SUM), not averaged per-row", () => {
    const sourceId = 3;
    const fixtureId = seedTxn(db, "custom_services", sourceId);
    seedLedger(db, "custom_services", sourceId, "FOR_PARTNER", 100, 100); // fully covered
    seedLedger(db, "custom_services", sourceId, "FOR_PARTNER", 300, 0); // fully uncovered
    // SUM(covered)/SUM(amount) = 100/400 = 0.25, NOT the naive per-row
    // average of (1.0 + 0.0) / 2 = 0.5.
    const ratio = ratioFor(db, fixtureId);
    expect(ratio).toBeCloseTo(0.25, 5);
    expect(ratio).not.toBeCloseTo(0.5, 5);
  });

  it("7. a THROUGH_% row with no FOR_% row -> 1.0, and txnNotPartnerPending agrees on the identical fixture", () => {
    const sourceId = 7;
    const fixtureId = seedTxn(db, "loto_tickets", sourceId);
    seedLedger(db, "loto_tickets", sourceId, "THROUGH_PARTNER", 100, 0);
    expect(ratioFor(db, fixtureId)).toBe(1.0);
    // "not pending" must also read true (no FOR_% row to be pending on) —
    // proves both fragments treat a THROUGH_%-only row identically.
    expect(notPendingFor(db, fixtureId)).toBe(true);
  });

  it("8. two different rows with independent coverage -> ratios don't leak across rows", () => {
    const coveredSourceId = 20;
    const coveredFixtureId = seedTxn(db, "recharges", coveredSourceId);
    seedLedger(db, "recharges", coveredSourceId, "FOR_PARTNER", 50, 50);

    const uncoveredSourceId = 21;
    const uncoveredFixtureId = seedTxn(db, "recharges", uncoveredSourceId);
    seedLedger(db, "recharges", uncoveredSourceId, "FOR_PARTNER", 50, 0);

    expect(ratioFor(db, coveredFixtureId)).toBe(1.0);
    expect(ratioFor(db, uncoveredFixtureId)).toBe(0);
  });

  it("9. an unrelated partner_ledger row for a DIFFERENT reference_table/id never leaks in", () => {
    // Seed a dummy, unrelated row first (mirrors
    // ProfitRepository.partnerPendingCorrelation.test.ts's defensive
    // pattern) so partner_ledger's own id sequence diverges from
    // txn_fixture's / source_id's, guarding against an id-vs-reference_id
    // correlation bug hiding behind a coincidental id match.
    seedLedger(db, "sales", 999, "FOR_PARTNER", 1, 1);

    const sourceId = 1;
    const fixtureId = seedTxn(db, "exchange_transactions", sourceId);
    // No partner_ledger row references (exchange_transactions, sourceId) at all.
    expect(ratioFor(db, fixtureId)).toBe(1.0);
  });

  it("10. selects the SAME rows as txnNotPartnerPending across the full coverage spectrum (0%, 50%, 100%, none)", () => {
    // 0% coverage: ratio 0 <-> txnNotPartnerPending false (still pending).
    const zeroSourceId = 100;
    const zeroFixtureId = seedTxn(db, "financial_services", zeroSourceId);
    seedLedger(db, "financial_services", zeroSourceId, "FOR_PARTNER", 100, 0);
    expect(ratioFor(db, zeroFixtureId)).toBe(0);
    expect(notPendingFor(db, zeroFixtureId)).toBe(false);

    // 50% coverage: ratio 0.5 <-> txnNotPartnerPending STILL false — the
    // binary predicate has no partial state, so it must still read
    // "pending" for a row this fragment now reports as half-recognised.
    // This is the one case where the two fragments intentionally DISAGREE
    // on the pass/fail READING (by construction — that disagreement is the
    // entire point of building a proportional fragment) while agreeing on
    // WHICH partner_ledger rows were scanned to reach their answer (both
    // correlate on the identical reference_table/reference_id/FOR_% clause).
    const halfSourceId = 101;
    const halfFixtureId = seedTxn(db, "financial_services", halfSourceId);
    seedLedger(db, "financial_services", halfSourceId, "FOR_PARTNER", 100, 50);
    expect(ratioFor(db, halfFixtureId)).toBeCloseTo(0.5, 5);
    expect(notPendingFor(db, halfFixtureId)).toBe(false);

    // 100% coverage: ratio 1.0 <-> txnNotPartnerPending true (not pending) —
    // full agreement at the fully-recognised extreme.
    const fullSourceId = 102;
    const fullFixtureId = seedTxn(db, "financial_services", fullSourceId);
    seedLedger(db, "financial_services", fullSourceId, "FOR_PARTNER", 100, 100);
    expect(ratioFor(db, fullFixtureId)).toBe(1.0);
    expect(notPendingFor(db, fullFixtureId)).toBe(true);

    // Non-partner row: ratio 1.0 <-> txnNotPartnerPending true — full
    // agreement at the "nothing to scan" extreme too.
    const noneSourceId = 103;
    const noneFixtureId = seedTxn(db, "financial_services", noneSourceId);
    expect(ratioFor(db, noneFixtureId)).toBe(1.0);
    expect(notPendingFor(db, noneFixtureId)).toBe(true);
  });
});
