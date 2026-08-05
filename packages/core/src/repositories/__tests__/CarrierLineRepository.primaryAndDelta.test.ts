/**
 * LIRA-090 Phase 3b — CarrierLineRepository: `is_primary` (spec §3 decision
 * 8, H2 fix) + the movement-paired mutation API (`applyMovement`/
 * `reverseMovement`, spec §5.2/§8, H3 + M2 fixes).
 *
 * 2026-07-30 adversarial review found three defects in this file, all
 * proven failing-first (rule 17) before being fixed here:
 *
 *  - H2: `getPrimary()` had no `is_active` predicate, and `archive()`
 *    couldn't clear `is_primary` (excluded from `UpdateCarrierLineData`) —
 *    an archived primary line kept silently receiving automated credit.
 *    Fixed BOTH halves (belt and braces): `archive()` now clears the flag
 *    directly, AND `getPrimary()` independently requires `is_active = 1`.
 *  - H3: `applyDelta`/`reverseDelta` used to be public methods reachable by
 *    any caller holding a `CarrierLineRepository` — only a doc comment
 *    stopped a credits/validity write with no paired movement row. Replaced
 *    with `applyMovement`/`reverseMovement`, which always pair the write
 *    with a `carrier_line_movements` row in the SAME db transaction; the
 *    raw delta math is now a private, module-level helper unreachable from
 *    outside the file.
 *  - M2: the old `reverseDelta` silently dropped the validity restore when
 *    the CURRENT expiry was null, and (separately) could not undo the §5.2
 *    "already-expired lines extend from today" rebasing via naive day
 *    subtraction. `reverseMovement` now restores `validity_expires_at` from
 *    the movement's own stored `previous_validity_expires_at` VERBATIM.
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

/** Independent (re-implemented, not imported) day-math cross-check — adds
 *  `days` to a `YYYY-MM-DD` string in UTC. Deliberately duplicated rather
 *  than importing the production helper, so the test doesn't just assert
 *  "the function agrees with itself". */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${(dt.getUTCMonth() + 1).toString().padStart(2, "0")}-${dt.getUTCDate().toString().padStart(2, "0")}`;
}

function movementCount(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`).get() as {
      n: number;
    }
  ).n;
}

