/**
 * Tender exchange-rate sanity band — LIRA-240.
 *
 * Pure constant + pure arithmetic, zero imports, so it is safe to reach from
 * BOTH `@liratek/core` entry points (`index.ts` for the Electron main
 * process/backend, `browser.ts` for Vite and the frontend jest config — rule
 * 29). This is now the ONE definition of the band (rule 14): server-side
 * stamping (`repositories/moneyPosting.ts`) and the payment-form warning
 * banner (`@liratek/ui`'s `MultiPaymentInput`) both read this SAME
 * constant/formula instead of maintaining their own copy that could drift.
 *
 * History: this constant used to ALSO gate a hard refusal — a payment whose
 * typed rate fell outside the band was refused outright inside
 * `reconcileLegs`/`resolveReconciliationRate` (moneyPosting.ts), and
 * `resolveStampedExchangeRate` silently substituted the server rate for the
 * stamped `transactions.exchange_rate` column. Both were retired by owner
 * decision 2026-09-28 (LIRA-240): a live report showed a 300,000 LBP
 * recharge PAID WITH 300,000 LBP cash refused at "+16%" even though the
 * legs were same-currency and the rate played no part in the math at all.
 * The band no longer blocks anything or silently overrides what the
 * operator typed — it now feeds ONLY a non-blocking UI warning.
 *
 * RESOLVED (was: known open issue, pre-existing, unrelated to LIRA-240):
 * the server-side "reference rate" this UI warning and the stamping
 * fallback compare against comes from `getUsdLbpSellRate()`
 * (`utils/exchangeRate.ts`). It used to read `exchange_rates` with NO
 * `tenant_id` filter even though that table is tenant-scoped, which could
 * hand back an arbitrary tenant's rate on the multi-tenant web server
 * (invisible on desktop, which has exactly one tenant/row). Fixed in
 * `9ed8d90f` — `getUsdLbpSellRate()` now filters by the current tenant; see
 * the guard `utils/__tests__/exchangeRate.tenantScoping.test.ts`.
 */
export const TENDER_RATE_BAND_PCT = 0.15;

/**
 * Absolute deviation of `tenderRate` from `referenceRate`, as a fraction
 * (0.16 means 16% away). Returns 0 — "no warning" — when either value is
 * not a positive finite number: nothing sane to compare (an empty/unedited
 * rate field, a not-yet-loaded reference rate, or a scripted 0).
 */
export function tenderRateDeviationPct(
  tenderRate: number | null | undefined,
  referenceRate: number | null | undefined,
): number {
  if (
    tenderRate == null ||
    referenceRate == null ||
    !Number.isFinite(tenderRate) ||
    !Number.isFinite(referenceRate) ||
    !(tenderRate > 0) ||
    !(referenceRate > 0)
  ) {
    return 0;
  }
  return Math.abs(tenderRate - referenceRate) / referenceRate;
}
