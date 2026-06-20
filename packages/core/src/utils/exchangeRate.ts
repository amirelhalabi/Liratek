import type Database from "better-sqlite3";

/** Fallback USD→LBP rate when no row/table is available (e.g. test harnesses). */
export const FALLBACK_USD_LBP_RATE = 89500;

/**
 * Current USD→LBP **sell** rate (the rate a customer pays — Money IN) read from
 * the `exchange_rates` table. Used to stamp `transactions.exchange_rate` at
 * creation time so the rate-of-record is captured alongside the payment legs.
 *
 * Defensive by design: if the table or row is missing (unit-test in-memory DBs,
 * fresh installs), it returns {@link FALLBACK_USD_LBP_RATE} instead of throwing.
 */
export function getUsdLbpSellRate(
  db: Database.Database,
  toCode = "LBP",
): number {
  try {
    const row = db
      .prepare(
        `SELECT sell_rate, market_rate FROM exchange_rates WHERE to_code = ? LIMIT 1`,
      )
      .get(toCode) as
      | { sell_rate?: number; market_rate?: number }
      | undefined;
    return row?.sell_rate ?? row?.market_rate ?? FALLBACK_USD_LBP_RATE;
  } catch {
    return FALLBACK_USD_LBP_RATE;
  }
}