describe("CarrierLineRepository — is_primary (LIRA-090 §3 decision 8)", () => {
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

  it("getPrimary() returns null when no line has been designated primary", () => {
    repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    expect(repo.getPrimary("mtc")).toBeNull();
  });

  it("setPrimary() sets the flag and getPrimary() then finds it", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    const updated = repo.setPrimary(line.id);
    expect(updated!.is_primary).toBe(1);

    const primary = repo.getPrimary("mtc");
    expect(primary!.id).toBe(line.id);
  });

  it("setPrimary() clears the PREVIOUS primary for the same carrier — never two at once", () => {
    const lineA = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    const lineB = repo.createLine({ carrier: "mtc", phone_number: "03222222" });

    repo.setPrimary(lineA.id);
    expect(repo.getPrimary("mtc")!.id).toBe(lineA.id);

    // Promoting B must demote A in the SAME call — not throw, not leave both set.
    repo.setPrimary(lineB.id);

    const all = repo.getAllIncludingInactive();
    const primaries = all.filter((l) => l.is_primary === 1);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.id).toBe(lineB.id);
    expect(repo.getPrimary("mtc")!.id).toBe(lineB.id);
  });

  it("primaries are independent per carrier — setting mtc's primary never touches alfa's", () => {
    const mtcLine = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
    });
    const alfaLine = repo.createLine({
      carrier: "alfa",
      phone_number: "70222222",
    });

    repo.setPrimary(alfaLine.id);
    repo.setPrimary(mtcLine.id);

    expect(repo.getPrimary("mtc")!.id).toBe(mtcLine.id);
    expect(repo.getPrimary("alfa")!.id).toBe(alfaLine.id);
  });

  it("returns null from setPrimary() for a nonexistent id", () => {
    expect(repo.setPrimary(9999)).toBeNull();
  });

  it("proves the guard is load-bearing: two lines flipped to is_primary=1 WITHOUT clearing the first throws the UNIQUE constraint (this is why setPrimary must clear-then-set in one transaction)", () => {
    const lineA = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    const lineB = repo.createLine({ carrier: "mtc", phone_number: "03222222" });

    db.prepare(`UPDATE carrier_lines SET is_primary = 1 WHERE id = ?`).run(
      lineA.id,
    );

    expect(() => {
      db.prepare(`UPDATE carrier_lines SET is_primary = 1 WHERE id = ?`).run(
        lineB.id,
      );
    }).toThrow(/UNIQUE constraint failed/);
  });

  // ---------------------------------------------------------------------------
  // H2 — archiving the primary line (2026-07-30 adversarial review)
  // ---------------------------------------------------------------------------

  it("H2 fix, half 1: archive() clears is_primary — an archived line is no longer flagged primary", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.setPrimary(line.id);
    expect(repo.getPrimary("mtc")!.id).toBe(line.id);

    repo.archive(line.id);

    const archived = repo.getById(line.id)!;
    expect(archived.is_active).toBe(0);
    expect(archived.is_primary).toBe(0);
  });

  it("toggleActive() OFF also clears is_primary — the second deactivation path", () => {
    // Found by adversarial review 2026-08-04. archive() clears is_primary;
    // toggleActive() did not, and the Settings > Carrier Lines row exposes
    // BOTH (the red "Archive" button and the green Active/Archived pill).
    // Deactivating via the pill left is_active=0 WITH is_primary=1, so the UI
    // showed "Archived" and "Primary" on the same row while getPrimary()
    // returned null — the carrier silently had no effective primary line, and
    // every Only-Days sale stopped updating carrier-line credits/validity with
    // nothing on screen to say so. getPrimary()'s is_active predicate (half 2
    // below) keeps the MONEY correct either way; this is about the row not
    // lying and the operator not losing tracking silently.
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.setPrimary(line.id);
    expect(repo.getPrimary("mtc")!.id).toBe(line.id);

    repo.toggleActive(line.id);

    const deactivated = repo.getById(line.id)!;
    expect(deactivated.is_active).toBe(0);
    expect(deactivated.is_primary).toBe(0);
    expect(repo.getPrimary("mtc")).toBeNull();
  });

  it("toggleActive() ON does not resurrect a primary flag", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.setPrimary(line.id);
    repo.toggleActive(line.id); // off — clears the flag
    repo.toggleActive(line.id); // back on — must NOT come back primary

    const reactivated = repo.getById(line.id)!;
    expect(reactivated.is_active).toBe(1);
    expect(reactivated.is_primary).toBe(0);
    expect(repo.getPrimary("mtc")).toBeNull();
  });

  it("H2 fix, half 2 (belt-and-braces): getPrimary() ignores an inactive line even if is_primary somehow still reads 1", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.setPrimary(line.id);

    // Bypass archive() entirely — flip is_active off at the raw SQL level,
    // simulating ANY path (present or future) that could leave a stale
    // is_primary=1 on an inactive row. getPrimary() must not depend on
    // archive() being the only way a line goes inactive.
    db.prepare(`UPDATE carrier_lines SET is_active = 0 WHERE id = ?`).run(
      line.id,
    );

    expect(repo.getPrimary("mtc")).toBeNull();
  });

  it("H2: archiving the primary line means getPrimary() finds NO primary for that carrier afterward (end-to-end)", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.setPrimary(line.id);
    expect(repo.getPrimary("mtc")).not.toBeNull();

    repo.archive(line.id);

    expect(repo.getPrimary("mtc")).toBeNull();
  });

  it("archiving a NON-primary line does not disturb the actual primary", () => {
    const primaryLine = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
    });
    const otherLine = repo.createLine({
      carrier: "mtc",
      phone_number: "03222222",
    });
    repo.setPrimary(primaryLine.id);

    repo.archive(otherLine.id);

    expect(repo.getPrimary("mtc")!.id).toBe(primaryLine.id);
  });
});

