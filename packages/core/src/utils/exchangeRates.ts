/**
 * LIRA-302 — read the shop's USD/LBP buy and sell rates from the rates list
 * (`GET /api/rates`, IPC `rates:list`). One reader for the web and the phone
 * (rule 14). Pure and dependency-free (rule 29).
 *
 * Returns `null` when the list has no USD/LBP rate at all. The web keeps its
 * own 89,000 fallback on top (`frontend/src/utils/exchangeRates.ts`); the
 * phone does not guess a rate on a money screen and turns USD off instead.
 */

export interface UsdLbpRates {
  /** We buy USD from the customer (lower; the tender rate for a USD payment). */
  buyRate: number;
  /** We sell USD to the customer (higher). */
  sellRate: number;
}

interface RateRow {
  to_code?: string;
  from_code?: string;
  market_rate?: number;
  buy_rate?: number | null;
  sell_rate?: number | null;
  rate?: number;
}

/**
 * With `fallbackRate` (the web): identical to the web's former
 * `getExchangeRates` — a missing legacy rate falls back to `fallbackRate`
 * (buy) and `fallbackRate + 500` (sell). Without it (the phone): `null` when
 * there is no usable buy rate.
 */
export function readUsdLbpRates(rates: readonly unknown[], fallbackRate: number): UsdLbpRates;
export function readUsdLbpRates(rates: readonly unknown[]): UsdLbpRates | null;
export function readUsdLbpRates(rates: readonly unknown[], fallbackRate?: number): UsdLbpRates | null {
  const rows = rates.filter((r): r is RateRow => r !== null && typeof r === "object");

  // Current schema (v59+): { to_code, market_rate, buy_rate, sell_rate, is_stronger }.
  const lbpRow = rows.find((r) => r.to_code === "LBP" && r.market_rate !== undefined);
  if (lbpRow) {
    const market = lbpRow.market_rate as number;
    return { buyRate: lbpRow.buy_rate ?? market, sellRate: lbpRow.sell_rate ?? market };
  }

  // Legacy from/to schema: { from_code, to_code, rate }.
  const buy = rows.find((r) => r.from_code === "LBP" && r.to_code === "USD")?.rate;
  const sell = rows.find((r) => r.from_code === "USD" && r.to_code === "LBP")?.rate;
  if (fallbackRate !== undefined) {
    return { buyRate: buy || fallbackRate, sellRate: sell || fallbackRate + 500 };
  }
  if (!buy) return null;
  return { buyRate: buy, sellRate: sell || buy };
}
