import {
  convert,
  MoneyError,
  type RateSide,
  type RateTable,
} from "@liratek/ui";

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
 * `ClosingService.getDailyStatsSnapshot()`'s return
 * (`totalProfitUSD`/`totalProfitLBP`) — see "What 'LBP amount' actually is"
 * below for where those two fields now come from (LIRA-219):
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
 * ── What "LBP amount" actually is (LIRA-219 — updated, was loto-only) ─────
 * As of LIRA-219, `totalProfitUSD`/`totalProfitLBP` are
 * `ClosingService.getDailyStatsSnapshot()`'s own fields, and that service
 * no longer computes them itself: it delegates to
 * `ProfitService.getSummary(day, day).totals.gross_profit_usd/_lbp` — the
 * SAME gross-profit figure the Profits page's Overview tab and By Date
 * chart show for the day (`docs/plans/ongoing_plans/
 * LIRA-219_CLOSING_PROFIT_PARITY.md`). "LBP amount" is therefore every
 * module's LBP-denominated gross profit for the day (sales, financial
 * services, recharge, custom services, maintenance, exchange, loto, debt
 * repayments, counterparty discounts, top-ups) — not loto's commission
 * alone, which is why the old "(Loto only)" qualifier is gone from
 * `formatRateStampedProfitBlock`'s labels (`GROSS_PROFIT_LBP_LABEL`). Both
 * figures are gross (before expenses) — see `buildNetProfitLines` below for
 * the separate net figure.
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
 * `ProfitService.getSummary` (what `getDailyStatsSnapshot` now delegates to,
 * per the module doc above) returns currency-BUCKETED SUMs (one number per
 * module per currency), not individual rows, so there is no per-amount
 * stamped rate available at this layer to honour — every row that fed each
 * bucket may have been written at a different historical rate, and that
 * information does not survive the SUM. Converting the two aggregate
 * figures at today's `sell_rate` (this module) is the faithful
 * implementation for THIS view; a true per-row stamped-rate conversion
 * would require pushing conversion inside each of the ~20 queries
 * `getSummary` composes — a much larger `packages/core` change, out of scope
 * here.
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
  /** Native LBP profit (`totalProfitLBP`) — every module's LBP gross profit
   *  for the day (LIRA-219), not loto-only; see module doc above. No
   *  conversion, no rate. */
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
const formatLbp = (n: number): string =>
  `${Math.round(n).toLocaleString()} LBP`;

// LIRA-219 C.6 — exported so the test suite (and closingReportGenerator.ts)
// take the label text from ONE place (rule 24) rather than hand-typing it a
// second time. All four use the Profits page's word "Gross profit" (E-Q5:
// these lines stay gross, never net — see `buildNetProfitLines` for net).
export const GROSS_PROFIT_USD_LABEL = "Gross profit - USD amount";
export const GROSS_PROFIT_LBP_LABEL = "Gross profit - LBP amount";
export const GROSS_PROFIT_TOTAL_USD_LABEL = "Gross profit - Total (USD)";
export const GROSS_PROFIT_TOTAL_LBP_LABEL = "Gross profit - Total (LBP)";

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
    `  ${GROSS_PROFIT_USD_LABEL}: ${formatUsd(lines.usdAmount)}`,
    `  ${GROSS_PROFIT_LBP_LABEL}: ${formatLbp(lines.lbpAmount)}`,
    `  ${GROSS_PROFIT_TOTAL_USD_LABEL} ${rateLabel}: ${formatUsd(lines.totalUsd)}`,
    `  ${GROSS_PROFIT_TOTAL_LBP_LABEL} ${rateLabel}: ${formatLbp(lines.totalLbp)}`,
  ].join("\n");
}

/**
 * LIRA-219 E-Q1 (owner answers table, overrides design section (E)) — the
 * PDF prints `Net profit = gross − expenses` PER CURRENCY, matching the
 * Profits headline card (`Profits.tsx` "Total Net Profit" / "Net Profit
 * (USD)"/"Net Profit (LBP)" cards). No converted/combined net total — that
 * combined figure was explicitly removed from the Profits page itself
 * (PA-4.22 note #3, 2026-09-24), so closing must not reintroduce it. Plain
 * per-currency subtraction; no rate involved.
 */
export interface NetProfitLines {
  /** `totalProfitUSD` − `totalExpensesUSD`. May be negative (a loss day). */
  netUsd: number;
  /** `totalProfitLBP` − `totalExpensesLBP`. May be negative. */
  netLbp: number;
}

export function buildNetProfitLines(
  grossUsd: number,
  grossLbp: number,
  expensesUsd: number,
  expensesLbp: number,
): NetProfitLines {
  const gUsd = Number.isFinite(grossUsd) ? grossUsd : 0;
  const gLbp = Number.isFinite(grossLbp) ? grossLbp : 0;
  const eUsd = Number.isFinite(expensesUsd) ? expensesUsd : 0;
  const eLbp = Number.isFinite(expensesLbp) ? expensesLbp : 0;
  return { netUsd: gUsd - eUsd, netLbp: gLbp - eLbp };
}

export const NET_PROFIT_USD_LABEL = "Net profit - USD amount";
export const NET_PROFIT_LBP_LABEL = "Net profit - LBP amount";

export function formatNetProfitBlock(lines: NetProfitLines): string {
  return [
    `  ${NET_PROFIT_USD_LABEL}: ${formatUsd(lines.netUsd)}`,
    `  ${NET_PROFIT_LBP_LABEL}: ${formatLbp(lines.netLbp)}`,
  ].join("\n");
}

/**
 * LIRA-219 E-Q3 (owner answers table, verbatim) — "Profit as of HH:MM —
 * later repayments/refunds update this day on the Profits page" (a debt
 * repaid tomorrow, a partner covering later, or a refund of an older sale
 * all change that origin day on the Profits page, and never appear in any
 * closing — this line makes the point-in-time nature visible on the
 * document instead of silently implying the figure is final).
 *
 * `now` is an injected clock (DIP), never read from inside this module —
 * the caller (`Checkpoint/index.tsx`) passes the device's own clock at
 * print time, exactly like `sellRate` above is injected rather than read
 * from a hook here. This keeps the module pure/unit-testable.
 */
const pad2 = (n: number): string => n.toString().padStart(2, "0");

export function formatProfitAsOfLine(now: Date): string {
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  return `  Profit as of ${hh}:${mm} — later repayments/refunds update this day on the Profits page`;
}

/**
 * LIRA-219 E-Q6/E-Q7 (owner answers table) — exact strings for the two
 * cases where no profit figure can be printed at all. Exported as constants
 * (rule 24) so `closingReportGenerator.ts` and its tests never hand-type a
 * second copy that can drift from this one.
 */
// E-Q6: the caller failed the admin-or-Profits-unlocked gate. Server-enforced
// on both transports — `canIncludeProfit` (`packages/core/src/constants/
// profitsAccess.ts`) is the shared policy predicate, and each transport
// supplies its own `hasProfitsUnlock` unlock check (IPC:
// `electron-app/session.ts`; REST: `backend/src/middleware/
// profitsUnlock.ts`) — this module only renders the label once
// ClosingService has already set `profitHidden: true` on the snapshot; it
// never decides access itself.
export const PROFIT_HIDDEN_LABEL =
  "Profit: hidden — unlock the Profits page to include it";
// E-Q7: `ProfitService.getSummary` threw. Never a fabricated "$0.00" on a
// money report — print "unavailable" instead.
export const PROFIT_UNAVAILABLE_LABEL = "Gross profit: unavailable";
