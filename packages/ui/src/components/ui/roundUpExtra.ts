import { isWithinShortfallMax } from "@liratek/core";

/**
 * The payment box's leg-matching tolerance in `currency` (the total's
 * currency): 100 LBP, else 0.01. Below it a difference between paid and
 * owed is treated as an exact match — no change box, no shortfall. The ONE
 * definition MultiPaymentInput and the round-up helper below share, so an
 * overpay too small to open the change box is also too small to autofill.
 */
export function matchToleranceFor(currency: string): number {
  return currency === "LBP" ? 100 : 0.01;
}

/**
 * LIRA-334 (research R7) — customer-pays round-up: the extra to fill in when
 * the customer paid a little more than owed and the shop keeps it as an
 * extra charge (owner example: $103 handed over on $102.90 → 0.10).
 *
 * `paidInTarget` and `baseTotalInTarget` are both in `currency` (the total's
 * currency); `baseTotalInTarget` is the total BEFORE any extra, so a filled
 * extra never feeds back into its own measurement.
 *
 * Returns 0 when the overpay is at or below the match tolerance
 * (`matchToleranceFor`), above the shared shortfall cap
 * (`isWithinShortfallMax` — $5 / 450,000 LBP, the same predicate the server
 * enforces; 0 for a currency without a cap), or above `cap` (the page's own
 * extra cap) when given. Otherwise the overpay rounded to the currency's
 * precision (LBP whole pounds, else cents).
 *
 * Used by MultiPaymentInput's built-in Extra line and by the POS /
 * Maintenance checkout (rule 14 — one rule, two screens).
 */
export function suggestRoundUpExtra({
  paidInTarget,
  baseTotalInTarget,
  currency,
  cap,
}: {
  paidInTarget: number;
  baseTotalInTarget: number;
  currency: string;
  cap?: number | undefined;
}): number {
  const overpay = paidInTarget - baseTotalInTarget;
  if (!Number.isFinite(overpay)) return 0;
  if (overpay <= matchToleranceFor(currency)) return 0;
  if (!isWithinShortfallMax(overpay, currency)) return 0;
  const rounded =
    currency === "LBP" ? Math.round(overpay) : Number(overpay.toFixed(2));
  if (cap !== undefined && rounded > cap + 1e-9) return 0;
  return rounded;
}
