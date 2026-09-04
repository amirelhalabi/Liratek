import { convert, MoneyError, type RateSide, type RateTable } from "@liratek/ui";

/**
 * LIRA-174 — the Checkpoint/closing PDF's rate-stamped USD+LBP profit view
 * (current_sprint.md LIRA-174; owner spec recorded 2026-09-04).
 *
 * Single-view layout (owner's words, verbatim): "showcase usd amount, lbp
 * amount, total amount in usd with the rate used — this way it's clear".
 * The three-mode toggle spec that preceded this was explicitly superseded
 * same-day — do not resurrect it.
 *
 * Produces four lines from the two profit figures already on
 * `ClosingRepository.getDailyStatsSnapshot()`'s return
 * (`totalProfitUSD`/`totalProfitLBP`):
 *
 *   USD amount        <- native, no conversion, no rate
 *   LBP amount        <- native, no conversion, no rate
 *   Total (USD)       <- USD amount + (LBP amount converted @ rate)
 *   Total (LBP)       <- LBP amount + (USD amount converted @ rate)  [inference, see below]
 *
 * The first three lines are the owner's explicit instruction. The fourth
 * (Total (LBP)) is the filer's inference, not the owner's literal words —
 * it completes their original request for a usable LBP-facing total
 * symmetrically with the USD-facing one, and costs nothing once the rate is
 * already being stamped. Flagged here so it is a one-line removal (delete
 * `totalLbp` from the returned object and its rendering in
 * `formatRateStampedProfitBlock`) if the owner would rather keep the
 * document USD-total-only.
 *
 * ── What "LBP amount" actually is (verify before trusting the label) ──────
 * `totalProfitLBP` (ClosingRepository.ts:1360) is `lotoProfit.profit_lbp` —
 * LOTO'S commission ONLY. Loto books its commission entirely in LBP, so it
 * cannot reach `totalProfitUSD` at all (that total would just add exactly
 * $0 for it), which is why LIRA-161 gave it its own field. But the
 * repository's own doc comment (ClosingRepository.ts:104-120) is explicit
 * that every OTHER module folded into `totalProfitUSD` (sales, financial
 * services, recharge, custom services, maintenance, exchange) ALREADY
 * EXCLUDES its own LBP-denominated slice at the SQL layer — there is no
 * established currency-conversion convention in that method to fold LBP
 * profit into the USD total, so if any of those modules ever produces a
 * genuine LBP profit slice, it is dropped from BOTH totals today, not
 * merely deferred. "LBP amount" on this document is therefore loto's
 * number, not "all LBP-denominated profit" — `formatRateStampedProfitBlock`
 * labels the line "(Loto only)" rather than presenting it as complete
 * coverage. Building a proper cross-module LBP aggregate is a
 * `packages/core` change (ClosingRepository), out of this ticket's
 * frontend-only scope.
 *
 * ── Why sell_rate here, when the app-wide LBP→USD convention is buy ───────
 * Owner decision (2026-09-04): convert at `sell_rate`, not the buy-rate
 * convention used everywhere else in the app (2026-07-06 decision, cited at
 * `frontend/src/features/debts/pages/Debts/index.tsx` ~:2068-2070 and
 * `frontend/src/features/sessions/components/SessionCheckoutModal.tsx`
 * ~:979-981; also LIRA-139's `amountSort.ts` fallback). That means this
 * document's converted total will NOT tie out exactly against those other
 * buy-rate surfaces for the same underlying LBP figure. Deliberate, not an
 * oversight: sell is what the shop would actually pay to turn LBP into
 * dollars — the conservative reading for a profit reconciliation figure —
 * and printing the rate on the page (see `formatRateStampedProfitBlock`)
 * makes the divergence visible instead of silently hidden. Do not "correct"
 * this to buy, and do not file the buy/sell mismatch against the other
 * surfaces as a bug — it is this ticket's own choice.
 *
 * ── Why the rate is a plain injected number, not read from useSellRate() here ──
 * This module is pure (no React, no `useApi`) so it is unit-testable without
 * a provider tree — the caller (`Checkpoint/index.tsx`) reads
 * `useSellRate().sellRate` and passes it in, exactly like `amountSort.ts`
 * takes its `fallbackUsdToLbpRate` as a parameter rather than reaching for
 * the hook itself.
 *
 * ── Why sell_rate substitutes here at all (the "stamped rate" clause) ─────
 * The owner's original spec said an amount with no rate already stamped on
 * it should fall back to "the rate from system configuration". Verified:
 * `getDailyStatsSnapshot` returns currency-BUCKETED SUMs (one number per
 * module per currency), not individual rows, so there is no per-amount
 * stamped rate available at this layer to honour — every row that fed each
 * bucket may have been written at a different historical rate, and that
 * information does not survive the SUM. Converting the two aggregate
 * figures at today's `sell_rate` (this module) is the faithful
 * implementation for THIS view; a true per-row stamped-rate conversion
 * would require pushing conversion inside each of the ~7 module
 * sub-queries `getDailyStatsSnapshot` composes — a much larger
 * `packages/core` change, out of scope here.
 */

