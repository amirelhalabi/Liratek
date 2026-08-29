/**
 * LIRA-157 — `applyMovement` honours the owner's validity rule end to end.
 *
 * `carrierLineValidity.test.ts` proves the RULE in isolation. This file proves
 * the repository actually applies it, that a refused charge leaves the database
 * untouched, and that `reverseMovement` still undoes a movement whose forward
 * direction discarded information (a grace rebase or a ceiling clip).
 *
 * RULE 17 — every test below was watched failing against the pre-LIRA-157
 * `computeAppliedState` (`base = expiry > today ? expiry : today; base + delta`,
 * no ceiling, no refusal). Pre-fix results, for the record:
 *
 *   owner case 1 (lapsed 22, +30)  → 2026-09-28 (today+30)   instead of a throw
 *   owner case 2 (30 left, +365)   → today+395                instead of today+365
 *   grace       (lapsed 3, +30)    → today+30                 (agrees — not a proof)
 *   days sale on a lapsed line     → today−10                 instead of expiry−10
 *
 * Note the grace case AGREES with the old rebasing rule: it is the burned and
 * ceiling cases that carry the regression proof. Kept anyway, because it pins
 * the owner's "if charged 30 days it would start from today" against the other
 * reading he was offered (deduct the lapse → today+27).
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { localDay } from "../../utils/localDate.js";
import { LINE_REVIVAL_GRACE_DAYS } from "../../utils/carrierLineValidity.js";

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

/** Independent day-math cross-check — deliberately NOT the production helper,
 *  so these assertions cannot pass by the code agreeing with itself. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function movementCount(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`).get() as {
      n: number;
    }
  ).n;
}

describe("CarrierLineRepository — validity rule (LIRA-157)", () => {
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
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  /** A line whose expiry sits `offsetDays` from today (negative = lapsed). */
  function lineAt(offsetDays: number | null) {
    return repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 0,
      validity_expires_at:
        offsetDays === null ? null : addDays(localDay(), offsetDays),
    });
  }

  function charge(lineId: number, days: number) {
    return repo.applyMovement({
      carrierLineId: lineId,
      creditsDelta: 0,
      validityDaysDelta: days,
      reason: "SELF_CHARGE",
      transactionId: null,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The owner's two reported cases
  // ───────────────────────────────────────────────────────────────────────────

  it("OWNER CASE: 30 days left + a 365-day card reads 365 days, not 395", () => {
    const line = lineAt(30);
    const { line: updated } = charge(line.id, 365);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 365));
  });

  it("OWNER CASE: a line lapsed 22 days REFUSES a 30-day charge", () => {
    const line = lineAt(-22);
    expect(() => charge(line.id, 30)).toThrow(/burned/i);
  });

  it("the refusal names the lapse and the grace window", () => {
    const line = lineAt(-22);
    expect(() => charge(line.id, 30)).toThrow(/22 days ago/);
    expect(() => charge(line.id, 30)).toThrow(
      new RegExp(String(LINE_REVIVAL_GRACE_DAYS)),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A refused charge must leave NOTHING behind
  // ───────────────────────────────────────────────────────────────────────────

  it("a refused charge writes no movement row and does not touch the line", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 12,
      validity_expires_at: addDays(localDay(), -22),
    });

    expect(() =>
      repo.applyMovement({
        carrierLineId: line.id,
        // Credits ride along on a real self-charge; the rollback must take
        // them with it, or a burned line would silently gain credit.
        creditsDelta: 7.58,
        validityDaysDelta: 30,
        reason: "SELF_CHARGE",
        transactionId: null,
      }),
    ).toThrow(/burned/i);

    const after = repo.getById(line.id)!;
    expect(after.credits).toBeCloseTo(12, 2);
    expect(after.validity_expires_at).toBe(addDays(localDay(), -22));
    expect(movementCount(db)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Grace window (D6.2) — boundary asserted on both sides
  // ───────────────────────────────────────────────────────────────────────────

  it("lapsed 3 days + 30 days starts from TODAY (not today+27, not today+33)", () => {
    const line = lineAt(-3);
    const { line: updated } = charge(line.id, 30);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 30));
  });

  it("lapsed exactly 5 days is still chargeable", () => {
    const line = lineAt(-LINE_REVIVAL_GRACE_DAYS);
    const { line: updated } = charge(line.id, 30);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 30));
  });

  it("lapsed 6 days is refused", () => {
    const line = lineAt(-(LINE_REVIVAL_GRACE_DAYS + 1));
    expect(() => charge(line.id, 30)).toThrow(/burned/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Stacking + ceiling (D6.3)
  // ───────────────────────────────────────────────────────────────────────────

  it("a live line stacks: 30 left + 30 = 60", () => {
    const line = lineAt(30);
    const { line: updated } = charge(line.id, 30);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 60));
  });

  it("exactly 365 from today is not clipped", () => {
    const line = lineAt(null);
    const { line: updated } = charge(line.id, 365);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 365));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Selling days is never refused (negative delta)
  // ───────────────────────────────────────────────────────────────────────────

  it("a DAYS sale subtracts from the line's own expiry", () => {
    const line = lineAt(30);
    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: -10,
      reason: "DAYS_SALE",
      transactionId: null,
    });
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 20));
  });

  it("a DAYS sale on a long-lapsed line is allowed and pushes it further back", () => {
    // Pre-LIRA-157 this rebased onto today and reported today−10, i.e. a line
    // 22 days dead came back reading "expired 10 days ago".
    const line = lineAt(-22);
    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: -10,
      reason: "DAYS_SALE",
      transactionId: null,
    });
    expect(updated.validity_expires_at).toBe(addDays(localDay(), -32));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 20 — reversal still nets to zero through a lossy forward step
  // ───────────────────────────────────────────────────────────────────────────

  it("reverseMovement restores the exact prior date after a CLIPPED charge", () => {
    const before = addDays(localDay(), 30);
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 0,
      validity_expires_at: before,
    });

    const { movement } = charge(line.id, 365); // clipped: 395 → 365
    expect(repo.getById(line.id)!.validity_expires_at).toBe(
      addDays(localDay(), 365),
    );

    const { line: reversed } = repo.reverseMovement(movement.id)!;
    // A naive `-365` would land on today, not `before` — only the snapshot
    // can undo a clip, which is exactly why `previous_validity_expires_at`
    // exists (M2).
    expect(reversed.validity_expires_at).toBe(before);
  });

  it("reverseMovement restores the exact prior date after a GRACE rebase", () => {
    const before = addDays(localDay(), -3);
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 0,
      validity_expires_at: before,
    });

    const { movement } = charge(line.id, 30);
    const { line: reversed } = repo.reverseMovement(movement.id)!;
    expect(reversed.validity_expires_at).toBe(before);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The escape hatch stays open
  // ───────────────────────────────────────────────────────────────────────────

  it("an ABSOLUTE counted date is still accepted on a burned line", () => {
    // D6.4: the money paths refuse a burned line, but a checkpoint count (or
    // an admin hand-edit) records what the carrier actually did and must not
    // be blocked — it is evidence, not a projection.
    const line = lineAt(-400);
    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 0,
      validityExpiresAt: addDays(localDay(), 45),
      reason: "CHECKPOINT",
      transactionId: null,
    });
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 45));
  });

  it("a credits-only movement on a burned line is untouched by the rule", () => {
    // Only-Days credit returns pass validityDaysDelta: 0. They must keep
    // working regardless of the line's validity state.
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 1,
      validity_expires_at: addDays(localDay(), -400),
    });
    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 7,
      validityDaysDelta: 0,
      reason: "ONLY_DAYS_RETURN",
      transactionId: null,
    });
    expect(updated.credits).toBeCloseTo(8, 2);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), -400));
  });
});
