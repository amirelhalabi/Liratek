/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * #28 (LIRA-218, v184) — sold-ahead days on `CarrierLineRepository`.
 *
 * Proves, directly against `applyMovement`/`reverseMovement` (no transaction
 * layer involved — `TransactionRepository.carrierLineReversal.test.ts`
 * already covers the void/refund plumbing that calls these):
 *
 *  - A sale that outruns a VALID line's real remaining days pins the real
 *    expiry at `today` and banks the shortfall into `days_owed`, instead of
 *    pushing the real expiry negative (the pre-#28 behaviour, which this
 *    suite also pins for a line that was ALREADY degraded before the sale —
 *    #28 must not touch that path).
 *  - The line is never classified BURNED purely because of a sold-ahead
 *    balance.
 *  - A charge pays `days_owed` off FIRST, 1:1, never refused, before any
 *    remainder reaches the ordinary grace/stacking/ceiling rule — the
 *    owner's own worked example (owed 210, +365 card, lands at today+155).
 *  - create + reverse nets every one of `validity_expires_at`, `days_owed`
 *    back to the exact pre-mutation baseline, for a sell-alone movement AND
 *    a charge-alone (payoff) movement (rule 20/17).
 *
 * Per CLAUDE.md rule 17, the sold-ahead-vs-burned assertions in this file
 * are expected to FAIL against the pre-#28 code (no `days_owed` column, no
 * VALID-line overflow branch) — that is the regression this ticket fixes,
 * and it is what "NOT RUN" hands to the end-of-batch gate to confirm.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import {
  CarrierLineMovementRepository,
  resetCarrierLineMovementRepository,
} from "../CarrierLineMovementRepository.js";
import { CarrierLineService } from "../../services/CarrierLineService.js";
import {
  classifyLineValidity,
  MAX_LINE_VALIDITY_DAYS,
} from "../../utils/carrierLineValidity.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const TODAY = "2026-09-24";

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

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
      days_owed           INTEGER NOT NULL DEFAULT 0,
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
      days_owed_delta               INTEGER NOT NULL DEFAULT 0,
      previous_days_owed            INTEGER NOT NULL DEFAULT 0,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("CarrierLineRepository — sold-ahead days (#28, LIRA-218)", () => {
  let db: Database.Database;
  let lineRepo: CarrierLineRepository;
  let movementRepo: CarrierLineMovementRepository;
  let service: CarrierLineService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
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
    resetTenantContext();
  });

  it("OWNER CASE: sell 360 on a 150-day line, then charge 365, lands at today+155 with days_owed back to 0", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      validity_expires_at: addDays(TODAY, 150),
    });

    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -360,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    const afterSell = lineRepo.getById(line.id)!;
    expect(afterSell.validity_expires_at).toBe(TODAY);
    expect(afterSell.days_owed).toBe(210);
    // Never burned because of days sold ahead.
    expect(classifyLineValidity(afterSell.validity_expires_at, TODAY).state).toBe(
      "VALID",
    );

    const charge = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: 365,
      reason: "SELF_CHARGE",
      today: TODAY,
    });
    expect(charge.success).toBe(true);
    const afterCharge = lineRepo.getById(line.id)!;
    expect(afterCharge.validity_expires_at).toBe(addDays(TODAY, 155));
    expect(afterCharge.days_owed).toBe(0);
  });

  it("a charge on a line with days owed is NEVER refused, even if it would otherwise be burned", () => {
    // A line pinned at today with an owed balance (as sold-ahead produces)
    // is VALID by construction, so classifyLineValidity itself is not
    // BURNED here — this test pins that a charge against it never throws.
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111112",
      validity_expires_at: addDays(TODAY, 5),
    });
    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -50,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    expect(lineRepo.getById(line.id)!.days_owed).toBe(45);

    const charge = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: 10,
      reason: "SELF_CHARGE",
      today: TODAY,
    });
    expect(charge.success).toBe(true);
    expect(charge.error).toBeUndefined();
    const after = lineRepo.getById(line.id)!;
    expect(after.days_owed).toBe(35); // 45 - 10, all applied to the debt
    expect(after.validity_expires_at).toBe(TODAY); // nothing left to stack
  });

  it("a line ALREADY burned before the sale keeps the pre-#28 behaviour (pushed further negative, no owed banking)", () => {
    // #28 must not touch this pre-existing, separately-proven invariant.
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111113",
      validity_expires_at: addDays(TODAY, -22),
    });
    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -10,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    const after = lineRepo.getById(line.id)!;
    expect(after.validity_expires_at).toBe(addDays(TODAY, -32));
    expect(after.days_owed).toBe(0);
  });

  it("rule 20: sell-alone create + reverse nets validity AND days_owed back to the exact baseline", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111114",
      validity_expires_at: addDays(TODAY, 150),
    });
    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -360,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    expect(sell.data!.movement.days_owed_delta).toBe(210);

    const reversed = service.reverseMovement(sell.data!.movement.id, TODAY);
    expect(reversed.success).toBe(true);

    const after = lineRepo.getById(line.id)!;
    expect(after.validity_expires_at).toBe(addDays(TODAY, 150));
    expect(after.days_owed).toBe(0);
  });

  it("rule 20: charge-payoff-alone create + reverse nets days_owed back to the exact baseline", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111115",
      validity_expires_at: TODAY,
    });
    // Seed a pre-existing owed balance directly (as a prior sell movement
    // would have left it) — the write path under test here is the CHARGE's
    // payoff, not how the balance got there.
    lineRepo.updateLine(line.id, { days_owed: 210 });

    const charge = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: 365,
      reason: "SELF_CHARGE",
      today: TODAY,
    });
    expect(charge.success).toBe(true);
    expect(charge.data!.movement.days_owed_delta).toBe(-210);
    const afterCharge = lineRepo.getById(line.id)!;
    expect(afterCharge.days_owed).toBe(0);
    expect(afterCharge.validity_expires_at).toBe(addDays(TODAY, 155));

    const reversed = service.reverseMovement(charge.data!.movement.id, TODAY);
    expect(reversed.success).toBe(true);
    const afterReverse = lineRepo.getById(line.id)!;
    expect(afterReverse.days_owed).toBe(210);
    expect(afterReverse.validity_expires_at).toBe(TODAY);
  });

  it("a sell that stays within the line's real remaining days behaves exactly as before #28 (no owed banking)", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111116",
      validity_expires_at: addDays(TODAY, 30),
    });
    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -10,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    const after = lineRepo.getById(line.id)!;
    expect(after.validity_expires_at).toBe(addDays(TODAY, 20));
    expect(after.days_owed).toBe(0);
    expect(sell.data!.movement.days_owed_delta).toBe(0);
  });

  // M1/M2/m3 fix (2026-09-24 adversarial review). Per CLAUDE.md rule 17,
  // these are expected to FAIL against the pre-fix reverseMovement, which
  // reversed every sell by bare `addDaysToDateString(current, magnitude)`
  // with no shortfall reclaim, no NO_EXPIRY verbatim-null special case, and
  // no ceiling re-check.

  it("M1: refunding a sold-ahead sale AFTER a later charge has paid off the debt reclaims the paid-off portion back onto the expiry, capped at 365", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111117",
      validity_expires_at: addDays(TODAY, 150),
    });

    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -360,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);

    const charge = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: 365,
      reason: "SELF_CHARGE",
      today: TODAY,
    });
    expect(charge.success).toBe(true);
    expect(lineRepo.getById(line.id)!.days_owed).toBe(0);
    expect(lineRepo.getById(line.id)!.validity_expires_at).toBe(
      addDays(TODAY, 155),
    );

    // Refund the SELL only — the charge stays applied. Before the fix this
    // landed at today+305 with days_owed still 0 (the 210 days the charge
    // paid off simply vanished); the correct answer reclaims them onto the
    // expiry and re-applies the 365-day ceiling.
    const reversed = service.reverseMovement(sell.data!.movement.id, TODAY);
    expect(reversed.success).toBe(true);
    const after = lineRepo.getById(line.id)!;
    expect(after.validity_expires_at).toBe(addDays(TODAY, MAX_LINE_VALIDITY_DAYS));
    expect(after.days_owed).toBe(0);
  });

  it("M1 companion: voiding the CHARGE alone (sell left in place) restores the pre-charge state with the debt intact — no phantom balance", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111118",
      validity_expires_at: addDays(TODAY, 150),
    });

    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -360,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);

    const charge = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: 365,
      reason: "SELF_CHARGE",
      today: TODAY,
    });
    expect(charge.success).toBe(true);

    const reversed = service.reverseMovement(charge.data!.movement.id, TODAY);
    expect(reversed.success).toBe(true);
    const after = lineRepo.getById(line.id)!;
    expect(after.validity_expires_at).toBe(TODAY);
    expect(after.days_owed).toBe(210);
  });

  it("M2: refunding a day sale off a NO_EXPIRY line restores NULL, not an invented expiry", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111119",
      // no validity_expires_at — NO_EXPIRY
    });

    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -10,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    expect(lineRepo.getById(line.id)!.validity_expires_at).toBe(
      addDays(TODAY, -10),
    );
    expect(sell.data!.movement.days_owed_delta).toBe(0);

    const reversed = service.reverseMovement(sell.data!.movement.id, TODAY);
    expect(reversed.success).toBe(true);
    expect(lineRepo.getById(line.id)!.validity_expires_at).toBeNull();
  });

  it("m3: refunding a plain (non-owed) sell re-applies the 365-day ceiling when a later charge already used the freed-up headroom", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111120",
      validity_expires_at: addDays(TODAY, 30),
    });

    const sell = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: -10,
      reason: "DAYS_SALE",
      today: TODAY,
    });
    expect(sell.success).toBe(true);
    expect(lineRepo.getById(line.id)!.validity_expires_at).toBe(
      addDays(TODAY, 20),
    );

    const charge = service.applyMovement({
      carrierLineId: line.id,
      validityDaysDelta: 365,
      reason: "SELF_CHARGE",
      today: TODAY,
    });
    expect(charge.success).toBe(true);
    expect(lineRepo.getById(line.id)!.validity_expires_at).toBe(
      addDays(TODAY, 365),
    ); // capped

    // Before the fix: today+20 + 10 = today+375, above the ceiling.
    const reversed = service.reverseMovement(sell.data!.movement.id, TODAY);
    expect(reversed.success).toBe(true);
    expect(lineRepo.getById(line.id)!.validity_expires_at).toBe(
      addDays(TODAY, 365),
    );
  });
});