describe("CarrierLineRepository — applyMovement/reverseMovement (LIRA-090 §5.2/§8, H3 + M2)", () => {
  let db: Database.Database;
  let repo: CarrierLineRepository;
  let movementRepo: CarrierLineMovementRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    repo = new CarrierLineRepository();
    movementRepo = new CarrierLineMovementRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  // ---------------------------------------------------------------------------
  // H3 — structural guard: the raw delta primitives are unreachable
  // ---------------------------------------------------------------------------

  it("H3 guard: applyDelta/reverseDelta no longer exist as methods on CarrierLineRepository", () => {
    const instance = new CarrierLineRepository();
    expect(
      (instance as unknown as { applyDelta?: unknown }).applyDelta,
    ).toBeUndefined();
    expect(
      (instance as unknown as { reverseDelta?: unknown }).reverseDelta,
    ).toBeUndefined();
  });

  it("H3 guard: applyMovement() ALWAYS writes exactly one movement row alongside the line update — never one without the other", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
    });

    repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 73,
      validityDaysDelta: 0,
      reason: "ONLY_DAYS_RETURN",
      transactionId: 1,
    });

    expect(movementCount(db)).toBe(1);
    expect(repo.getById(line.id)!.credits).toBeCloseTo(83, 2);
  });

  // ---------------------------------------------------------------------------
  // applyMovement — forward mutation (credits-only, validity-only, combined)
  // ---------------------------------------------------------------------------

  it("credits-only movement leaves validity_expires_at untouched", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
      validity_expires_at: "2099-01-01",
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 73,
      validityDaysDelta: 0,
      reason: "ONLY_DAYS_RETURN",
      transactionId: null,
    });
    expect(updated.credits).toBeCloseTo(83, 2);
    expect(updated.validity_expires_at).toBe("2099-01-01");
  });

  it("validity-only movement on a line with NO current expiry extends from today", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 5,
      validity_expires_at: null,
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: null,
    });
    expect(updated.credits).toBeCloseTo(5, 2);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 30));
  });

  it("validity movement on a NOT-YET-expired line extends from the current expiry (not today)", () => {
    const future = addDays(localDay(), 60);
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      validity_expires_at: future,
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 10,
      reason: "SELF_CHARGE",
      transactionId: null,
    });
    expect(updated.validity_expires_at).toBe(addDays(future, 10));
  });

  it("§5.2 load-bearing case: validity movement on an ALREADY-EXPIRED line extends from TODAY, not the stale date", () => {
    const stale = addDays(localDay(), -90);
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      validity_expires_at: stale,
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 10,
      reason: "SELF_CHARGE",
      transactionId: null,
    });
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 10));
  });

  it("combined credits + validity movement applies both in one call", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 0,
      validity_expires_at: null,
    });

    const { line: updated } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 77,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: null,
    });
    expect(updated.credits).toBeCloseTo(77, 2);
    expect(updated.validity_expires_at).toBe(addDays(localDay(), 30));
  });

  it("applyMovement() throws for a nonexistent carrier line and writes NO movement row (atomic rollback)", () => {
    expect(() =>
      repo.applyMovement({
        carrierLineId: 9999,
        creditsDelta: 10,
        validityDaysDelta: 10,
        reason: "SELF_CHARGE",
        transactionId: null,
      }),
    ).toThrow(/not found/i);
    expect(movementCount(db)).toBe(0);
  });

  it("reverseMovement() returns null for a nonexistent movement id", () => {
    expect(repo.reverseMovement(9999)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // reverseMovement — the common (not-already-expired, non-null) case
  // ---------------------------------------------------------------------------

  it("reverseMovement() is the exact inverse of applyMovement() — nets BOTH credits and validity back to 0 change (not-already-expired case)", () => {
    const future = addDays(localDay(), 60);
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
      validity_expires_at: future,
    });

    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 77,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: 42,
    });
    expect(repo.getById(line.id)!.credits).toBeCloseTo(97, 2);
    expect(repo.getById(line.id)!.validity_expires_at).toBe(
      addDays(future, 30),
    );

    const { line: reversed } = repo.reverseMovement(movement.id)!;
    expect(reversed.credits).toBeCloseTo(20, 2);
    expect(reversed.validity_expires_at).toBe(future);
  });

  it("reverseMovement() with a zero validity delta leaves validity_expires_at untouched", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 50,
      validity_expires_at: "2099-06-01",
    });
    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 20,
      validityDaysDelta: 0,
      reason: "ONLY_DAYS_RETURN",
      transactionId: 1,
    });

    const { line: reversed } = repo.reverseMovement(movement.id)!;
    expect(reversed.credits).toBeCloseTo(50, 2); // back to the pre-apply value
    expect(reversed.validity_expires_at).toBe("2099-06-01");
  });

  it("reverseMovement() marks the movement is_reversed=1 and is idempotent on a second call", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
    });
    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 15,
      validityDaysDelta: 0,
      reason: "ONLY_DAYS_RETURN",
      transactionId: 1,
    });

    repo.reverseMovement(movement.id);
    expect(movementRepo.getById(movement.id)!.is_reversed).toBe(1);
    expect(repo.getById(line.id)!.credits).toBeCloseTo(10, 2);

    // Second call: no-op, no double-subtraction.
    repo.reverseMovement(movement.id);
    expect(repo.getById(line.id)!.credits).toBeCloseTo(10, 2);
  });

  // ---------------------------------------------------------------------------
  // M2 — the two measured bugs (2026-07-30 adversarial review)
  // ---------------------------------------------------------------------------

  it("M2 fix (null-drop): reversing a movement is NOT silently skipped when the line's CURRENT expiry has since gone null", () => {
    // The movement genuinely changed validity from null -> +30 days.
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 50,
      validity_expires_at: null,
    });
    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: 7,
    });
    expect(repo.getById(line.id)!.validity_expires_at).not.toBeNull();

    // An UNRELATED intervening action (e.g. a manual updateBalance) clears
    // the line's CURRENT expiry back to null before the reversal runs.
    db.prepare(
      `UPDATE carrier_lines SET validity_expires_at = NULL WHERE id = ?`,
    ).run(line.id);
    expect(repo.getById(line.id)!.validity_expires_at).toBeNull();

    // Reversing must restore the movement's own stored previous value
    // (null, in this case — the line legitimately had no expiry before this
    // movement) rather than silently no-op'ing because the CURRENT value
    // happens to be null too. Both leave the line at null here, but the
    // load-bearing proof is the NEXT test, where the previous value is
    // non-null while the current value is null — that is where the old
    // guard's silent skip actually lost real data.
    const { line: reversed } = repo.reverseMovement(movement.id)!;
    expect(reversed.validity_expires_at).toBeNull();
  });

  it("M2 fix (null-drop, the load-bearing case): a NON-null previous expiry is restored even though the CURRENT expiry is null at reversal time", () => {
    const originalExpiry = addDays(localDay(), 45);
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 50,
      validity_expires_at: originalExpiry,
    });
    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: 7,
    });
    expect(repo.getById(line.id)!.validity_expires_at).toBe(
      addDays(originalExpiry, 30),
    );

    // Simulate an intervening manual clear (updateBalance, or any other
    // path) that nulls out the CURRENT expiry before the reversal runs.
    db.prepare(
      `UPDATE carrier_lines SET validity_expires_at = NULL WHERE id = ?`,
    ).run(line.id);

    // Pre-fix, `reverseDelta`'s guard (`validityDaysDelta !== 0 &&
    // line.validity_expires_at`) would see the CURRENT value is null and
    // silently skip the restore entirely — leaving it null forever, with no
    // error, even though the movement's own delta clearly owed a real date
    // back. The fix restores the STORED previous_validity_expires_at
    // (originalExpiry) verbatim, regardless of what the current value is.
    const { line: reversed } = repo.reverseMovement(movement.id)!;
    expect(reversed.validity_expires_at).toBe(originalExpiry);
  });

  it("M2 fix (expired-line drift): reversing a movement applied to an ALREADY-EXPIRED line restores the EXACT original stale date, not a day-subtracted approximation", () => {
    const staleExpiry = "2020-01-01"; // long expired
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
      validity_expires_at: staleExpiry,
    });

    // applyMovement's extension rule rebases an already-expired line from
    // TODAY, not the stale date — so the forward result is "today + 30",
    // nowhere near staleExpiry.
    const { movement, line: afterApply } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: 9,
    });
    expect(afterApply.validity_expires_at).toBe(addDays(localDay(), 30));
    expect(afterApply.validity_expires_at).not.toBe(staleExpiry);

    // Pre-fix, `reverseDelta` would subtract 30 days off whatever the
    // CURRENT value is (today + 30 -> today) — landing on TODAY, not the
    // true original staleExpiry ("2020-01-01"). That is the drift bug: a
    // naive day-subtraction can never undo the "extend from today" rebasing
    // because the forward computation never actually used staleExpiry as
    // its base. The fix restores the EXACT stored previous value.
    const { line: reversed } = repo.reverseMovement(movement.id)!;
    expect(reversed.validity_expires_at).toBe(staleExpiry);
  });

  it("M2: the movement row itself stores the pre-mutation previous_validity_expires_at snapshot", () => {
    const staleExpiry = "2020-01-01";
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      validity_expires_at: staleExpiry,
    });

    const { movement } = repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 0,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: 9,
    });

    expect(movement.previous_validity_expires_at).toBe(staleExpiry);
  });
});
