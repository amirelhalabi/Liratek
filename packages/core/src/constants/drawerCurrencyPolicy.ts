/**
 * Drawer currency policy — which drawers are currency-**restricted**, and
 * which accept anything.
 *
 * `currency_drawers` is a **provider** constraint: the Binance drawer
 * genuinely only ever holds USDT, MTC/Alfa only hold USD. Those allowlists
 * are real and stay enforced.
 *
 * The **General** drawer is different: it is the shop's own till, and the
 * Exchange module deposits ANY currency into it
 * (`ExchangeRepository` posts its inflow leg to General with a hardcoded
 * drawer name and a caller-supplied `fromCurrency`). Treating General as a
 * closed allowlist made the app contradict itself — an EUR exchange put EUR
 * into General, while a manual EUR cash-in was rejected with "Currency EUR is
 * not enabled for the General drawer".
 *
 * So General's currency set is **derived, never configured**: all active
 * currencies, plus anything it still physically holds. See
 * `docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md`.
 *
 * Single definition (CLAUDE.md rule 14) consumed by:
 *  - `CurrencyRepository.getCurrenciesForDrawer` / `getFullCurrenciesForDrawer`
 *    / `getAllDrawerCurrencies` / `getConfiguredDrawerNames` — the drawer
 *    reads every surface funnels through (top-up picker, Dashboard, Closing,
 *    Opening, Setup, Settings), on BOTH transports,
 *  - `CurrencyService.setCurrenciesForDrawer` — refuses to "configure" a
 *    drawer that has no configurable list.
 *
 * ⚠ Scope note (plan §5, owner decision D1, 2026-08-22): this list is
 * deliberately General-only. `OMT_System`/`Whish_System` are the shop's cash
 * too, but an exotic currency provably cannot reach them — exchange split
 * payouts hard-reject a non-USD/LBP target, `WalletExchangeService` restricts
 * itself to USD/LBP, and `payment_methods` maps `CASH → General`. **If a
 * future change lets a non-USD/LBP currency post to another drawer, that same
 * commit must add the drawer here.**
 */

/** Drawers whose currency set is derived, not configured. */
export const UNRESTRICTED_DRAWERS = ["General"] as const;

export type UnrestrictedDrawerName = (typeof UNRESTRICTED_DRAWERS)[number];

/**
 * True when `drawerName` accepts every currency (so `currency_drawers` must
 * not be read as an allowlist for it, and must not be written for it either).
 */
export function isUnrestrictedDrawer(drawerName: string): boolean {
  return (UNRESTRICTED_DRAWERS as readonly string[]).includes(drawerName);
}
