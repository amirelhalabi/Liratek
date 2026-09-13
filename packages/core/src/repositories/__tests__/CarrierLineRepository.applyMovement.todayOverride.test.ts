/**
 * CarrierLineRepository.applyMovement — `today` comes from the CLIENT, not
 * the server clock.
 *
 * Money-adjacent sibling of the `ClosingRepository.createCheckpoint`
 * `closing_date` fix (commit 690dc2b0): on web the process runs on the Fly
 * machine (`fra`, no `TZ` set → UTC), not the shop's Beirut clock (UTC+3).
 * `computeAppliedState`'s `today` decides whether a charge stacks on the
 * line's own expiry, revives it from today (5-day grace), or is REFUSED as
 * burned (`projectValidityExpiry`) — a server day that disagrees with the
 * shop's real calendar day can misclassify a line for up to 3 hours a day,
 * on EVERY self-charge / DAYS-sale / credit-buyback that touches validity.
 * Desktop was never affected: there the server process IS the shop's PC, so
 * server-local and shop-local already agree.
 *
 * The fix: the caller supplies its own local calendar day as `today`, and
 * `applyMovement` prefers it over the server's `localDay()`, which now only
 * covers callers that omit the field.
 *
 * Rule 17: both cases below were run against the pre-fix `applyMovement`
 * (which called `computeAppliedState(line, ..., input.validityExpiresAt)`
 * with no fifth argument, so it always fell through to its own
 * `localDay()` default). The "honours the client value" case FAILED — the
 * NO_EXPIRY line's charge based itself on the real server day instead of the
 * supplied fake day, and the burned-classification case did not throw.
 * Reverted to passing `input.today` through and confirmed identical via git
 * diff.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
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

/** Independent day-math cross-check — deliberately NOT the production
 *  helper, so these assertions cannot pass by the code agreeing with itself. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

describe("CarrierLineRepository.applyMovement — client-supplied `today`", () => {
  let db: Database.Database;
  let repo: CarrierLineRepository;

  // A fixed date, unrelated to whatever real day the suite runs on — proves
  // the override is actually USED, not merely consistent with `localDay()`
  // by coincidence.
  const clientToday = "2020-01-15";

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
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  it("bases a NO_EXPIRY line's charge on the CLIENT's `today`, not the server's", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 0,
      validity_expires_at: null,
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: null,
      today: clientToday,
    });

    // NO_EXPIRY always stacks on `today` — with the override supplied, that
    // must be the client's day, independent of whatever day the suite is
    // actually running on.
    expect(updated.validity_expires_at).toBe(addDays(clientToday, 30));
  });

  it("falls back to the server's localDay() when `today` is omitted", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111112",
      credits: 0,
      validity_expires_at: null,
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: null,
    });

    // Not the fixed client day — proves the fallback path is live (not
    // permanently pinned to clientToday by some other bug).
    expect(updated.validity_expires_at).not.toBe(addDays(clientToday, 30));
  });

  it("REFUSES a charge burned relative to the CLIENT's `today` even though the SAME line reads as VALID under the server's real day", () => {
    // Constructed so the two days disagree on the line's classification —
    // this is what makes the case actually distinguish "the override was
    // used" from "the server's own localDay() was used anyway":
    //   - `futureClientToday` is far ahead of the real server day.
    //   - `expiry` is 10 days BEHIND `futureClientToday` (burned relative to
    //     it — grace is only 5 days).
    //   - That same absolute `expiry` date is still far in the FUTURE
    //     relative to the real server day, so it reads as comfortably VALID
    //     from the server's own perspective.
    // If `today` reaches `computeAppliedState`, this charge is REFUSED. If it
    // is silently ignored (the pre-fix bug — always falling back to the
    // server's `localDay()`), the charge SUCCEEDS instead (VALID stacks the
    // extra days on top of the existing future expiry).
    const realToday = localDay();
    const futureClientToday = addDays(realToday, 1000);
    const expiry = addDays(futureClientToday, -10);

    const line = repo.createLine({
      carrier: "alfa",
      phone_number: "70222222",
      credits: 0,
      validity_expires_at: expiry,
    });

    expect(() =>
      repo.applyMovement({
        carrierLineId: line.id,
        creditsDelta: 0,
        validityDaysDelta: 30,
        reason: "SELF_CHARGE",
        transactionId: null,
        today: futureClientToday,
      }),
    ).toThrow(/burned/i);

    // Refused write leaves the line and the movement log untouched.
    const untouched = repo.getById(line.id)!;
    expect(untouched.validity_expires_at).toBe(expiry);
    const movementCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`).get() as {
        n: number;
      }
    ).n;
    expect(movementCount).toBe(0);
  });
});
