/**
 * Which of a drawer's currencies to show on a balance display (owner
 * decision 2026-10-10, LIRA-289). One rule for the web Dashboard and the
 * phone app (rule 14):
 *
 *   - USD and LBP, the shop's two main currencies, are always shown when the
 *     drawer holds them, even at zero;
 *   - any other currency is shown only when it is not zero;
 *   - a drawer that would be left showing nothing (e.g. Binance at 0 USDT)
 *     shows all of its currencies instead.
 *
 * Returns a subset of `byCurrency`; ordering stays with the caller.
 * Zero imports, so it is safe in both core entry points (rule 29).
 */
export const MAIN_DRAWER_CURRENCIES: readonly string[] = ["USD", "LBP"];

export function visibleDrawerCurrencies(
  byCurrency: Record<string, number>,
): Record<string, number> {
  const visible = Object.fromEntries(
    Object.entries(byCurrency).filter(
      ([code, amount]) =>
        MAIN_DRAWER_CURRENCIES.includes(code) || amount !== 0,
    ),
  );
  return Object.keys(visible).length > 0 ? visible : byCurrency;
}
