/**
 * LBP change rounding (owner decision 2026-10-16) — the ONE definition of
 * "the payment box rounded the LBP change UP to the next note", shared by the
 * payment box (`@liratek/ui` `roundLBPUp` delegates here) and the server,
 * which books the extra as a small expense so the books match the cash.
 *
 * Pure: no DB, no Node built-ins (reachable from `browser.ts`, rule 29).
 *
 * Example (walk-in sale, owner's shop day): $26 paid 2,400,000 LBP at
 * 89,000. Exact change = 2,400,000 − 26 × 89,000 = 86,000 LBP; the box hands
 * 90,000 (the next 5,000 note). The extra 4,000 LBP is the rounding.
 */

/** The smallest LBP note the shop hands out. */
export const LBP_SMALLEST_NOTE = 5000;

/**
 * Float noise subtracted before `Math.ceil` so an amount that is
 * mathematically a whole number of notes (e.g. `10000.000000000002` after a
 * `float × rate` chain) rounds to itself, never to the next note.
 */
const ROUND_UP_EPSILON = 1e-6;

/** Round an LBP amount UP to a whole number of the smallest note
 *  (57,380 → 60,000). 0 for anything not positive. */
export function roundLbpUpToNote(amount: number): number {
  if (!(amount > 0)) return 0;
  return (
    Math.ceil(amount / LBP_SMALLEST_NOTE - ROUND_UP_EPSILON) * LBP_SMALLEST_NOTE
  );
}

export interface ChangeRoundingLeg {
  method: string;
  currencyCode: string;
  amount: number;
}

export interface LbpChangeRoundingInput {
  /** What the customer owes, per currency (a USD-priced sale: `{usd, lbp: 0}`). */
  due: { usd: number; lbp: number };
  /** Everything the customer handed over (IN legs, any method). */
  inLegs: ChangeRoundingLeg[];
  /** Cash change handed back, per currency (cash change fields + cash OUT legs). */
  cashChange: { usd: number; lbp: number };
  /** The till's rate (LBP per USD) the checkout converted at. */
  exchangeRate: number;
}

/**
 * The LBP the shop handed back ON TOP of the exact change because the LBP
 * change was rounded up to a whole note. Returns 0 unless ALL of these hold:
 *
 *   - LBP cash change was handed back, and every leg is USD or LBP;
 *   - the shop received less than it is owed by more than 1 LBP (the
 *     customer got that difference back as change);
 *   - that difference is under one smallest note; and
 *   - the exact LBP change (handed − difference) rounds UP to exactly what
 *     was handed — i.e. the gap is the note rounding and nothing else.
 *
 * Anything else (an exact change, a real over-return of a whole note or
 * more, an under-payment with no change) is not rounding and returns 0.
 * Whole lira (rounded).
 */
export function lbpChangeRounding(input: LbpChangeRoundingInput): number {
  const rate = input.exchangeRate;
  const handedLbp = Math.abs(input.cashChange.lbp || 0);
  if (!(rate > 0) || !(handedLbp > 0)) return 0;
  const legs = input.inLegs;
  if (legs.some((l) => l.currencyCode !== "USD" && l.currencyCode !== "LBP")) {
    return 0;
  }
  const toLbp = (usd: number, lbp: number) => usd * rate + lbp;
  const inLbp = legs.reduce(
    (sum, l) =>
      sum +
      (l.currencyCode === "USD"
        ? Math.abs(l.amount) * rate
        : Math.abs(l.amount)),
    0,
  );
  const outLbp = toLbp(Math.abs(input.cashChange.usd || 0), handedLbp);
  const dueLbp = toLbp(input.due.usd || 0, input.due.lbp || 0);
  const shortLbp = dueLbp - (inLbp - outLbp);
  const rounding = Math.round(shortLbp);
  if (rounding < 1 || rounding >= LBP_SMALLEST_NOTE) return 0;
  const exactChangeLbp = handedLbp - shortLbp;
  if (roundLbpUpToNote(exactChangeLbp) !== handedLbp) return 0;
  return rounding;
}
