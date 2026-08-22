/**
 * Exchange lot policy — which currencies get cost-basis lot tracking
 * (EXCHANGE_LOT_SETTLEMENT.md, owner decision Q1, 2026-08-22).
 *
 * USD and LBP are EXEMPT from lot tracking — they keep the existing
 * half-spread-vs-mid-market profit snapshot (`computeLegProfitUsd`)
 * unchanged. Two independent reasons, not one:
 *
 *   - USD is the shop's own profit-reporting basis — every profit figure in
 *     this app is denominated in USD. Lot-tracking USD against itself is a
 *     category error: there is no "cost basis" for the unit everything else
 *     is measured in.
 *   - LBP flows through EVERY module (sales, recharges, debts, drawers,
 *     closing, ...), not just Exchange. Exchange-only FIFO lot matching on
 *     LBP would be fictional: the LBP a customer hands over in a sale, a
 *     debt payment, or a top-up is fungible with the LBP an exchange BUY
 *     acquires — there is no way to know which physical LBP a later
 *     exchange SELL actually draws from, so pretending Exchange alone
 *     tracks LBP lots would silently misattribute cost basis away from
 *     unrelated cash flows that touch the exact same drawer.
 *
 * Every OTHER currency ("exotic": EUR, GBP, AED, ...) is lot-tracked: a BUY
 * (or a foreign-currency drawer top-up, or an admin adjustment) creates an
 * open lot at its acquisition cost; a later SELL settles it FIFO, realizing
 * `qty x (proceeds - cost)` in USD — which can be negative (Q10, legitimate).
 */

/** Currencies exempt from lot tracking — see file header for why. */
export const LOT_EXEMPT_CURRENCIES = ["USD", "LBP"] as const;

export type LotExemptCurrency = (typeof LOT_EXEMPT_CURRENCIES)[number];

/**
 * True for any "exotic" currency (non-USD, non-LBP) — the only currencies
 * `ExchangeLotRepository` will ever create or consume a lot for. USD/LBP
 * exchange legs keep booking through the existing spread model untouched.
 */
export function isLotTrackedCurrency(code: string): boolean {
  return !(LOT_EXEMPT_CURRENCIES as readonly string[]).includes(code);
}

/**
 * Below this remaining quantity a lot counts as fully depleted and is
 * excluded from the FIFO open-lot scan (the `OPEN_LOT_PREDICATE` fragment in
 * `ExchangeLotRepository`). Matches the 0.005 money epsilon already used
 * elsewhere in this codebase for "close enough to zero to stop caring"
 * (`PartnerRepository.applySettlementCoverage`, `fifoCoverage.ts`'s
 * `allocateFifo` default) — the same floating-point tolerance, reused here
 * for a currency quantity instead of a money amount.
 */
export const LOT_QTY_EPSILON = 0.005;
