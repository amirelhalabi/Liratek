/**
 * PA-4.23 (a) — design brief for the By Module tab's expandable detail row
 * (OWNER_NOTES_2026-09-21.md §6.9 records only the literal instruction
 * "OMT/Whish/transfer rows show Commission: $x"; the loto/mobile/exchange
 * scope below is this file's own design decision, not a quoted owner
 * sentence — PFU-a-5 review). The row used to render an unconditional
 * "Revenue − Cost = Profit" equation for EVERY module — including rows whose
 * "revenue" is really a transfer's principal or a ticket's face value passed
 * straight through to a provider (an OMT/WHISH transfer, a loto ticket) and
 * rows that carry no revenue/cost pair at all (kept change, a counterparty
 * discount, a top-up/buyback fee). Rendering those as an equation reads as a
 * real revenue/cost figure the shop doesn't actually have.
 *
 * Rule 14 — this file is the ONE place that classifies a
 * `ProfitByModule.module` string into its rendering class; `Profits.tsx`
 * calls {@link classifyProfitModuleRow} instead of scattering per-row ifs.
 * Reachable from `packages/core/src/browser.ts` (the frontend needs it) —
 * this module stays a pure leaf, no Node built-in, ever (rule 29).
 *
 * The three classes:
 *   - EQUATION — a real priced module, or a module whose spread already
 *     holds by construction: SALE (PA-4.23's own net-of-discount/refund fix,
 *     see `ProfitRepository.getSalesRevCost`), RECHARGE_*, CUSTOM_SERVICE,
 *     MAINTENANCE, PM_FEE (the fee itself IS the row's revenue, cost is
 *     genuinely 0), the cost/price mobile-service providers (iPick/Katsh/BOB
 *     — `price − cost` is a real margin, never a commission, so a
 *     `FINANCIAL_SERVICE_iPick`/`_Katsh`/`_BOB` row stays here even though
 *     it shares the `FINANCIAL_SERVICE_` prefix with the commission
 *     providers below — PFU-a-2), and EXCHANGE (a spread: cost is
 *     `revenue − profit` by construction, not a plugged pass-through
 *     principal, and it is not a commission — PFU-a-4).
 *   - COMMISSION — pass-through/commission rows: a `FINANCIAL_SERVICE_*`
 *     module whose provider suffix passes {@link isCommissionProvider}
 *     (`constants/commissionProviders.ts` — OMT/WHISH/OMT_APP/WHISH_APP/
 *     BINANCE, the SAME list `ProfitRepository.ts`'s
 *     `COMMISSION_PROVIDERS_SQL_LIST` reuses, rule 14 — no second,
 *     re-texted "is this provider a commission provider" predicate; PFU-a-2
 *     closes the earlier bare-prefix match that also caught the cost/price
 *     mobile providers) plus LOTO (ticket face value).
 *   - PROFIT_ONLY — "profit-only rows (revenue 0 and cost 0 — kept change,
 *     discounts, supplier commission, top-up fees …)". These four modules
 *     (`ProfitService.getByModule`'s own PA-2.1 comment) always push
 *     `revenue_usd: 0, revenue_lbp: 0, cost_usd: 0, cost_lbp: 0` — an
 *     equation there would read "0 − 0 = <profit>", which is technically
 *     true but reads as "no revenue, no cost" when the real story is "this
 *     row has no revenue/cost concept at all".
 *
 * An unrecognized module (a future addition to `getByModule` that forgets to
 * classify itself here, or a `FINANCIAL_SERVICE_*` row whose provider is
 * neither a listed commission provider nor a listed mobile provider — e.g. a
 * tenant-configured bill provider) defaults to EQUATION — the safe
 * direction on a money page: it renders the row's real revenue/cost/profit
 * numbers verbatim rather than silently collapsing them into a single
 * unlabeled figure.
 */

import { isCommissionProvider } from "./commissionProviders.js";

export const PROFIT_ROW_CLASS = {
  EQUATION: "equation",
  COMMISSION: "commission",
  PROFIT_ONLY: "profit_only",
} as const;

export type ProfitRowClass =
  (typeof PROFIT_ROW_CLASS)[keyof typeof PROFIT_ROW_CLASS];

/** `ProfitByModule.module` values that carry a profit stamp but NO
 *  revenue/cost pair at all (always 0/0) — see this file's own doc comment. */
const PROFIT_ONLY_MODULES: ReadonlySet<string> = new Set([
  "KEPT_CHANGE",
  "COUNTERPARTY_DISCOUNT",
  "SUPPLIER_COMMISSION",
  "TOPUP_BUYBACK",
]);

/** `ProfitByModule.module` EXACT values whose revenue is a pass-through
 *  principal/face-value, not a priced item — see this file's own doc
 *  comment. `FINANCIAL_SERVICE_*` is matched separately, by provider
 *  suffix, below (provider codes are open/tenant-configured, never a closed
 *  set, and only a REAL commission provider's suffix qualifies — PFU-a-2). */
const COMMISSION_EXACT_MODULES: ReadonlySet<string> = new Set(["LOTO"]);

const FINANCIAL_SERVICE_MODULE_PREFIX = "FINANCIAL_SERVICE_";

/**
 * Classifies a `ProfitByModule.module` string for the By Module expandable
 * detail row. See this file's own doc comment for the full rationale.
 */
export function classifyProfitModuleRow(module: string): ProfitRowClass {
  if (PROFIT_ONLY_MODULES.has(module)) {
    return PROFIT_ROW_CLASS.PROFIT_ONLY;
  }
  if (COMMISSION_EXACT_MODULES.has(module)) {
    return PROFIT_ROW_CLASS.COMMISSION;
  }
  if (module.startsWith(FINANCIAL_SERVICE_MODULE_PREFIX)) {
    const provider = module.slice(FINANCIAL_SERVICE_MODULE_PREFIX.length);
    return isCommissionProvider(provider)
      ? PROFIT_ROW_CLASS.COMMISSION
      : PROFIT_ROW_CLASS.EQUATION;
  }
  return PROFIT_ROW_CLASS.EQUATION;
}
