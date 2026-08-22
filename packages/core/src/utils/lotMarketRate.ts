/**
 * Market-rate normalization for the exchange lot engine
 * (EXCHANGE_LOT_SETTLEMENT.md Phase 4a — `ExchangeLotService`).
 *
 * Deliberately its OWN file rather than an addition to the pre-existing
 * `utils/exchangeRate.ts` (which holds the unrelated `getUsdLbpSellRate`/
 * `FALLBACK_USD_LBP_RATE` helper consumed by `DebtRepository`,
 * `ExchangeRepository`, `FinancialServiceRepository`, and
 * `RechargeRepository` — one of those, `ExchangeRepository.ts`, is under
 * concurrent edit by the Phase 3 agent building this same feature's write
 * path). Landing a second export in that file risked a merge collision on
 * an actively-edited file for no benefit — a new file is exactly as easy to
 * import and dedup later.
 *
 * `exchange_rates.market_rate` is stored in whatever orientation the
 * currency's `is_stronger` flag implies (see this repo's
 * `utils/currencyConverter.ts` file header):
 *   - `is_stronger = +1` (USD stronger, e.g. LBP): `market_rate` is
 *     UNITS-PER-USD (e.g. 90000 LBP per 1 USD) — USD-per-unit is its
 *     reciprocal.
 *   - `is_stronger = -1` (currency stronger, e.g. EUR): `market_rate` is
 *     already USD-PER-UNIT (e.g. 1.18 USD per 1 EUR).
 *
 * This is the unit-amount special case of `convertToUSD(1, rate, action)` in
 * `currencyConverter.ts` (`amountUSD = is_stronger === 1 ? amount / rate :
 * amount * rate`) — but reads `market_rate` directly (the unbiased mid-market
 * price), never `buy_rate`/`sell_rate`. The lot engine's cost-basis math must
 * never use the shop's own buy/sell spread — that spread is exactly the
 * profit model this feature replaces for lot-tracked currencies (Q8).
 *
 * NOTE for the orchestrator (Phase 3 / Phase 4a concurrent-edit dedup): this
 * is the ONE canonical copy of this normalization as of Phase 4a. The
 * concurrent Phase 3 agent (`ExchangeRepository`/`ExchangeService` — the
 * Q6 MARKET-basis oversell slice) needs the exact same conversion and may
 * have landed its own inline copy inside `ExchangeRepository` instead of
 * importing this one. If so, unify on whichever copy survives review
 * (rule 14: one named fragment, not two) — do not ship both.
 */
export function marketRateToUsdPerUnit(
  marketRate: number,
  isStronger: 1 | -1,
): number {
  return isStronger === 1 ? 1 / marketRate : marketRate;
}

/**
 * Whether a CROSS pair (both sides non-USD) has a USD anchor to route its
 * internal "from -> USD -> to" passthrough through — mirrors
 * `ExchangeRepository._crossUsdNotional`'s availability logic EXACTLY
 * (rule 14: one predicate, reused by both the write path's decision to skip
 * lot tracking and the preview's decision to not show a realized figure for
 * a number the server would then discard):
 *
 *   1. Either side is LBP -> anchors (LBP carries a seeded `exchange_rates`
 *      row since v59 — the one currency this can always trust).
 *   2. Neither side is LBP -> anchors iff EITHER side has its own
 *      `exchange_rates` row (an operator-configured buy/sell spread).
 *
 * `hasRateRow` is injected (rather than this function reading the DB itself)
 * so both call sites — `ExchangeRepository` (already has a
 * `getRateRepository().findByCode` result) and `ExchangeLotService`
 * (preview, no write-path context) — can supply their own lookup without a
 * second DB dependency living in this pure-math file.
 *
 * Deliberately does NOT decide whether a pair actually IS a cross (that's
 * "both sides non-USD", decided by the caller) — this only answers "if it
 * IS a cross, does it have an anchor".
 */
export function crossPairHasUsdAnchor(
  fromCurrency: string,
  toCurrency: string,
  hasRateRow: (currencyCode: string) => boolean,
): boolean {
  if (fromCurrency === "LBP" || toCurrency === "LBP") return true;
  return hasRateRow(fromCurrency) || hasRateRow(toCurrency);
}
