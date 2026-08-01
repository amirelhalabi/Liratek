/**
 * LIRA-090 Phase 3b — CarrierLineService.applyMovement (spec §5.2, §8).
 *
 * The movement-logged mutation API money-path code (Phase 4,
 * FinancialServiceRepository) calls: applying a credits delta and/or a
 * validity-days delta writes BOTH the `carrier_lines` update AND the
 * `carrier_line_movements` row, inside ONE db transaction — never one
 * without the other.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../../repositories/CarrierLineRepository.js";
import {
  CarrierLineMovementRepository,
  resetCarrierLineMovementRepository,
} from "../../repositories/CarrierLineMovementRepository.js";
import { CarrierLineService } from "../CarrierLineService.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

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

function movementCount(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`).get() as {
      n: number;
    }
  ).n;
}

describe("CarrierLineService.applyMovement (LIRA-090 §5.2/§8)", () => {
  let db: Database.Database;
  let lineRepo: CarrierLineRepository;
  let movementRepo: CarrierLineMovementRepository;
  let service: CarrierLineService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    lineRepo = new CarrierLineRepository();
    movementRepo = new CarrierLineMovementRepository();
    service = new CarrierLineService(lineRepo, movementRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  it("applies a credits delta and writes exactly one movement row, both reflecting the same numbers", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
    });

    const result = service.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 73,
      reason: "ONLY_DAYS_RETURN",
      transactionId: 555,
    });

    expect(result.success).toBe(true);
    expect(result.data!.line.credits).toBeCloseTo(83, 2);
    expect(result.data!.movement.credits_delta).toBeCloseTo(73, 2);
    expect(result.data!.movement.validity_days_delta).toBe(0);
    expect(result.data!.movement.transaction_id).toBe(555);
    expect(result.data!.movement.reason).toBe("ONLY_DAYS_RETURN");
    expect(result.data!.movement.is_reversed).toBe(0);
    expect(movementCount(db)).toBe(1);
  });

  it("applies BOTH a credits delta and a validity-days delta in one call (self-charge shape)", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 0,
      validity_expires_at: null,
    });

    const result = service.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 77,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
    });

    expect(result.success).toBe(true);
    expect(result.data!.line.credits).toBeCloseTo(77, 2);
    expect(result.data!.line.validity_expires_at).not.toBeNull();
    expect(result.data!.movement.credits_delta).toBeCloseTo(77, 2);
    expect(result.data!.movement.validity_days_delta).toBe(30);
    expect(result.data!.movement.transaction_id).toBeNull();
  });

  it("rejects a missing/blank reason and writes NOTHING", () => {
    const line = lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });

    const result = service.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 10,
      reason: "  ",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reason/i);
    expect(movementCount(db)).toBe(0);
    expect(lineRepo.getById(line.id)!.credits).toBe(0);
  });

  it("rejects an all-zero delta (nothing to apply) and writes NOTHING", () => {
    const line = lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });

    const result = service.applyMovement({
      carrierLineId: line.id,
      reason: "NOOP",
    });

    expect(result.success).toBe(false);
    expect(movementCount(db)).toBe(0);
  });

  it("atomicity: a nonexistent carrier line rolls back — NO orphan movement row is left behind", () => {
    const result = service.applyMovement({
      carrierLineId: 9999,
      creditsDelta: 50,
      reason: "ONLY_DAYS_RETURN",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(movementCount(db)).toBe(0);
  });
});

describe("CarrierLineService.reverseMovement (LIRA-090 §8, rule 20)", () => {
  let db: Database.Database;
  let lineRepo: CarrierLineRepository;
  let movementRepo: CarrierLineMovementRepository;
  let service: CarrierLineService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    lineRepo = new CarrierLineRepository();
    movementRepo = new CarrierLineMovementRepository();
    service = new CarrierLineService(lineRepo, movementRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  it("reverses a movement and marks it reversed", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
    });
    const applied = service.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 77,
      reason: "SELF_CHARGE",
      transactionId: 5,
    });

    const result = service.reverseMovement(applied.data!.movement.id);

    expect(result.success).toBe(true);
    expect(result.data!.line.credits).toBeCloseTo(20, 2);
    expect(movementRepo.getById(applied.data!.movement.id)!.is_reversed).toBe(
      1,
    );
  });

  it("returns success:false for a nonexistent movement id", () => {
    const result = service.reverseMovement(9999);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
