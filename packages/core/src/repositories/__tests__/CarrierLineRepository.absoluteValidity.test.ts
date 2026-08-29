/**
 * `applyMovement`'s ABSOLUTE-date variant (carrier-lines-validity Phase 3).
 *
 * The checkpoint needs "the operator read this expiry off the SIM", which the
 * day-delta form cannot express. Under spec §5.2 a delta was rebased onto
 * `max(today, current_expiry)`, so on an already-expired line it landed
 * relative to TODAY rather than on the counted date. LIRA-157 made that worse
 * for this use case, not better: past the 5-day revival grace a positive delta
 * is REFUSED outright, so the lines a checkpoint most needs to correct cannot
 * be expressed as a delta at all.
 *
 * The absolute variant is therefore exempt from the whole rule — no ceiling,
 * no burned check. It records what the carrier actually says (evidence), where
 * a delta projects what a charge would do. The first test below pins that
 * refusal; the rest pin the absolute variant Phase 3 added alongside it.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
  carrierDrawerName,
  CARRIER_DRAWER_NAMES,
} from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { CarrierLineService } from "../../services/CarrierLineService.js";
import { localDay } from "../../utils/localDate.js";

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
      id                           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                    INTEGER,
      carrier_line_id              INTEGER NOT NULL,
      transaction_id               INTEGER,
      credits_delta                REAL NOT NULL DEFAULT 0,
      validity_days_delta          INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      reason                       TEXT NOT NULL,
      is_reversed                  INTEGER NOT NULL DEFAULT 0,
      created_at                   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("CarrierLineRepository — absolute validity date (Phase 3)", () => {
  let db: Database.Database;
  let repo: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    repo = new CarrierLineRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  // LIRA-157 rewrote this case. It used to be a CHARACTERISATION of the §5.2
  // rebasing ("a day-delta on an EXPIRED line rebases onto today"), asserting
  // the result landed in the future rather than on 2020-01-11. Under the
  // owner's real rule a line six years lapsed is BURNED, so the day-delta form
  // now REFUSES outright.
  //
  // The point this test exists to make is unchanged and, if anything, stronger:
  // a day-delta cannot express "the operator read this date off the SIM", which
  // is precisely why the checkpoint needs the absolute-date variant. Before
  // LIRA-157 a delta landed on the WRONG date; now it cannot be used at all on
  // the very lines a checkpoint most needs to correct.
  it("a day-delta CANNOT record a counted date on a long-expired line — it is refused", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      validity_expires_at: "2020-01-01",
    });

    expect(() =>
      repo.applyMovement({
        carrierLineId: line.id,
        creditsDelta: 0,
        validityDaysDelta: 10,
        reason: "SELF_CHARGE",
        transactionId: null,
      }),
    ).toThrow(/burned/i);

    // Unchanged — and still nowhere near the 2020-01-11 a naive
    // `stored + delta` reading would have produced.
    expect(repo.getById(line.id)!.validity_expires_at).toBe("2020-01-01");
    expect(localDay() > "2020-01-01").toBe(true);
  });

  it("an absolute date is stored verbatim on an expired line", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 12,
      validity_expires_at: "2020-01-01",
    });

    const { line: updated, movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 0,
      validityExpiresAt: "2026-12-31",
      reason: "CHECKPOINT",
      transactionId: null,
    });

    expect(updated.validity_expires_at).toBe("2026-12-31");
    expect(updated.credits).toBe(12);
    expect(movement.previous_validity_expires_at).toBe("2020-01-01");
    // Audit-trail day figure: the true calendar difference, not a rebasing.
    expect(movement.validity_days_delta).toBe(2556);
  });

  it("records a 0 day-delta when the line had no previous expiry", () => {
    const line = repo.createLine({ carrier: "alfa", phone_number: "70999999" });

    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 0,
      validityExpiresAt: "2026-12-31",
      reason: "CHECKPOINT",
      transactionId: null,
    });

    expect(movement.previous_validity_expires_at).toBeNull();
    expect(movement.validity_days_delta).toBe(0);
    expect(repo.getById(line.id)!.validity_expires_at).toBe("2026-12-31");
  });

  it("refuses an absolute date together with a non-zero day delta", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });

    expect(() =>
      repo.applyMovement({
        carrierLineId: line.id,
        creditsDelta: 0,
        validityDaysDelta: 5,
        validityExpiresAt: "2026-12-31",
        reason: "CHECKPOINT",
        transactionId: null,
      }),
    ).toThrow(/mutually exclusive/i);
    // Nothing was written on the rejected call.
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`)
          .get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it("the service accepts a validity-only absolute movement with zero credits", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      validity_expires_at: "2026-01-01",
    });
    const service = new CarrierLineService(repo);

    const result = service.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityExpiresAt: "2026-02-01",
      reason: "CHECKPOINT",
    });

    expect(result.success).toBe(true);
    expect(result.data!.line.validity_expires_at).toBe("2026-02-01");

    // …and still rejects a movement that changes nothing at all.
    const empty = service.applyMovement({
      carrierLineId: line.id,
      reason: "CHECKPOINT",
    });
    expect(empty.success).toBe(false);
  });

  it("the carrier → provider-drawer map has one definition", () => {
    expect(carrierDrawerName("mtc")).toBe("MTC");
    expect(carrierDrawerName("alfa")).toBe("Alfa");
    expect(CARRIER_DRAWER_NAMES).toEqual({ mtc: "MTC", alfa: "Alfa" });
  });
});
