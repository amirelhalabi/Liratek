/**
 * Carrier-line validity model — the ONE definition (rule 14).
 *
 * A shop-owned alfa/mtc SIM line carries a validity expiry date. Charging the
 * line with a prepaid card adds that card's `validity_days`; selling days to a
 * customer off the Days tab subtracts them. This module owns *where the new
 * expiry lands*, for every path that moves it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE (owner interview 2026-08-29, LIRA-157 — supersedes LIRA-090 §5.2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Charging a line (`daysDelta > 0`) branches on how the line stands *today*:
 *
 * | Line state                     | Base the days are added to | Why                                   |
 * | ------------------------------ | -------------------------- | ------------------------------------- |
 * | no expiry recorded             | today                      | nothing to stack onto                 |
 * | valid (expiry >= today)        | **the current expiry**     | new days stack on top of what is left |
 * | lapsed by <= 5 days (GRACE)    | **today**                  | the carrier revives it from today     |
 * | lapsed by > 5 days (BURNED)    | — **charge is refused**    | the number is dead; buy a new line    |
 *
 * ...then the result is clipped to at most {@link MAX_LINE_VALIDITY_DAYS} days
 * from today. A line can never hold more than a year of validity, so a 365-day
 * card bought on a line with 30 days left yields 365, not 395.
 *
 * Selling days (`daysDelta < 0`) subtracts from the line's own expiry and is
 * never refused — it is a consumption record, not a revival, so neither the
 * grace window nor the burned check applies to it. (Before LIRA-157 this path
 * rebased a lapsed line onto today, which reported a lapsed line as *less*
 * expired than it really was after selling days off it.)
 *
 * WHAT THIS SUPERSEDES. LIRA-090 §5.2 rebased **every** lapsed line onto today
 * ("10 more days on a line that lapsed three months ago lands 10 days from
 * now"). That was a defensive convenience, never an owner decision, and it
 * silently forgave an unbounded lapse: a line dead for three months read as
 * healthy the moment anything touched it. The owner's actual carrier rule is
 * the table above — a 5-day grace, then the line is gone.
 *
 * Everything here is pure (no DB, no I/O, `today` injectable) so the repository
 * write path, the reversal path, and the pre-submit UI warning all compute the
 * SAME projection from the same code instead of three drifting copies.
 *
 * ⚠ This module is re-exported from `browser.ts` (KatchForm and
 * CarrierLinesPanel both import from it), so it must stay free of Node
 * built-ins — that means `localDay()`, never `clientDay()`, for the `today`
 * default: `clientDay()` lives in the server-only `utils/requestDay.ts` and
 * pulls in `node:async_hooks` via the tenant context. Server callers on the
 * request path resolve the day themselves and pass `today` explicitly
 * (`CarrierLineRepository.computeAppliedState` does); in the browser
 * `localDay()` IS the client's own day, which is the value the server would
 * have received anyway.
 *
 * The generic `YYYY-MM-DD` arithmetic this rule is built on —
 * `addDaysToDateString`/`daysBetweenDateStrings` — used to be defined here,
 * but that made every date-neutral caller (loto checkpoints, reporting date
 * ranges) import a carrier-line module just to add a day to a date. They now
 * live in `./calendarDate.js`, which this file imports; carrier-line rules
 * stay here, generic calendar maths lives there.
 */

import { localDay } from "./localDate.js";
import { addDaysToDateString, daysBetweenDateStrings } from "./calendarDate.js";

// =============================================================================
// Constants (owner-stated, 2026-08-29)
// =============================================================================

/**
 * The most validity a line can ever hold, counted from today.
 *
 * Owner: _"A line can have max 365 days validity."_ This is a ceiling on the
 * line's REMAINING validity, not on a single card — the 77.28 alfa/mtc card
 * (the longest in the catalog, `TELECOM_DAYS_COST_PLAN.md` §1) is itself
 * exactly 365 days, so buying one on a line that already has days left is the
 * case that hits the clip.
 */
export const MAX_LINE_VALIDITY_DAYS = 365;

/**
 * How many days a line may sit expired and still be revivable by a charge.
 *
 * Owner: _"can be maximum expired 5 days ago to be charged 30 days. if charged
 * 30 days it would start from today. expired more than 5 days ago means the
 * line was burned, we need to buy a new one."_
 *
 * Inclusive: lapsed by exactly 5 days is still chargeable; 6 is not.
 */
export const LINE_REVIVAL_GRACE_DAYS = 5;

// =============================================================================
// Classification
// =============================================================================

export type LineValidityState =
  /** No expiry has ever been recorded for this line. */
  | "NO_EXPIRY"
  /** Expiry is today or later — the line is live. */
  | "VALID"
  /** Expired, but within {@link LINE_REVIVAL_GRACE_DAYS}. Still chargeable. */
  | "GRACE"
  /** Expired beyond the grace window. The number is dead. */
  | "BURNED";

export interface LineValidityClassification {
  state: LineValidityState;
  /** Whole days the line has been expired. 0 for VALID and NO_EXPIRY. */
  lapseDays: number;
  /** Whole days of validity left. 0 for NO_EXPIRY, negative when lapsed. */
  daysRemaining: number;
}

