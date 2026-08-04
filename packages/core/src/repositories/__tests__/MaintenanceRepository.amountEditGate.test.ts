/**
 * MaintenanceRepository — post-payment amount-edit gate (CLAUDE.md rule 17)
 *
 * `updateJob` gates the 9 MAINTENANCE_AMOUNT_FIELDS columns while a job has an
 * ACTIVE-and-unreversed unified transaction (live money history): the
 * transaction row, drawer postings, and any frozen daily-closing snapshot are
 * never re-stamped, so an in-place amount edit would silently desync stored
 * revenue/cost from frozen profit. `jobHasActiveTransaction` alone is NOT
 * sufficient — it stays `true` forever once a job is ever paid, even after a
 * refund or void, because both leave a permanently-ACTIVE sibling/reversal
 * row behind for the same `source_id` (see `simulateRealRefund`/
 * `simulateRealVoid` below). The real gate is
 * `jobHasActiveTransaction(id) && !existing.is_refunded` — both this gate and
 * the pre-existing paid-job delete-block use that combination (rule 14: one
 * shared signal). Owner report 2026-07-28: refunding a job used to leave it
 * permanently locked with a misleading "void or refund to change the amount"
 * message even though it had already been refunded — tests 9-11 guard the fix.
 *
 * Mirrors the in-memory-DB harness from
 * ExchangeRepository.forPartner.test.ts: hand-rolled minimal schema,
 * jest.mock of ../../db/connection with a setDb escape hatch, and
 * initFixedTenantContext(1) / resetTenantContext() per test.
 */

import Database from "better-sqlite3";
import {
  MaintenanceRepository,
  MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR,
  type MaintenanceJob,
  type MaintenanceRow,
} from "../MaintenanceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ─────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT,
      device_name TEXT NOT NULL,
      issue_description TEXT,
      cost_usd DECIMAL(10, 2) DEFAULT 0,
      price_usd DECIMAL(10, 2) DEFAULT 0,
      cost_lbp DECIMAL(15, 2) DEFAULT 0,
      price_lbp DECIMAL(15, 2) DEFAULT 0,
      discount_usd DECIMAL(10, 2) DEFAULT 0,
      final_amount_usd DECIMAL(10, 2) DEFAULT 0,
      final_amount_lbp DECIMAL(15, 2) DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_usd DECIMAL(10, 2) DEFAULT 0,
      paid_lbp DECIMAL(15, 2) DEFAULT 0,
      exchange_rate DECIMAL(15, 2),
      status TEXT DEFAULT 'Received',
      paid_by TEXT DEFAULT 'CASH',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A fully-populated, self-consistent job payload — every gated amount field
 * (all 9 MAINTENANCE_AMOUNT_FIELDS) has an explicit value so updateJob's
 * full-row rewrite never falls back to a stray `?? 0` that would itself trip
 * (or hide) the gate.
 */
function buildJob(overrides: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    device_name: "iPhone 13",
    issue_description: "Screen replacement",
    cost_usd: 20,
    price_usd: 50,
    cost_lbp: 0,
    price_lbp: 0,
    discount_usd: 0,
    final_amount_usd: 50,
    final_amount_lbp: 0,
    currency: "USD",
    paid_usd: 50,
    paid_lbp: 0,
    exchange_rate: 89000,
    status: "Completed",
    paid_by: "CASH",
    note: null,
    client_id: null,
    client_name: null,
    ...overrides,
  };
}

/** Inserts a unified transaction row against `jobId`. Status defaults to
 *  ACTIVE (money history); passing a non-ACTIVE literal status here is a
 *  SYNTHETIC single-row case only — production code never writes a
 *  'REFUNDED' status value (`TransactionStatus` only has 'ACTIVE'/'VOIDED',
 *  see constants/transactionTypes.ts) and never leaves a source with ZERO
 *  active rows either way (see `simulateRealRefund`/`simulateRealVoid`
 *  below, which model what void/refund actually do). This helper only
 *  proves the trivial fact that `getBySourceId` filters on `status='ACTIVE'`.
 */
