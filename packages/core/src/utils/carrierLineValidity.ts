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
 * (#28/M4 exception: a BURNED line that still carries a `daysOwed` balance —
 * see below — is never refused; it revives from today like GRACE instead.)
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
 * ─────────────────────────────────────────────────────────────────────────────
 * SOLD-AHEAD DAYS (owner interview 2026-09-24, LIRA-218/#28)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A sale can ask for more days than the line actually has left. The shop
 * still sells the FULL period in one transaction — "seamless to the
 * customer" — but the line can only physically transfer what it holds
 * TODAY; the rest is a promise, fulfilled later once the line is recharged
 * and the shop separately delivers those days (the "days still to send"
 * list, `CarrierLineOwedDeliveryRepository`; `Mark sent` records delivery
 * without ever creating a second sale/charge).
 *
 * `daysOwed` on the line is that promise's running balance, and it ONLY
 * engages when the line is currently VALID (real, non-negative days left)
 * and the sale outruns them — the owner's actual scenario ("shop line has 5
 * months, sell 12"):
 *
 * | Line state at sale time | Real days available | Real expiry                     | daysOwed              |
 * | ------------------------ | -------------------- | -------------------------------- | ---------------------- |
 * | VALID, sold <= days left | days remaining        | `expiry - sold` (unchanged rule) | unchanged              |
 * | VALID, sold > days left  | days remaining        | pinned to `today` (0 real days)  | `+= sold − days left`  |
 * | GRACE (lapsed <= 5d)     | 0                     | **unchanged — left exactly where it is** | `+= sold` (the whole sale) |
 *
 * A GRACE line has already run out — the fix in the table above (2026-09-24
 * adversarial review, M3) treats it exactly like a VALID line with 0 real
 * days left: the entire sale is sold ahead, and the stored expiry is NOT
 * touched. Before this fix a GRACE-state sale fell through to the pre-#28
 * arithmetic (`expiry + daysDelta`), which subtracts the sale straight off
 * an already-lapsed date and pins the line to BURNED immediately — exactly
 * the "never burned because of days sold ahead" case the owner described,
 * and the one the pre-fix code got wrong (a line 2 days into grace, sold 30
 * days, landed at `today - 32`, freshly BURNED, banking nothing).
 *
 * A line that is ALREADY NO_EXPIRY or BURNED before this sale still keeps
 * the pre-#28 arithmetic (subtract off `expiry ?? today`, no owed banking) —
 * a BURNED line's next sale pushing it further into the past is a
 * pre-existing, separately-proven invariant (LIRA-157) that #28 does not
 * touch, and NO_EXPIRY is an explicit open question (see the fix-round
 * report) rather than a silent policy call. Only VALID and GRACE lines are
 * ever pinned by an oversized sale; #28 never "revives" an already-dead one.
 *
 * Charging (`daysDelta > 0`) pays off `daysOwed` FIRST, at 1:1, before any
 * of the card's days reach the stacking rule above — and this portion is
 * **never refused**, regardless of the line's real state. This used to rest
 * on an invariant ("a line carrying daysOwed is never really burned") that
 * the GRACE-sale pinning alone guaranteed; it no longer does, because a
 * days-owed line's OWN pinned expiry (or an untouched GRACE expiry) can
 * still age past the grace window while nobody recharges it (M4, 2026-09-24
 * adversarial review) — so the burned-refusal branch below explicitly
 * exempts any line still carrying a `daysOwed` balance, rather than relying
 * on that balance implying non-burned. Only the REMAINDER left after paying
 * off the debt is subject to the ordinary VALID/GRACE/BURNED stacking and
 * the {@link MAX_LINE_VALIDITY_DAYS} ceiling — matching the owner's own
 * example: a line owing 210 days, charged a 365-day card, pays off the 210
 * and lands the remaining 155 on the real expiry (`today + 155`), starting
 * from `today` (not the dead expiry) exactly like the GRACE/NO_EXPIRY case.
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
  /** The line's `days_owed` balance AFTER this movement (#28). Unchanged
   *  from the input `daysOwed` for a zero-delta no-op. */
  daysOwed: number;
  /** Sell only: the portion of THIS sale that could not be covered by the
   *  line's real remaining days and was banked into {@link daysOwed}
   *  instead. 0 for a charge, and 0 for a sell that stayed within what the
   *  line had available. */
  soldAhead: number;
  /** Charge only: the portion of THIS charge's days that paid down an
   *  existing {@link daysOwed} balance rather than stacking onto the real
   *  expiry. 0 for a sell. */
  owedApplied: number;
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
  /** The line's CURRENT sold-ahead balance (#28). Defaults to 0 for every
   *  pre-#28 caller, which reproduces the pre-#28 behaviour exactly (no
   *  owed days in, no owed days out). */
  daysOwed: number = 0,
): ValidityProjection {
  const classification = classifyLineValidity(expiry, today);
  const { state, lapseDays } = classification;
  const unchanged: ValidityProjection = {
    expiry: expiry ?? null,
    capped: false,
    burned: false,
    state,
    lapseDays,
    daysLostToCap: 0,
    daysOwed,
    soldAhead: 0,
    owedApplied: 0,
  };

  if (daysDelta === 0) return unchanged;

  // Selling days is a consumption record: it subtracts from whatever the line
  // actually holds and is never refused. No grace, no burned check — see the
  // header.
  //
  // #28's sold-ahead banking ONLY engages when the line is currently VALID
  // (real, positive days remaining) and the sale outruns them — the owner's
  // actual scenario ("shop line has 5 months, sell 12"). A line that is
  // ALREADY NO_EXPIRY/GRACE/BURNED before this sale keeps the exact
  // pre-#28 arithmetic (subtract off `expiry ?? today`, no owed banking):
  // those are pre-existing, separately-proven invariants (LIRA-157 — "a
  // burned line is NOT refused, consumption is a record" pushes it FURTHER
  // negative, truthfully) that #28 does not touch. This keeps the two rules
  // from fighting over what an already-degraded line's next sale means.
  if (daysDelta < 0) {
    const magnitude = -daysDelta;

    if (state === "VALID") {
      const available = classification.daysRemaining;
      if (magnitude <= available) {
        const base = expiry as string;
        return { ...unchanged, expiry: addDaysToDateString(base, daysDelta) };
      }

      const soldAhead = magnitude - available;
      return {
        ...unchanged,
        expiry: today,
        state: "VALID",
        lapseDays: 0,
        daysOwed: daysOwed + soldAhead,
        soldAhead,
      };
    }

    // M3 fix (2026-09-24 adversarial review): a GRACE line has 0 REAL days
    // left — treat it exactly like the VALID branch above with `available =
    // 0`, so the whole sale banks into daysOwed and the expiry is left
    // exactly where it is (never subtracted further into the past). See the
    // header comment for the pre-fix bug this replaces.
    if (state === "GRACE") {
      return { ...unchanged, daysOwed: daysOwed + magnitude, soldAhead: magnitude };
    }

    // NO_EXPIRY and BURNED keep the exact pre-#28 arithmetic: a burned line's
    // next sale pushes it further into the past (LIRA-157, a truthful
    // record), and NO_EXPIRY needs an owner decision before #28's banking
    // applies to it — open question, see the #28 fix-round report.
    const base = expiry ?? today;
    return { ...unchanged, expiry: addDaysToDateString(base, daysDelta) };
  }

  // Charging: pay off any sold-ahead balance FIRST, at 1:1 — this portion is
  // never refused (#28: "never burned because of days sold ahead"), because
  // a line carrying daysOwed was pinned VALID/today by the sell branch above
  // the moment the debt was created. Only the REMAINDER after the payoff is
  // subject to the ordinary grace/stacking/ceiling rule below.
  const owedBefore = Math.max(daysOwed, 0);
  const owedApplied = Math.min(daysDelta, owedBefore);
  const remainingDelta = daysDelta - owedApplied;
  const owedAfter = owedBefore - owedApplied;

  if (remainingDelta === 0) {
    // The whole charge paid down the debt; the real expiry is untouched —
    // there is nothing left to stack, and nothing to check for burn.
    return { ...unchanged, daysOwed: owedAfter, owedApplied };
  }

  if (state === "BURNED" && owedBefore === 0) {
    // A genuine burn with NO owed balance in play still refuses the whole
    // charge, unchanged from pre-#28 behaviour.
    return { ...unchanged, expiry: null, burned: true, daysOwed: owedBefore };
  }

  // M4 fix (2026-09-24 adversarial review): a BURNED line that still carries
  // a daysOwed balance is NEVER refused — the owed portion already cleared
  // above, and the owner's rule ("never burned because of days sold ahead")
  // extends to the remainder too: a debt-carrying line can age past the
  // grace window purely by the calendar (nobody recharged it in time), which
  // does not mean the debt itself, or reviving the line to deliver it, is
  // refused. It revives from `today`, exactly like GRACE/NO_EXPIRY.
  //
  // VALID stacks onto the line's own expiry; NO_EXPIRY, GRACE, and a
  // daysOwed-carrying BURNED line all start from today (the owner's "if
  // charged 30 days it would start from today").
  const base = state === "VALID" ? (expiry as string) : today;
  const extended = addDaysToDateString(base, remainingDelta);
  const ceiling = addDaysToDateString(today, MAX_LINE_VALIDITY_DAYS);

  if (extended > ceiling) {
    return {
      ...unchanged,
      expiry: ceiling,
      capped: true,
      daysLostToCap: daysBetweenDateStrings(ceiling, extended),
      daysOwed: owedAfter,
      owedApplied,
    };
  }
  return { ...unchanged, expiry: extended, daysOwed: owedAfter, owedApplied };
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
