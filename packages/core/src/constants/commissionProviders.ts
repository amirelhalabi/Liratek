/**
 * Financial-service providers whose `commission` column represents a real,
 * cash commission fee the shop earns — OMT/WHISH-style transfer/bill
 * commission, both the legacy classic flow and the app-wallet
 * (OMT_APP/WHISH_APP) flow, and Binance. Distinct from
 * `WALLET_PROVIDERS` (walletProviders.ts) — OMT_APP/WHISH_APP/BINANCE
 * happen to be members of both lists for different reasons (one is about
 * who owns the balance moved, this one is about whether the fee is a real
 * commission vs a cost/price margin) — and from the cost/price "mobile
 * services" family (iPick, Katsh, BOB), whose profit is a MARGIN
 * (price − cost), never a commission.
 *
 * Canonical list (CLAUDE.md rule 14 — a business predicate is defined ONCE
 * and reused). `ProfitRepository.ts`'s own private `COMMISSION_PROVIDERS`
 * SQL literal (`"'OMT', 'WHISH', 'OMT_APP', 'WHISH_APP', 'BINANCE'"`) spells
 * the SAME 5 providers a second time, because the lane that owns
 * `CommissionsReportService.ts` (OWNER_NOTES_2026-09-21.md §6, lane LC) is
 * explicitly forbidden from editing `ProfitRepository.ts` (shared-tree
 * protocol — several other lanes edit that file concurrently). This module
 * exists so that prohibition doesn't also force a SECOND hand-copy with no
 * path back to one source: whichever lane next has permission to touch
 * `ProfitRepository.ts` should replace its inline literal with
 * `COMMISSION_PROVIDERS_SQL_LIST` exported below (LC-3, round-2 review).
 *
 * The Commissions tab (`CommissionsReportService.ts`'s
 * `COMMISSION_REPORT_PROVIDERS`) reports every provider in this list. It
 * used to exclude BINANCE, whose rows are stored in 'USDT' (LC-1); since
 * LIRA-268 the profit queries report USDT as USD, so BINANCE is included.
 */
export const COMMISSION_PROVIDERS = [
  "OMT",
  "WHISH",
  "OMT_APP",
  "WHISH_APP",
  "BINANCE",
] as const;

export type CommissionProvider = (typeof COMMISSION_PROVIDERS)[number];

export function isCommissionProvider(
  provider: string,
): provider is CommissionProvider {
  return (COMMISSION_PROVIDERS as readonly string[]).includes(provider);
}

/** SQL IN-list literal built from COMMISSION_PROVIDERS — for query fragments
 *  (mirrors `WALLET_PROVIDERS_SQL_LIST`'s own convention in
 *  walletProviders.ts). */
export const COMMISSION_PROVIDERS_SQL_LIST = COMMISSION_PROVIDERS.map(
  (p) => `'${p}'`,
).join(", ");