/**
 * Where a line stands relative to today. Pure whenever `today` is supplied explicitly (as every test here does) — pass `today` to test it across a date boundary without mocking a clock. The default (`localDay()`) is the one impure part: it reads the machine's own calendar day, for the rare direct caller that omits it (`CarrierLineRepository.applyMovement`'s production path always resolves and passes `today` explicitly, so this default is not on that hot path today; the browser callers that DO omit it are running on the client's own clock, which is the right day).
 *
 * `daysRemaining` here MUST agree with the frontend's `daysRemaining()`
 * display helper (`frontend/src/shared/utils/daysRemaining.ts`): both are
 * `expiry − today` in whole UTC days, so a line the UI paints as "expired 6d"
 * is exactly the line this classifies BURNED.
 */
export function classifyLineValidity(
  expiry: string | null | undefined,
  today: string = localDay(),
): LineValidityClassification {
  if (!expiry) return { state: "NO_EXPIRY", lapseDays: 0, daysRemaining: 0 };

  const daysRemaining = daysBetweenDateStrings(today, expiry);
  if (daysRemaining >= 0) {
    return { state: "VALID", lapseDays: 0, daysRemaining };
  }

  const lapseDays = -daysRemaining;
  return {
    state: lapseDays <= LINE_REVIVAL_GRACE_DAYS ? "GRACE" : "BURNED",
    lapseDays,
    daysRemaining,
  };
}

// =============================================================================
// Projection
// =============================================================================

export interface ValidityProjection {
  /**
   * The expiry the movement would produce, or `null` when `burned` is true
   * (there is no answer — the charge must not happen at all).
   */
  expiry: string | null;
  /** True when {@link MAX_LINE_VALIDITY_DAYS} clipped the result. */
  capped: boolean;
  /** True when the line is too far lapsed to be charged. */
  burned: boolean;
  /** How the line stood before the movement. */
  state: LineValidityState;
  /** Whole days the line had been expired (0 when not lapsed). */
  lapseDays: number;
  /** Days that were clipped away by the ceiling. 0 when `capped` is false. */
  daysLostToCap: number;
}

/**
 * Project a line's new expiry for a `daysDelta` day movement, per THE RULE at
 * the top of this file. Pure whenever `today` is supplied explicitly (as every test here does) — pass `today` to test it across a date boundary without mocking a clock. The default (`localDay()`) is the one impure part: it reads the machine's own calendar day, for the rare direct caller that omits it (`CarrierLineRepository.applyMovement`'s production path always resolves and passes `today` explicitly, so this default is not on that hot path today; the browser callers that DO omit it are running on the client's own clock, which is the right day).
 *
 * A zero delta is a no-op that reports the line's current state, so callers can
 * use this to classify without branching on the delta first.
 *
 * **Callers must check `burned` before writing.** This function does not throw;
 * `CarrierLineRepository.applyMovement` is the one place that turns a burned
 * projection into a refused write, so the UI can call this for a warning
 * without needing a try/catch.
 */
export function projectValidityExpiry(
  expiry: string | null | undefined,
  daysDelta: number,
  today: string = localDay(),
): ValidityProjection {
  const { state, lapseDays } = classifyLineValidity(expiry, today);
  const unchanged: ValidityProjection = {
    expiry: expiry ?? null,
    capped: false,
    burned: false,
    state,
    lapseDays,
    daysLostToCap: 0,
  };

  if (daysDelta === 0) return unchanged;

  // Selling days is a consumption record: it subtracts from whatever the line
  // actually holds and is never refused. No grace, no burned check — see the
  // header. A line with no expiry at all has nothing to consume from, so it
  // anchors on today (preserving the pre-LIRA-157 behaviour for that case).
  if (daysDelta < 0) {
    const base = expiry ?? today;
    return { ...unchanged, expiry: addDaysToDateString(base, daysDelta) };
  }

  if (state === "BURNED") {
    return { ...unchanged, expiry: null, burned: true };
  }

  // VALID stacks onto the line's own expiry; NO_EXPIRY and GRACE both start
  // from today (the owner's "if charged 30 days it would start from today").
  const base = state === "VALID" ? (expiry as string) : today;
  const extended = addDaysToDateString(base, daysDelta);
  const ceiling = addDaysToDateString(today, MAX_LINE_VALIDITY_DAYS);

  if (extended > ceiling) {
    return {
      ...unchanged,
      expiry: ceiling,
      capped: true,
      daysLostToCap: daysBetweenDateStrings(ceiling, extended),
    };
  }
  return { ...unchanged, expiry: extended };
}

/**
 * The operator-facing reason a charge was refused. Used verbatim as the thrown
 * error message so the same sentence reaches the IPC envelope, the REST
 * envelope, and the form — one string, not three paraphrases.
 */
export function burnedLineMessage(lapseDays: number): string {
  return (
    `This line expired ${lapseDays} days ago and is burned — a line can only be ` +
    `revived within ${LINE_REVIVAL_GRACE_DAYS} days of expiring. Register a new line.`
  );
}
