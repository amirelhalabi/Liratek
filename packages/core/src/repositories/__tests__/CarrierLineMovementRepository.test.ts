/**
 * LIRA-090 Phase 3b — CarrierLineMovementRepository (spec §8).
 *
 * The rule-20 reversal owner's data layer: create a movement, list by
 * carrier line / by transaction, mark reversed. Tenant-scoped.
 */

import Database from "better-sqlite3";
import {
  CarrierLineMovementRepository,
  resetCarrierLineMovementRepository,
} from "../CarrierLineMovementRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("CarrierLineMovementRepository (LIRA-090 §8)", () => {
  let db: Database.Database;
  let repo: CarrierLineMovementRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineMovementRepository();
    repo = new CarrierLineMovementRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineMovementRepository();
  });

  it("createMovement() writes a tenant-scoped row with is_reversed=0 by default", () => {
    const m = repo.createMovement({
      carrier_line_id: 1,
      transaction_id: 42,
      credits_delta: 73,
      validity_days_delta: 0,
      reason: "ONLY_DAYS_RETURN",
    });
    expect(m.id).toBeGreaterThan(0);
    expect(m.carrier_line_id).toBe(1);
    expect(m.transaction_id).toBe(42);
    expect(m.credits_delta).toBeCloseTo(73, 2);
    expect(m.validity_days_delta).toBe(0);
    expect(m.reason).toBe("ONLY_DAYS_RETURN");
    expect(m.is_reversed).toBe(0);
  });

  it("createMovement() defaults transaction_id to null and deltas to 0 when omitted", () => {
    const m = repo.createMovement({ carrier_line_id: 1, reason: "MANUAL" });
    expect(m.transaction_id).toBeNull();
    expect(m.credits_delta).toBe(0);
    expect(m.validity_days_delta).toBe(0);
    expect(m.previous_validity_expires_at).toBeNull();
  });

  it("createMovement() stores previous_validity_expires_at (v141, M2 fix) — including a real date, verbatim", () => {
    const m = repo.createMovement({
      carrier_line_id: 1,
      credits_delta: 0,
      validity_days_delta: 30,
      previous_validity_expires_at: "2020-01-01",
      reason: "SELF_CHARGE",
    });
    expect(m.previous_validity_expires_at).toBe("2020-01-01");

    const reloaded = repo.getById(m.id);
    expect(reloaded!.previous_validity_expires_at).toBe("2020-01-01");
  });

  it("getByCarrierLineId() returns every movement for a line, newest first", () => {
    repo.createMovement({ carrier_line_id: 1, reason: "A" });
    repo.createMovement({ carrier_line_id: 2, reason: "OTHER_LINE" });
    repo.createMovement({ carrier_line_id: 1, reason: "B" });

    const rows = repo.getByCarrierLineId(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.reason).toBe("B"); // newest first
    expect(rows[1]!.reason).toBe("A");
  });

  it("getByTransactionId() returns every movement tied to a transaction, oldest first", () => {
    repo.createMovement({ carrier_line_id: 1, transaction_id: 9, reason: "A" });
    repo.createMovement({ carrier_line_id: 2, transaction_id: 9, reason: "B" });
    repo.createMovement({
      carrier_line_id: 3,
      transaction_id: 10,
      reason: "OTHER_TXN",
    });

    const rows = repo.getByTransactionId(9);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.reason).toBe("A"); // oldest first
    expect(rows[1]!.reason).toBe("B");
  });

  it("getUnreversedByTransactionId() excludes already-reversed rows", () => {
    const m1 = repo.createMovement({
      carrier_line_id: 1,
      transaction_id: 5,
      reason: "A",
    });
    repo.createMovement({ carrier_line_id: 1, transaction_id: 5, reason: "B" });

    repo.markReversed(m1.id);

    const unreversed = repo.getUnreversedByTransactionId(5);
    expect(unreversed).toHaveLength(1);
    expect(unreversed[0]!.reason).toBe("B");
  });

  it("markReversed() flips is_reversed to 1", () => {
    const m = repo.createMovement({ carrier_line_id: 1, reason: "A" });
    expect(m.is_reversed).toBe(0);

    repo.markReversed(m.id);

    const reloaded = repo.getById(m.id);
    expect(reloaded!.is_reversed).toBe(1);
  });

  it("markReversed() is idempotent — calling it twice does not error and leaves is_reversed=1", () => {
    const m = repo.createMovement({ carrier_line_id: 1, reason: "A" });
    repo.markReversed(m.id);
    expect(() => repo.markReversed(m.id)).not.toThrow();
    expect(repo.getById(m.id)!.is_reversed).toBe(1);
  });

  it("getById() returns null for a nonexistent id", () => {
    expect(repo.getById(9999)).toBeNull();
  });
});