function insertTransaction(
  db: Database.Database,
  sourceId: number,
  status: "ACTIVE" | "REFUNDED" | "VOIDED" = "ACTIVE",
): number {
  const result = db
    .prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, amount_usd)
       VALUES ('MAINTENANCE', ?, 'maintenance', ?, 50)`,
    )
    .run(status, sourceId);
  return Number(result.lastInsertRowid);
}

/**
 * Simulates a REAL `refundTransaction()` (TransactionRepository.ts:1175-1262):
 * the ORIGINAL row is never flipped — it stays `status='ACTIVE'` forever —
 * and a new REFUND row is inserted, ALSO `status='ACTIVE'`, same
 * `source_table`/`source_id`, with `reverses_id` pointing back at the
 * original and a higher `id` (so `getBySourceId`'s `ORDER BY id DESC` picks
 * it). Also flips `maintenance.is_refunded` to 1, mirroring
 * `_markSourceRefunded` (called by both refund and void).
 */
function simulateRealRefund(
  db: Database.Database,
  jobId: number,
  originalTxnId: number,
): number {
  const result = db
    .prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, amount_usd, reverses_id)
       VALUES ('REFUND', 'ACTIVE', 'maintenance', ?, -50, ?)`,
    )
    .run(jobId, originalTxnId);
  db.prepare(`UPDATE maintenance SET is_refunded = 1 WHERE id = ?`).run(jobId);
  return Number(result.lastInsertRowid);
}

/**
 * Simulates a REAL `voidTransaction()` (TransactionRepository.ts:1010-1046):
 * the ORIGINAL row IS flipped to `status='VOIDED'`, AND a reversal row is
 * inserted keeping the original's `type`, `status='ACTIVE'` (permanently —
 * `_assertReversible` blocks reversing a row whose `reverses_id != null`),
 * same `source_table`/`source_id`. Also flips `maintenance.is_refunded` to 1.
 */
