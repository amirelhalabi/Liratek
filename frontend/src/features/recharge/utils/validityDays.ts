/**
 * Validity-day snapping for the Telecom → Days tab
 * (CARRIER_LINES_VALIDITY_PLAN.md §0.2).
 *
 * Validity is sold by SMS and **one SMS adds exactly 10 days** (owner ruling
 * 2026-08-06, $0.30 per message). There is no way to send a partial block, so
 * "25 days" is really three messages — 30 days, $0.90. Leaving 25 in the field
 * would price and cost a quantity the carrier cannot deliver, and the prorated
 * `(days / 10) × $0.30` figure would disagree with what the shop actually pays.
 *
 * Snapping **up** on blur makes the two models agree on every reachable value:
 * the eight Quick Days buttons (10/20/30/60/90/120/180/360) are already
 * multiples of 10, and free text lands on one.
 */

/** Days added by a single validity SMS. One place, one definition (rule 14). */
export const VALIDITY_DAYS_PER_SMS = 10;

/**
 * Snap a free-text Days entry up to the next whole multiple of
 * {@link VALIDITY_DAYS_PER_SMS}.
 *
 * Returns the input string **unchanged** when there is nothing meaningful to
 * snap — empty/blank, non-numeric, or zero/negative — so a blur handler can
 * assign the result unconditionally without wiping what the operator typed or
 * fighting a half-finished entry. Fractions round up too (0.5 → 10, 10.2 → 20):
 * a partial block still costs a whole SMS.
 *
 * @example
 * snapValidityDaysUp("1")   // "10"
 * snapValidityDaysUp("25")  // "30"
 * snapValidityDaysUp("30")  // "30"
 * snapValidityDaysUp("")    // ""
 */
export function snapValidityDaysUp(raw: string): string {
  const parsed = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) return raw;
  const snapped =
    Math.ceil(parsed / VALIDITY_DAYS_PER_SMS) * VALIDITY_DAYS_PER_SMS;
  return String(snapped);
}
