/**
 * The ONE exchange-rate getter for server-side money paths (LIRA-306, R11,
 * FR-021a). **Server-only** (reads tenant context; rule 29) — the pure,
 * browser-reachable `utils/lotMarketRate.ts` is deliberately untouched.
 *
 * Inside an offline replay the event's recorded rates win (O-new-24);
 * otherwise the shop's configured row. `RateRepository.findByCode()` already
 * applies the same rule, so callers that go through the repository are
 * covered too.
 */
import {
  getContextEffectiveRates,
  type EffectiveRate,
} from "../db/tenantContext.js";
import { getRateRepository } from "../repositories/RateRepository.js";

/** The recorded rate for a currency inside a replay, else undefined. */
export function contextRateFor(toCode: string): EffectiveRate | undefined {
  const code = toCode.toUpperCase();
  return getContextEffectiveRates()?.find((r) => r.to_code.toUpperCase() === code);
}

/** Recorded rate (replay) or the configured one; null when neither exists. */
export function getEffectiveRate(toCode = "LBP"): EffectiveRate | null {
  const ctx = contextRateFor(toCode);
  if (ctx) return ctx;
  const row = getRateRepository().findByCode(toCode);
  return row
    ? {
        to_code: row.to_code,
        market_rate: row.market_rate,
        buy_rate: row.buy_rate,
        sell_rate: row.sell_rate,
        is_stronger: row.is_stronger === -1 ? -1 : 1,
      }
    : null;
}