const LBP_CODE = "LBP";
const BASE_CURRENCY = "USD";

/** Both sides of the built RateTable are set to the same `sellRate` value
 *  (see `buildRateStampedProfitLines`), so which side `convert`/`crossRate`
 *  reads is immaterial — mirrors the same documented choice in
 *  `frontend/src/features/audit/amountSort.ts`. */
const RATE_SIDE: RateSide = "sell";

export interface RateStampedProfitLines {
  /** Native USD profit (`totalProfitUSD`) — no conversion, no rate. */
  usdAmount: number;
  /** Native LBP profit (`totalProfitLBP`) — LOTO ONLY, see module doc above.
   *  No conversion, no rate. */
  lbpAmount: number;
  /** `usdAmount` + (`lbpAmount` converted to USD @ `rate`). Carries `rate`. */
  totalUsd: number;
  /** `lbpAmount` + (`usdAmount` converted to LBP @ `rate`). Carries `rate`.
   *  The filer's inference — see module doc above. */
  totalLbp: number;
  /** The sell_rate used for both conversions above. Meaningless (equals the
   *  input verbatim) when `rateAvailable` is false. */
  rate: number;
  /** False when `rate` was missing/0/negative/NaN. The two `total*` fields
   *  then fall back to their native `*Amount` value (no fabricated
   *  conversion at an unusable rate) — the PDF still renders, it just
   *  cannot show a converted total. Never let a `MoneyError` escape this
   *  function and blank the page (owner instruction). */
  rateAvailable: boolean;
}

/** `rate` only when finite and positive — `convert`/`crossRate` throw
 *  `MoneyError` on anything else (`packages/ui/src/money/convert.ts:5-14`),
 *  so every rate reaching them here is pre-validated. */
function usableRate(rate: number): number | null {
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Builds the four rate-stamped profit lines for the Checkpoint PDF. See the
 *  module doc above for what each figure means and why `sellRate` is used. */
export function buildRateStampedProfitLines(
  totalProfitUSD: number,
  totalProfitLBP: number,
  sellRate: number,
): RateStampedProfitLines {
  const usd = Number.isFinite(totalProfitUSD) ? totalProfitUSD : 0;
  const lbp = Number.isFinite(totalProfitLBP) ? totalProfitLBP : 0;
  const rate = usableRate(sellRate);

  if (rate === null) {
    return {
      usdAmount: usd,
      lbpAmount: lbp,
      totalUsd: usd,
      totalLbp: lbp,
      rate: sellRate,
      rateAvailable: false,
    };
  }

  const rates: RateTable = {
    base: BASE_CURRENCY,
    rates: { [LBP_CODE]: { buy: rate, sell: rate } },
  };

  try {
    const lbpAsUsd = convert(
      { amount: lbp, currency: LBP_CODE },
      BASE_CURRENCY,
      rates,
      RATE_SIDE,
    ).amount;
    const usdAsLbp = convert(
      { amount: usd, currency: BASE_CURRENCY },
      LBP_CODE,
      rates,
      RATE_SIDE,
    ).amount;

    return {
      usdAmount: usd,
      lbpAmount: lbp,
      totalUsd: usd + lbpAsUsd,
      totalLbp: lbp + usdAsLbp,
      rate,
      rateAvailable: true,
    };
  } catch (err) {
    // Defense in depth: `usableRate` above should make this unreachable, but
    // a throw while building the PDF HTML must never blank the page.
    if (!(err instanceof MoneyError)) throw err;
    return {
      usdAmount: usd,
      lbpAmount: lbp,
      totalUsd: usd,
      totalLbp: lbp,
      rate: sellRate,
      rateAvailable: false,
    };
  }
}

const formatUsd = (n: number): string => `$${n.toFixed(2)}`;
const formatLbp = (n: number): string => `${Math.round(n).toLocaleString()} LBP`;

/** Renders `RateStampedProfitLines` as plain text lines for the closing
 *  report (embedded verbatim in the PDF's `<pre>` block by
 *  `Checkpoint/index.tsx`). The rate is printed on every converted line —
 *  "this way it's clear" (owner's words) — and never on a native line. */
export function formatRateStampedProfitBlock(
  lines: RateStampedProfitLines,
): string {
  const rateLabel = lines.rateAvailable
    ? `@ ${lines.rate.toLocaleString()} (sell rate)`
    : "(rate unavailable)";

  return [
    `  Profit - USD amount: ${formatUsd(lines.usdAmount)}`,
    `  Profit - LBP amount (Loto only): ${formatLbp(lines.lbpAmount)}`,
    `  Profit - Total (USD) ${rateLabel}: ${formatUsd(lines.totalUsd)}`,
    `  Profit - Total (LBP) ${rateLabel}: ${formatLbp(lines.totalLbp)}`,
  ].join("\n");
}
