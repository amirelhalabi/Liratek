/**
 * Refund-leg amount tolerance — ONE definition (rule 14) shared by the
 * server-side check (`TransactionRepository.validateRefundLegOverrideAmounts`)
 * and the frontend's client-side hint (`refundLegOverride.ts`, which serves
 * the audit Transactions page, RefundMethodModal, the LIRA-143 session-item
 * refund flow, and the LIRA-231 POS refund forms).
 *
 * Same-currency amount-matching tolerance — no exchange-rate conversion is
 * ever involved here, just a per-currency equality check. LBP amounts are
 * always whole numbers in this codebase, so `LBP: 1` catches genuine drift
 * while still passing an untouched default.
 *
 * LIRA-232 round-2 review (finding 5) once widened the FRONTEND copy alone to
 * `LBP: 100` to tolerate a session-item refund's `defaultLegs` (core used to
 * round `itemAmountLbp`/`accountReductionLbp` independently, so an untouched
 * default could land a few LBP off a naive subtraction). That fix drifted the
 * two copies (rule 14's exact failure mode): the form accepted a gap the
 * server then rejected. Core now rounds every LBP remainder and default leg
 * to whole LBP (`SESSION_ITEM_REFUND_PLAN.md` §3), so `LBP: 1` is sufficient
 * again on BOTH sides — there is no longer a reason for the tolerances to
 * differ, so there is only one map.
 *
 * Zero imports of Node or repositories (rule 29) — this module is reachable
 * from `browser.ts` and must stay a pure leaf.
 */
export const REFUND_LEG_AMOUNT_EPSILON: Record<string, number> = {
  USD: 0.01,
  LBP: 1,
};

/** Tolerance for `currencyCode`, falling back to the USD tolerance for any
 *  currency not in the map (matches both call sites' prior fallback). */
export function refundAmountTolerance(currencyCode: string): number {
  return (
    REFUND_LEG_AMOUNT_EPSILON[currencyCode] ?? REFUND_LEG_AMOUNT_EPSILON.USD
  );
}

/**
 * LIRA-236 — value-based refund-leg tolerance, used ONLY when a refund is
 * validated by TOTAL VALUE at a cashier-typed exchange rate
 * (`validateRefundLegOverrideAmounts`'s `exchangeRate` branch) instead of
 * the per-currency exact match above. Comparing
 * `Σ legs (USD + LBP/rate)` against `Σ refund value (USD + LBP/rate)` as ONE
 * USD-equivalent number can carry rounding from BOTH sides of an LBP/rate
 * division (the refund's own LBP-denominated amount AND the operator's
 * chosen LBP leg), where the per-currency check above only ever rounds one
 * side against a whole-LBP boundary — so this is deliberately double
 * `REFUND_LEG_AMOUNT_EPSILON.USD` rather than reusing it directly (rule 14:
 * still ONE constant, derived from the other, never a second hand-picked
 * number).
 */
export const REFUND_VALUE_TOLERANCE_USD = REFUND_LEG_AMOUNT_EPSILON.USD * 2;
