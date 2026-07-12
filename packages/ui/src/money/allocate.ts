import { convert, crossRate } from "./convert";
import {
  type CurrencyRegistry,
  currencyInfo,
  DEFAULT_CURRENCIES,
  roundForCurrency,
} from "./registry";
import {
  type AllocationResult,
  type CrossApplication,
  type Money,
  MoneyError,
  type RateSide,
  type RateTable,
} from "./types";

export interface AllocationInput {
  /** What is owed, per currency (native amounts). */
  totals: Money[];
  /** What is being handed over — IN legs only (rule 16: OUT/return legs are
   *  the repositories' shared loop's business, never allocation input). */
  payments: Money[];
  rates: RateTable;
  /** Quote side for every conversion this allocation performs. */
  side: RateSide;
  registry?: CurrencyRegistry;
}

export interface AllocationOptions {
  /** Round `remaining`/`change` to each currency's precision (default true).
   *  Pass false when the caller needs raw amounts for its own display
   *  pipeline (sub-epsilon dust is still dropped either way). */
  round?: boolean;
}

/** Sum amounts per currency; reject negative/non-finite inputs early. */
function consolidate(items: Money[], label: string): Map<string, number> {
  const byCurrency = new Map<string, number>();
  for (const m of items) {
    if (!Number.isFinite(m.amount) || m.amount < 0) {
      throw new MoneyError(
        `allocatePayments: ${label} has a bad amount (${m.amount}) for ${m.currency}`,
      );
    }
    byCurrency.set(m.currency, (byCurrency.get(m.currency) ?? 0) + m.amount);
  }
  return byCurrency;
}

/**
 * Match payments against per-currency totals.
 *
 * 1. Native pass — each payment nets against the total in its OWN currency;
 *    no rate is consulted (invariant I1: same-currency remaining is
 *    rate-independent).
 * 2. Spillover (decision D1) — excess tender settles the other currencies'
 *    remaining debt, largest remaining (valued in base) first; the ONLY place
 *    rates enter. Sources are processed largest excess first; both orders
 *    tie-break on currency code for determinism (I5).
 * 3. What's left of the excess is change, kept in the tender currency (D1).
 *
 * `remaining`/`change` are epsilon-cleaned and rounded per currency;
 * `crossCurrencyApplied` is the raw audit trail (unrounded).
 */
export function allocatePayments(
  input: AllocationInput,
  options: AllocationOptions = {},
): AllocationResult {
  const { totals, payments, rates, side } = input;
  const { round = true } = options;
  const registry = input.registry ?? DEFAULT_CURRENCIES;

  const owed = consolidate(totals, "totals");
  const paid = consolidate(payments, "payments");

  // 1) Native pass.
  const remaining = new Map<string, number>();
  const excess = new Map<string, number>();
  for (const c of new Set([...owed.keys(), ...paid.keys()])) {
    const net = (owed.get(c) ?? 0) - (paid.get(c) ?? 0);
    if (net > 0) remaining.set(c, net);
    else if (net < 0) excess.set(c, -net);
  }

  // Deterministic ordering: descending value in base, then currency code.
  const byBaseValueDesc = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([currency, amount]) => ({
        currency,
        base: convert({ amount, currency }, rates.base, rates, side).amount,
      }))
      .sort((a, b) => b.base - a.base || a.currency.localeCompare(b.currency))
      .map((e) => e.currency);

  // 2) Spillover.
  const crossCurrencyApplied: CrossApplication[] = [];
  for (const src of byBaseValueDesc(excess)) {
    let excessLeft = excess.get(src) ?? 0;
    for (const tgt of byBaseValueDesc(remaining)) {
      if (excessLeft <= 0) break;
      if (tgt === src) continue; // native pass already netted this pair
      const owedLeft = remaining.get(tgt) ?? 0;
      if (owedLeft <= 0) continue;
      const rate = crossRate(src, tgt, rates, side);
      const appliedToTarget = Math.min(owedLeft, excessLeft * rate);
      if (appliedToTarget <= 0) continue;
      const consumedFromSource = appliedToTarget / rate;
      remaining.set(tgt, owedLeft - appliedToTarget);
      excessLeft -= consumedFromSource;
      crossCurrencyApplied.push({
        from: { amount: consumedFromSource, currency: src },
        to: { amount: appliedToTarget, currency: tgt },
        rateUsed: rate,
      });
    }
    excess.set(src, excessLeft);
  }

  // 3) Epsilon-clean (drop sub-tolerance dust BEFORE rounding, so float noise
  // from a conversion round-trip can't surface as a phantom remainder), then
  // round to each currency's precision.
  const finalize = (m: Map<string, number>): Money[] =>
    [...m.entries()]
      .filter(
        ([currency, amount]) =>
          Math.abs(amount) >= currencyInfo(currency, registry).epsilon,
      )
      .map(([currency, amount]) =>
        round
          ? roundForCurrency({ amount, currency }, registry)
          : { amount, currency },
      )
      .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    remaining: finalize(remaining),
    crossCurrencyApplied,
    change: finalize(excess),
  };
}