function simulateRealVoid(
  db: Database.Database,
  jobId: number,
  originalTxnId: number,
): number {
  db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(
    originalTxnId,
  );
  const result = db
    .prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, amount_usd, reverses_id)
       VALUES ('MAINTENANCE', 'ACTIVE', 'maintenance', ?, -50, ?)`,
    )
    .run(jobId, originalTxnId);
  db.prepare(`UPDATE maintenance SET is_refunded = 1 WHERE id = ?`).run(jobId);
  return Number(result.lastInsertRowid);
}

function rawJobRow(db: Database.Database, id: number): MaintenanceRow {
  return db
    .prepare(`SELECT * FROM maintenance WHERE id = ?`)
    .get(id) as MaintenanceRow;
}

describe("MaintenanceRepository — amount-edit gate (post-payment immutability)", () => {
  let db: Database.Database;
  let repo: MaintenanceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new MaintenanceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("1. UNPAID job (no ACTIVE transaction): changing price_usd succeeds and is written", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );

    repo.updateJob(id, buildJob({ price_usd: 75, final_amount_usd: 75 }));

    expect(rawJobRow(db, id).price_usd).toBeCloseTo(75, 2);
  });

  it("2. PAID job: changing price_usd throws MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR and the stored row is unchanged", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );
    insertTransaction(db, id, "ACTIVE");

    expect(() =>
      repo.updateJob(id, buildJob({ price_usd: 75, final_amount_usd: 75 })),
    ).toThrow(MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR);

    // Proves the throw happened BEFORE the UPDATE statement ran.
    expect(rawJobRow(db, id).price_usd).toBeCloseTo(50, 2);
  });

  it("3. PAID job: changing only a non-amount field (status/note) succeeds and is written — anti-regression, an over-broad gate would break the normal lifecycle", () => {
    const id = repo.createJob(buildJob({ status: "In Progress" }));
    insertTransaction(db, id, "ACTIVE");

    repo.updateJob(
      id,
      buildJob({
        status: "Completed",
        note: "picked up",
        device_name: "iPhone 13 Pro",
      }),
    );

    const row = rawJobRow(db, id);
    expect(row.status).toBe("Completed");
    expect(row.note).toBe("picked up");
    expect(row.device_name).toBe("iPhone 13 Pro");
    expect(row.price_usd).toBeCloseTo(50, 2); // amounts untouched
  });

  it("4. PAID job: resubmitting identical amounts succeeds — anti-regression, the UI resubmits the whole form on every status change", () => {
    const id = repo.createJob(buildJob());
    insertTransaction(db, id, "ACTIVE");

    // Same amounts as buildJob()'s defaults — only status differs.
    expect(() =>
      repo.updateJob(id, buildJob({ status: "Picked Up" })),
    ).not.toThrow();

    expect(rawJobRow(db, id).status).toBe("Picked Up");
  });

  it("5. PAID job with a discount: resubmitting the stored post-discount final_amount_usd unchanged succeeds — the exact scenario that was false-rejecting in the UI", () => {
    const id = repo.createJob(
      buildJob({
        price_usd: 50,
        discount_usd: 10,
        final_amount_usd: 40,
        paid_usd: 40,
      }),
    );
    insertTransaction(db, id, "ACTIVE");

    expect(() =>
      repo.updateJob(
        id,
        buildJob({
          price_usd: 50,
          discount_usd: 10,
          final_amount_usd: 40,
          paid_usd: 40,
          status: "Picked Up",
        }),
      ),
    ).not.toThrow();

    expect(rawJobRow(db, id).final_amount_usd).toBeCloseTo(40, 2);
  });

  it("6. Float noise under AMOUNT_EPSILON (1e-6) does not trip the gate", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );
    insertTransaction(db, id, "ACTIVE");

    expect(() =>
      repo.updateJob(
        id,
        buildJob({ price_usd: 50 + 5e-7, final_amount_usd: 50 + 5e-7 }),
      ),
    ).not.toThrow();
  });

  it("7. a job with ZERO ACTIVE transaction rows (synthetic 'REFUNDED' status literal) is trivially editable — NOT a proof of real refund/void parity: production void/refund never leave zero ACTIVE rows for a source_id (void inserts a second permanently-ACTIVE reversal row; refund leaves the original ACTIVE forever) — see tests 9/10 below for the real structural cases", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );
    // getBySourceId only matches status = 'ACTIVE'. This single synthetic row
    // (a status string production code never writes) simply has none. A
    // future refactor that changed jobHasActiveTransaction to ignore status
    // would make this go red, which is exactly what this test is here to
    // catch — but it says nothing about what happens after a REAL refund or
    // void, which always leave an ACTIVE row behind (tests 9/10).
    insertTransaction(db, id, "REFUNDED");

    expect(() =>
      repo.updateJob(id, buildJob({ price_usd: 75, final_amount_usd: 75 })),
    ).not.toThrow();

    expect(rawJobRow(db, id).price_usd).toBeCloseTo(75, 2);
  });

  it("8. deleteJob still refuses a paid, un-reversed job — proves the rule-14 shared-predicate refactor didn't break the original delete guard", () => {
    const id = repo.createJob(buildJob());
    insertTransaction(db, id, "ACTIVE");

    expect(() => repo.deleteJob(id)).toThrow(/refund or void/i);
  });

  it("9. REAL refund (original stays ACTIVE + a new ACTIVE REFUND row, is_refunded=1): amounts become editable again (owner report 3 fix) — jobHasActiveTransaction alone is still TRUE here (the REFUND row keeps source_id 'occupied'), so this only passes because updateJob also checks !is_refunded", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );
    const originalTxnId = insertTransaction(db, id, "ACTIVE");
    simulateRealRefund(db, id, originalTxnId);

    expect(() =>
      repo.updateJob(id, buildJob({ price_usd: 75, final_amount_usd: 75 })),
    ).not.toThrow();

    expect(rawJobRow(db, id).price_usd).toBeCloseTo(75, 2);
  });

  it("10. REAL void (original flips to VOIDED + a new ACTIVE reversal row, is_refunded=1): amounts become editable again — same reasoning as refund; jobHasActiveTransaction alone is still TRUE (the reversal row is permanently ACTIVE)", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );
    const originalTxnId = insertTransaction(db, id, "ACTIVE");
    simulateRealVoid(db, id, originalTxnId);

    expect(() =>
      repo.updateJob(id, buildJob({ price_usd: 75, final_amount_usd: 75 })),
    ).not.toThrow();

    expect(rawJobRow(db, id).price_usd).toBeCloseTo(75, 2);
  });

  it("11. deleteJob allows deleting a job AFTER a real refund — refund/void is the delete-block's unlock too (docs/FEATURE_GUIDE.md §9), not a second lock", () => {
    const id = repo.createJob(buildJob());
    const originalTxnId = insertTransaction(db, id, "ACTIVE");
    simulateRealRefund(db, id, originalTxnId);

    expect(() => repo.deleteJob(id)).not.toThrow();
    expect(rawJobRow(db, id).status).toBe("Deleted");
  });

  it("12. updateJob still blocks a job with an ACTIVE transaction that has NOT been refunded/voided — is_refunded=0 keeps the gate on (anti-regression for the !is_refunded addition)", () => {
    const id = repo.createJob(
      buildJob({ price_usd: 50, final_amount_usd: 50 }),
    );
    insertTransaction(db, id, "ACTIVE");
    // Sanity: is_refunded defaults to 0 (schema DEFAULT 0) — never set here.
    expect(rawJobRow(db, id).is_refunded).toBe(0);

    expect(() =>
      repo.updateJob(id, buildJob({ price_usd: 75, final_amount_usd: 75 })),
    ).toThrow(MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR);
  });
});
