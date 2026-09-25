/**
 * Profit Service
 *
 * Comprehensive profit analytics across all revenue modules:
 * - Product sales (sold price - cost price)
 * - Financial services (commission)
 * - Recharges - MTC/Alfa (price - cost)
 * - Custom services (price - cost)
 * - Maintenance (price - cost)
 * - Expenses (deducted from profit)
 *
 * Supports filtering by date range, module, payment method, and user.
 *
 * All SQL lives in ProfitRepository (cross-entity reporting repo). This service
 * keeps only assembly, per-currency aggregation/summing, currency-splitting and
 * business decisions — it never touches the database.
 */

import {
  getProfitRepository,
  type ProfitRepository,
  type DeferredProfitRow,
} from "../repositories/ProfitRepository.js";
import {
  getRateRepository,
  type RateRepository,
} from "../repositories/RateRepository.js";
import { formatMoneyAmount } from "../utils/formatMoney.js";
import logger from "../utils/logger.js";

/**
 * PA-4.12 (OWNER_NOTES_2026-09-21.md §6.6) — human labels for provider
 * codes on By Module rows. Falls back to the raw code for anything not
 * listed (a new/renamed provider degrades to today's behavior, never a
 * blank label).
 */
const PROVIDER_LABELS: Record<string, string> = {
  OMT: "OMT",
  WHISH: "Whish",
  OMT_APP: "OMT App",
  WHISH_APP: "Whish App",
  BINANCE: "Binance",
  iPick: "iPick",
  Katsh: "Katsh",
  BOB: "BOB",
};

function humanizeProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * PA-4.12 — a By Module row's USD-equivalent at the tenant's configured LBP
 * buy rate, for sorting only (never displayed — that stays per-currency).
 * `buyRate` null (no rate configured) degrades to USD-only, matching the
 * PRE-fix sort exactly for a tenant that has never set an LBP rate.
 */
function usdEquivalentForSort(
  row: { profit_usd: number; profit_lbp: number },
  buyRate: number | null,
): number {
  if (buyRate === null || buyRate === 0) return row.profit_usd;
  return row.profit_usd + row.profit_lbp / buyRate;
}

/**
 * PA-4.21 (OWNER_NOTES_2026-09-21.md §6.6, LIRA-183) — server-side margin for
 * a By Module row. A row with only ONE currency (the overwhelmingly common
 * case — most modules are single-currency) reports an EXACT, rate-free
 * margin off that currency alone (`margin_converted: false`). A row that
 * mixes both currencies (nonzero revenue/cost in USD AND LBP — e.g. a Custom
 * Service priced with a USD deposit and an LBP balance) can only be combined
 * into one percentage by converting one side via the LBP buy rate
 * (`margin_converted: true`); with no rate configured, `margin_pct` is
 * `null` rather than a fabricated ratio (rule 8). Anchored in LBP terms
 * (multiply the USD side by `buyRate`), matching
 * {@link ProfitSummary.totals}'s own combined-line convention.
 */
function computeMargin(
  row: { revenue_usd: number; revenue_lbp: number; profit_usd: number; profit_lbp: number },
  buyRate: number | null,
): { margin_pct: number | null; margin_converted: boolean } {
  const hasUsd = row.revenue_usd !== 0 || row.profit_usd !== 0;
  const hasLbp = row.revenue_lbp !== 0 || row.profit_lbp !== 0;
  const mixed = hasUsd && hasLbp;

  if (!mixed) {
    const revenue = hasLbp ? row.revenue_lbp : row.revenue_usd;
    const profit = hasLbp ? row.profit_lbp : row.profit_usd;
    return {
      margin_pct: revenue !== 0 ? (profit / revenue) * 100 : null,
      margin_converted: false,
    };
  }

  if (buyRate === null || buyRate === 0) {
    return { margin_pct: null, margin_converted: true };
  }
  const revenueLbpEq = row.revenue_lbp + row.revenue_usd * buyRate;
  const profitLbpEq = row.profit_lbp + row.profit_usd * buyRate;
  return {
    margin_pct: revenueLbpEq !== 0 ? (profitLbpEq / revenueLbpEq) * 100 : null,
    margin_converted: true,
  };
}

// =============================================================================
// Types
// =============================================================================

export interface ProfitByModule {
  module: string;
  label: string;
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  count: number;
  /** MAINTENANCE row only (LIRA-176): parts are always USD (owner decision
   *  2026-09-07, "option 4" — never converted), so this labour/parts split
   *  only ever has a USD side. */
  parts_revenue_usd?: number;
  parts_cost_usd?: number;
  parts_profit_usd?: number;
  /** profit_usd minus parts_profit_usd. Note `profit_usd` also carries any
   *  T3 kept-change gain, so a kept-change gain is attributed to labour by
   *  this subtraction — a deliberate, documented approximation (kept change
   *  is a rounding gain on the payment, not a part margin), not a bug. */
  labour_profit_usd?: number;
  /** LBP has no parts leg at all, so this is just profit_lbp restated for
   *  symmetry with labour_profit_usd. */
  labour_profit_lbp?: number;
  /** PA-4.21 — net margin %, computed server-side (see {@link computeMargin}).
   *  `null` when revenue is 0 (nothing to divide by) or the row mixes
   *  USD+LBP and no LBP rate is configured to combine them. */
  margin_pct: number | null;
  /** PA-4.21 — true when `margin_pct` required converting one currency into
   *  the other (the row has nonzero USD AND LBP activity); false for a
   *  single-currency row, whose margin is exact and rate-free. */
  margin_converted: boolean;
  /**
   * LO-V1/PA-3.1 (round 2, OWNER_NOTES_2026-09-21.md §6) — kept change
   * stamped in the OTHER currency on this row's own transaction(s) (see
   * `ProfitRepository.otherCurrencyKeptChangeUsd`/`Lbp`'s doc comment for
   * the full mechanism). Only ever populated on `FINANCIAL_SERVICE_*` and
   * `RECHARGE_*` rows (the two sources that can carry an off-currency
   * stamp) — `undefined` elsewhere, never a fabricated 0. Additive: NOT
   * already folded into `profit_usd`/`profit_lbp` above, which keep meaning
   * "this row's own margin". A caller building a Revenue − Cost = Profit
   * breakdown that must reconcile to gross should add these in.
   */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /**
   * PFU-a-3 (verifier round-1 fix) — SALE row ONLY. UNLIKE
   * {@link kept_change_usd}/{@link kept_change_lbp} above, this is NOT
   * additive: it is the portion of THIS row's own `profit_usd`/`profit_lbp`
   * that T3 keep-change contributed (`SalesRepository.createSale` stamps
   * `saleProfitUsd + kept_change_usd` directly onto the SALE transaction —
   * there is no separate `sales.kept_change_usd` column to re-query, so it
   * is derived as the residual `profit − (revenue − cost)`). A caller
   * reconciling Overview = Σ By Module must NOT add this to `profit_usd`/
   * `profit_lbp` (it is already inside them) — it exists only so the By
   * Module UI can render "revenue − cost + kept change = profit" instead of
   * a bare equation that silently doesn't add up. `undefined` when the sale
   * carries no kept change (the common case).
   *
   * PFU-a-3-residual (verifier round 2) — the arithmetic identity `profit −
   * (revenue − cost) ≡ this value` is exact BY CONSTRUCTION (it is defined
   * as that residual), which is only a tautology about the subtraction, NOT
   * a guarantee that the residual is genuinely T3 kept change. Any other
   * disagreement between the SALE ledger stamp and the sale_items margin —
   * e.g. a stale/wrong-cost SALE stamp from a since-fixed bug window —
   * lands in this SAME field, with no way to tell the two apart from the
   * number alone (there is no persisted `sales.kept_change_usd` to compare
   * against; see above). A NEGATIVE value is the tell worth treating
   * specially: genuine kept change from tendering round currency is never
   * negative in practice, so the caller (`Profits.tsx`) renders a negative
   * `sale_kept_change_usd`/`_lbp` as "unexplained difference" rather than
   * "kept change" — this field's own SIGN, not a separate flag, carries
   * that distinction, since a real kept-change source would require a
   * migration this lane is not authorized to add.
   */
  sale_kept_change_usd?: number;
  sale_kept_change_lbp?: number;
}

/**
 * PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — one row
 * of the Profits page's "Show transactions" drill-down (SALE or
 * RECHARGE_<carrier>; see {@link ProfitService.getModuleDetail}).
 * `amount_usd`/`amount_lbp`/`cost_usd`/`cost_lbp`/`profit_usd`/`profit_lbp`
 * are this ONE transaction's own figures, unweighted — exactly the same
 * per-currency convention {@link ProfitByModule} already uses at the module
 * level, just per row instead of summed. `counted_profit_usd`/`_lbp` is the
 * weighted (recognised) share; summing it across every `counted` row
 * reproduces the parent {@link ProfitByModule} row's own `profit_usd`/
 * `profit_lbp` exactly (rule 14 — shared weighting fragments).
 */
export interface ProfitModuleDetailRow {
  id: number;
  date: string;
  /** Client name/phone, or "Walk-in" when neither is on file. */
  counterpart: string;
  /** SALE: comma-joined item list. RECHARGE: the credit amount sold.
   *  `null` only on a schema-drift-degraded SALE fixture with no product
   *  join available (see `ProfitRepository.getSalesDetail`'s own doc
   *  comment). */
  detail: string | null;
  amount_usd: number;
  amount_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  /** 0-100, one decimal. 100 = fully recognised (the common case, no
   *  `reason` below); 0 = not counted at all yet. */
  counted_pct: number;
  counted_profit_usd: number;
  counted_profit_lbp: number;
  /** Why this row isn't (fully) counted — `null` when `counted_pct` is 100.
   *  Owner decision (#14 slice 2): every excluded/partial row must show a
   *  reason, never a bare number. */
  reason: string | null;
  /** Auto-booked fee tied to this transaction (SMS/Line_Usage —
   *  `expenses.source_ref_table = 'recharges'`), shown NEXT TO the row —
   *  never subtracted from `profit_usd`/`counted_profit_usd` above (owner
   *  decision: "+90,000 LBP profit · SMS fee -0.32$ (booked in expenses)").
   *  `null` when this transaction has no linked auto expense. */
  fee_note: string | null;
}

/**
 * PROF-DD — the full drill-down payload for one By Module row.
 * `counted`'s rows sum to `counted_total_profit_usd`/`_lbp`, which must
 * equal the parent {@link ProfitByModule} row's own `profit_usd`/
 * `profit_lbp` exactly — the reconciliation the owner asked for ("counted
 * rows add up EXACTLY to the module row"). `not_counted` is every row this
 * module has zero recognised profit from yet (still greyed-out material,
 * never omitted — rule 8, don't make real activity invisible).
 */
export interface ProfitModuleDetail {
  module: string;
  counted: ProfitModuleDetailRow[];
  not_counted: ProfitModuleDetailRow[];
  counted_total_profit_usd: number;
  counted_total_profit_lbp: number;
}

export interface ProfitByDate {
  date: string;
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  expenses_usd: number;
  expenses_lbp: number;
  net_profit_usd: number;
  net_profit_lbp: number;
}

export interface ProfitByPaymentMethod {
  method: string;
  /** NEW-SALES intake, net of change/payout legs and partial item refunds
   *  — see `ProfitRepository.PaymentMethodRow`'s doc comment (owner decision
   *  1, 2026-09-24). A synthetic Commission/Commission-Pending row (pushed
   *  below, not from `getPaymentMethodRows`) has no debt-repayment concept
   *  at all, so its own `debt_repayment_usd`/`_lbp` are simply omitted
   *  (optional — undefined reads as 0 in the UI). */
  total_usd: number;
  total_lbp: number;
  /** Owner decision 3: debt-repayment intake, its OWN column instead of the
   *  old all-or-nothing `is_debt_repayment_only` flag. */
  debt_repayment_usd?: number;
  debt_repayment_lbp?: number;
  count: number;
  /** For commission rows: the pending amount not yet realized
   *  (commission_model = 0 legacy rows only — see D15). */
  pending_commission_usd?: number;
  /** LBP counterpart of pending_commission_usd (commission_model = 0 legacy
   *  rows only). Previously silently dropped — the pending row hardcoded
   *  total_lbp/pending_commission_lbp to 0, so pending LBP commission never
   *  reached the UI at all. */
  pending_commission_lbp?: number;
  /** LIRA-158 D15: count of commission_model = 1 rows awaiting settlement.
   *  Their commission is unknowable until the operator enters it at
   *  settlement, so they are surfaced as a COUNT here, never a dollar
   *  figure — unlike pending_commission_usd/lbp above, which stay dollar
   *  amounts for legacy model-0 rows. */
  awaiting_settlement_count?: number;
  /** 1 = realized/settled, 0 = pending settlement */
  is_settled?: number;
}

export interface ProfitByUser {
  user_id: number;
  username: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** PA-4.19: transaction_count minus REFUND/SUPPLIER_SETTLEMENT rows and an
   *  unrecognized FS row — the correct "Avg Profit/Txn" denominator. See
   *  ProfitRepository.getByUser's own doc comment for the full rationale. */
  recognized_transaction_count: number;
  /** Pending profit from unsettled OMT/WHISH commissions for this cashier */
  pending_profit_usd: number;
  /** PA-1.3: LBP half of pending_profit_usd, split by currency. */
  pending_profit_lbp: number;
}

export interface ProfitSummary {
  period: string;
  sales: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    /** PA-3.1 — kept change stamped in LBP (transactions.profit_lbp =
     *  kept_change_lbp) on an otherwise-USD sale. The ONLY LBP profit a sale
     *  ever carries — sales revenue/cost stay USD-only. */
    profit_lbp: number;
    count: number;
  };
  financial_services: {
    revenue_usd: number;
    revenue_lbp: number;
    /** PA-3.6 — unsettled FS revenue, kept OUT of `revenue_usd`/`revenue_lbp`
     *  above (which feed `totals.gross_revenue_*`) so a not-yet-realized
     *  transfer's principal no longer inflates "Total Revenue" while its
     *  commission stays correctly excluded from gross profit. Additive
     *  visibility only, shown on the yellow Pending line. */
    pending_revenue_usd: number;
    pending_revenue_lbp: number;
    commission_usd: number;
    commission_lbp: number;
    /** PA-2.4 — the CASHLESS half of `ProfitRepository.getSupplierCommissionTotals`
     *  (real money the shop won't see until the client repays the underlying
     *  transfer — D17), shown on THIS card as "Commission (at settlement)"
     *  instead of under Supplier Commission (bills-only). Already included
     *  in `totals.gross_profit_*` via `supplier_commission`'s combined
     *  figure below — purely a display re-routing, not a second sum. */
    commission_at_settlement_usd: number;
    commission_at_settlement_lbp: number;
    pending_commission_usd: number;
    pending_commission_lbp: number;
    /** LIRA-162: count of commission_model = 1 rows awaiting settlement in
     *  this period (from {@link ProfitRepository.getPendingCommissionTotals}
     *  — the SAME D15 count `ProfitService.getByPaymentMethod` already
     *  surfaces). Never a dollar figure — a model-1 row's real commission is
     *  unknowable until the operator enters it at settlement (D15), so
     *  `commission_usd`/`_lbp` and `pending_commission_usd`/`_lbp` above stay
     *  LEGACY-model-only; this count is model-1's only honest counterpart.
     *  Before this field, the Overview/Commissions cards had no way to know
     *  a model-1 commission existed at all — `pending_commission_usd/_lbp`
     *  read 0 for an all-model-1 period, and the "Pending" line sat behind a
     *  `> 0` guard that never fired, so it didn't render $0.00 — it silently
     *  didn't render anything. */
    awaiting_settlement_count: number;
    /** Payment-method fees kept by the shop (immediate profit, PM_FEE rows) */
    pm_fee_usd: number;
    pm_fee_lbp: number;
    /**
     * LO-R2 (round 3, closing PA-3.1's last arm) — a settled FS commission
     * row's OTHER-currency kept change (`ProfitRepository.FinCurrencyRow
     * .kept_change_usd/_lbp`, `getFinancialSettledByCurrency`). Already
     * folded into `totals.gross_profit_usd`/`_lbp` and into the top-level
     * `kept_change` roll-up below, same convention as
     * `recharges.kept_change_usd/_lbp`/`mobile_services.kept_change_usd/_lbp`
     * /`loto.kept_change_usd` — see this class's own `getSummary` doc
     * comment for why this was the one source still missing.
     */
    kept_change_usd: number;
    kept_change_lbp: number;
    /**
     * Owner decision (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md
     * §6.9, L0-4) — the recognised FS commission whose underlying transfer
     * is still charged to a CUSTOMER_ACCOUNT and not yet repaid (the exact
     * population `notDebtPending` excludes from `commission_usd`/`_lbp`
     * above — see `ProfitRepository.getFinancialWaitingForRepaymentByCurrency`'s
     * own doc comment). Shown on the Financial Services card like the
     * card's other pending figures (`pending_commission_usd`/`_lbp`) —
     * additive visibility ONLY. Deliberately NEVER folded into
     * `commission_usd`/`_lbp`, `totals.gross_profit_*` or
     * `totals.net_profit_*`: the owner's own wording is "kept out of profit
     * until repaid".
     */
    waiting_for_repayment_usd: number;
    waiting_for_repayment_lbp: number;
    count: number;
  };
  mobile_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    /** @see ProfitByModule.kept_change_usd — same convention; already
     *  included in `totals.gross_profit_usd`/`_lbp` below. */
    kept_change_usd: number;
    kept_change_lbp: number;
    count: number;
  };
  custom_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  recharges: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    /** @see ProfitByModule.kept_change_usd — same convention; already
     *  included in `totals.gross_profit_usd`/`_lbp` below. */
    kept_change_usd: number;
    kept_change_lbp: number;
    count: number;
  };
  maintenance: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  loto: {
    revenue_lbp: number;
    profit_lbp: number;
    /** LO-V1/PA-3.1 — USD-side kept change on an otherwise LBP-native loto
     *  ticket; already included in `totals.gross_profit_usd` below (loto had
     *  NO USD term there at all before this field existed). */
    kept_change_usd: number;
    count: number;
  };
  exchange: {
    revenue_usd: number;
    profit_usd: number;
    count: number;
  };
  /** T3 keep-change on debt repayments — kept change stamped on
   *  DEBT_REPAYMENT transactions ("Other / kept change" line; owner decision
   *  2026-07-13, docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-2). */
  debt_repayments: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  /** CQ-10 (D1) — signed profit from counterparty discounts/write-offs across
   *  all three ledgers (debt/supplier/partner): a forgiven receivable is
   *  negative, a received discount is positive. NETTED into totals below
   *  (same treatment as debt_repayments) — a discount is a real P&L event,
   *  not just a footnote. */
  discounts: { usd: number; lbp: number };
  /**
   * LO-V1/PA-3.1 (round 2, OWNER_NOTES_2026-09-21.md §6) — the shop's total
   * OTHER-currency kept change across recharges, mobile services (iPick/
   * Katsh/BOB) and loto (`recharges.kept_change_usd/_lbp` +
   * `mobile_services.kept_change_usd/_lbp` + `loto.kept_change_usd`, summed
   * here for convenience). ALREADY included in `totals.gross_profit_*`/
   * `net_profit_*` below (rule 14: this is a display convenience, not a
   * second sum) — additive visibility only, matching `discounts` above and
   * `sales.profit_lbp` (a sale's own kept change, shown on the `sales`
   * block, NOT repeated here — this field is exactly the four sources
   * `sales` does not carry). Meant for the "Kept Change" card, alongside
   * `debt_repayments` (kept change on a DEBT_REPAYMENT/standalone
   * KEPT_CHANGE row — a DIFFERENT source table, not overlapping with this
   * field) and `sales.profit_lbp`.
   *
   * LO-R2 (round 3, OWNER_NOTES_2026-09-21.md §6) — a financial-service
   * COMMISSION row's (OMT/WHISH/OMT_APP/WHISH_APP/BINANCE) own off-currency
   * kept change is now ALSO included (`financial_services.kept_change_usd/
   * _lbp`, sourced from `getFinancialSettledByCurrency`'s new
   * `kept_change_usd/_lbp` columns) — this was the one source By Module/By
   * Date's FS-provider rows already carried
   * (`FinByProviderRow.kept_change_usd/_lbp`, `getFinancialSettledByProvider`)
   * that the Overview aggregate was missing, so Σ By Module and the Overview
   * now agree on the model-1 OMT/WHISH case (PA-2.10).
   */
  kept_change: { usd: number; lbp: number };
  /** LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — bills-only
   *  settlement commission (Katsh/iPick BILL rows), profit-only (no
   *  revenue/cost pair) and stamped directly on the SUPPLIER_SETTLEMENT
   *  transaction at settlement. NETTED into totals below (same immediate-
   *  recognition treatment as debt_repayments/discounts — the commission
   *  arrives directly into the provider drawer at settlement, so no
   *  partner-/debt-pending gate applies to it, unlike financial_services
   *  commission). Exactly 0 for every other settlement shape (legacy
   *  commission_model = 0, or a non-bills new-model batch). */
  supplier_commission: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  /** PA-2.3 — TELECOM_CREDIT_BUYBACK + RECHARGE_TOPUP profit (owner ruling
   *  2026-09-21), previously invisible on the Overview though already
   *  counted in By Cashier/By Client via `PROFIT_TXN_TYPES`. Profit-only, no
   *  revenue/cost pair (see {@link ProfitRepository.getTopupBuybackProfit}'s
   *  own doc comment for why). NETTED into `totals` below, same immediate-
   *  recognition treatment as debt_repayments/discounts/supplier_commission. */
  topups_buybacks: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  expenses: { total_usd: number; total_lbp: number; count: number };
  totals: {
    gross_revenue_usd: number;
    gross_revenue_lbp: number;
    total_cost_usd: number;
    total_cost_lbp: number;
    gross_profit_usd: number;
    gross_profit_lbp: number;
    net_profit_usd: number;
    net_profit_lbp: number;
    /** OWNER_NOTES_2026-09-21.md §6.6 PA-4.21, note #3 — CLOSED "no change"
     *  2026-09-24: the owner rejected combining USD and LBP net profit into
     *  one figure (credits are reduced in USD, so a `-0.32$` stays a USD
     *  figure and must never be folded into an LBP total). The former
     *  `combined_net_profit_lbp`/`combined_rate_used` pair and every
     *  rendering of "Total Net Profit ≈ X LBP (at buy rate N)" are REMOVED.
     *  `lbp_buy_rate` (tenant-scoped LBP `buy_rate` via `RateRepository` —
     *  NEVER `getUsdLbpSellRate`) is kept ONLY because the By Module footer's
     *  TOTAL-row margin_pct (LIRA-183, explicitly kept) still needs a rate to
     *  weight a mixed-currency period the same way `computeMargin` does per
     *  row — it must never be used to compute or display a combined net
     *  profit again. `null` when no LBP rate is configured for this tenant. */
    lbp_buy_rate: number | null;
  };
  /** Deferred-profit visibility (owner ask 2026-07-14): profit already
   *  stamped on a transaction but currently STRANDED behind an uncovered
   *  partner settlement (PFT-6) or client-debt repayment (DBT-1). Additive
   *  visibility only — NOT netted into `totals` above (those already exclude
   *  it via the same partner/debt gates). */
  deferred: {
    partner_profit_usd: number;
    partner_profit_lbp: number;
    client_debt_profit_usd: number;
    client_debt_profit_lbp: number;
    /** PA-3.10 — the D17 cashless-settlement share ALONE (already folded,
     *  undistinguished, into `client_debt_profit_usd`/`_lbp` above). Ordinary
     *  debt-pending recharge/service/loto/maintenance profit is NEVER
     *  included here — see `DeferredProfitRow`'s own doc comment. The
     *  "Supplier Commission: Deferred" card gates on THIS field, not the
     *  combined one, so it stops rendering for every ordinary unpaid-debt
     *  period. */
    cashless_deferred_profit_usd: number;
    cashless_deferred_profit_lbp: number;
    /** PA-3.11 — unpaid sales (`ProfitRepository.getPendingSaleProfit`,
     *  date-independent per PA-3.8), previously nowhere on the Overview.
     *  Additive visibility only, same convention as every other field on
     *  this block — NOT netted into `totals` above (an unpaid sale's profit
     *  is not yet realized). */
    unpaid_sales_outstanding_usd: number;
    unpaid_sales_potential_profit_usd: number;
  };
}

export interface ProfitByClient {
  client_id: number | null;
  client_name: string;
  client_phone: string | null;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** @see ProfitByUser.recognized_transaction_count */
  recognized_transaction_count: number;
  /** Pending profit from unsettled commissions linked to this client */
  pending_profit_usd: number;
  /** @see ProfitByUser.pending_profit_lbp */
  pending_profit_lbp: number;
}

export interface PendingProfitRow {
  sale_id: number;
  created_at: string;
  client_name: string;
  client_phone: string;
  total_amount_usd: number;
  paid_usd: number;
  outstanding_usd: number;
  potential_profit_usd: number;
  items_summary: string;
}

export interface UnsettledCommissionRow {
  id: number;
  provider: string;
  omt_service_type: string | null;
  amount: number;
  currency: string;
  commission: number;
  omt_fee: number | null;
  created_at: string;
}

// =============================================================================
// Service
// =============================================================================

export class ProfitService {
  private repo: ProfitRepository;
  /** PA-4.12 (sort by USD-equivalent) / PA-4.21 margin only (combined line
   *  dropped, note #3) — the tenant-scoped LBP buy_rate read. Injected
   *  (SOLID/DIP) rather than called via a free function, matching this
   *  class's existing `repo` pattern. */
  private rateRepo: RateRepository;

  constructor(
    repo: ProfitRepository = getProfitRepository(),
    rateRepo: RateRepository = getRateRepository(),
  ) {
    this.repo = repo;
    this.rateRepo = rateRepo;
  }

  /**
   * PA-4.12/PA-4.21 — the tenant's configured LBP buy_rate, or `null` when
   * none is set. Defensive (mirrors `utils/exchangeRate.ts`'s own
   * `getUsdLbpSellRate` precedent — "if the table or row is missing ...
   * return {@link FALLBACK...} instead of throwing", except this method's
   * contract is explicitly to return `null` rather than any fallback
   * number, per PA-4.21's "null + 'set an LBP rate' when missing"): a
   * fixture/tenant whose `exchange_rates` table doesn't exist yet (many
   * pre-existing unit-test fixtures across this codebase predate this
   * method's addition) degrades to "no rate configured" instead of throwing
   * and taking the WHOLE getSummary/getByModule call down with it — sorting
   * and margin display are a courtesy on top of the real figures, never a
   * reason to fail the whole page.
   */
  private getLbpBuyRate(): number | null {
    try {
      const rate = this.rateRepo.findByCode("LBP")?.buy_rate ?? null;
      // LO-V7 (round 2 adversarial review) — `?? null` does not catch a
      // STORED 0: a tenant whose LBP rate row exists but reads `buy_rate =
      // 0` used to flow straight through as "the rate", which (back when
      // this fed the now-removed combined net-profit line) silently zeroed
      // out the USD side under a label reading "at buy rate 0" instead of
      // the honest "no rate configured" `null`. The sort
      // (`usdEquivalentForSort`) and margin (`computeMargin`) helpers still
      // guard `buyRate === 0` explicitly — this makes the SOURCE of the rate
      // agree with them instead of handing them a value they then have to
      // defend against.
      return rate !== null && rate > 0 ? rate : null;
    } catch (error) {
      logger.warn({ error }, "ProfitService.getLbpBuyRate: rate lookup failed, degrading to null");
      return null;
    }
  }

  /**
   * Overall profit summary for a date range.
   */
  getSummary(from: string, to: string): ProfitSummary {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // 1. Sales — revenue + cost from sale_items; profit from unified ledger.
      const salesRevCost = this.repo.getSalesRevCost(fromDt, toDt);
      const salesProfitRow = this.repo.getSalesProfit(fromDt, toDt);

      const sales = {
        revenue_usd: salesRevCost.revenue_usd,
        cost_usd: salesRevCost.cost_usd,
        profit_usd: salesProfitRow.profit_usd,
        // PA-3.1: kept change stamped in LBP — the sale's only LBP profit.
        profit_lbp: salesProfitRow.profit_lbp,
        count: salesRevCost.count,
      };

      // 2. Financial services (OMT, WHISH, OMT_APP, WHISH_APP, BINANCE) — settled.
      const finRows = this.repo.getFinancialSettledByCurrency(fromDt, toDt);

      const finSvc = {
        revenue_usd: 0,
        revenue_lbp: 0,
        pending_revenue_usd: 0,
        pending_revenue_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        commission_at_settlement_usd: 0,
        commission_at_settlement_lbp: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        awaiting_settlement_count: 0,
        pm_fee_usd: 0,
        pm_fee_lbp: 0,
        kept_change_usd: 0,
        kept_change_lbp: 0,
        waiting_for_repayment_usd: 0,
        waiting_for_repayment_lbp: 0,
        count: 0,
      };
      for (const row of finRows) {
        // PA-1.4: EXACT currency match — a third currency (e.g. a Binance
        // USDT row) used to be lumped into the USD bucket by the old
        // `!== "LBP"` fallback. It now contributes to neither (dropped, per
        // owner's own sanctioned option — see the repo's matching fix for
        // the fuller rationale).
        // LO-V10 (round 2): `count` moved INSIDE each branch — a dropped
        // third-currency row's transactions used to still inflate
        // `finSvc.count` even though its money landed in neither bucket
        // (a "Count: 3" reading with $0.00 + 0 LBP to show for it).
        // LO-R2 (round 3): `row.kept_change_usd`/`_lbp` are ALREADY the
        // OTHER currency's stamp (see FinCurrencyRow's own doc comment) — a
        // `currency: 'USD'` row carries kept_change_lbp, a `currency: 'LBP'`
        // row carries kept_change_usd. Same mirrored convention as the
        // recharges/mobileSvc loops below, not a repeat of `commission`.
        if (row.currency === "USD") {
          finSvc.revenue_usd += row.revenue;
          finSvc.commission_usd += row.commission;
          // `?? 0`: FinCurrencyRow.kept_change_usd/_lbp are optional on the
          // TYPE (getFinancialPendingByCurrency's rows never select them —
          // see that field's own doc comment) though this SPECIFIC loop only
          // ever sees getFinancialSettledByCurrency's rows, which always
          // populate them via COALESCE — defensive, not a fabricated value.
          finSvc.kept_change_lbp += row.kept_change_lbp ?? 0;
          finSvc.count += row.count;
        } else if (row.currency === "LBP") {
          finSvc.revenue_lbp += row.revenue;
          finSvc.commission_lbp += row.commission;
          finSvc.kept_change_usd += row.kept_change_usd ?? 0;
          finSvc.count += row.count;
        }
      }

      // Pending (unsettled) commissions. PA-3.6: kept in a SEPARATE
      // pending_revenue_* bucket, no longer folded into revenue_usd/_lbp
      // above (which feed totals.gross_revenue_* — an unsettled transfer's
      // principal is not yet realized revenue).
      const pendingRows = this.repo.getFinancialPendingByCurrency(fromDt, toDt);
      for (const row of pendingRows) {
        // LO-V10 (round 2): same `count`-placement fix as the settled loop
        // above.
        if (row.currency === "USD") {
          finSvc.pending_commission_usd += row.commission;
          finSvc.pending_revenue_usd += row.revenue;
          finSvc.count += row.count;
        } else if (row.currency === "LBP") {
          finSvc.pending_commission_lbp += row.commission;
          finSvc.pending_revenue_lbp += row.revenue;
          finSvc.count += row.count;
        }
      }

      // Owner decision (h), 2026-09-24 afternoon — commission on an
      // OMT/WHISH-family transfer that IS recognised but is still charged to
      // a customer's account and not yet repaid (the population
      // `notDebtPending` excludes from `finSvc.commission_usd`/`_lbp` above).
      // Additive visibility only, like `pending_revenue_*`/
      // `pending_commission_*` above — NEVER folded into
      // `totals.gross_profit_*`/`totals.net_profit_*` (kept out of profit
      // until repaid).
      const waitingForRepaymentRows =
        this.repo.getFinancialWaitingForRepaymentByCurrency(fromDt, toDt);
      for (const row of waitingForRepaymentRows) {
        if (row.currency === "USD") {
          finSvc.waiting_for_repayment_usd += row.commission;
          finSvc.count += row.count;
        } else if (row.currency === "LBP") {
          finSvc.waiting_for_repayment_lbp += row.commission;
          finSvc.count += row.count;
        }
      }

      // LIRA-162: D15's "N transactions awaiting settlement" count (already
      // powering the By-Payment-Method tab via getByPaymentMethod) is now
      // ALSO carried onto the Overview/Commissions finSvc block — see
      // ProfitSummary.financial_services.awaiting_settlement_count's doc
      // comment. getFinancialPendingByCurrency above is UNCHANGED (still the
      // source of revenue/count) — this is an addition, not a swap.
      finSvc.awaiting_settlement_count = this.repo.getPendingCommissionTotals(
        fromDt,
        toDt,
      ).awaiting_settlement_count;

      // Payment-method fees — immediate shop profit kept in the wallet drawer,
      // recorded as PM_FEE payment rows but previously never counted anywhere.
      for (const row of this.repo.getPmFeeTotals(fromDt, toDt)) {
        // LO-V10 (round 2): EXACT currency match — `getPmFeeTotals` groups
        // by the RAW `fs.currency` (not pre-bucketed), so the old
        // `else -> USD` fallback lumped any third currency's fee into
        // `pm_fee_usd`. Now dropped (neither bucket), matching PA-1.4.
        if (row.currency_code === "USD") {
          finSvc.pm_fee_usd += row.total;
        } else if (row.currency_code === "LBP") {
          finSvc.pm_fee_lbp += row.total;
        }
      }

      // 2b. Mobile services (iPick, Katsh, BOB) — cost/price flow.
      const mobileRows = this.repo.getMobileServicesByCurrency(fromDt, toDt);

      const mobileSvc = {
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        kept_change_usd: 0,
        kept_change_lbp: 0,
        count: 0,
      };
      for (const row of mobileRows) {
        // LO-V1/PA-3.1 — `row.kept_change` is ALWAYS the OTHER currency's
        // stamp (see ProfitRepository.getMobileServicesByCurrency's own
        // comment): a row grouped under 'LBP' carries USD kept change, and
        // vice versa — the mirror image of the `profit`/`revenue`/`cost`
        // branch below, not a repeat of it.
        // LO-V10 (round 2): EXACT currency match (the old `else -> USD`
        // fallback would have lumped a third currency in) AND `count` moved
        // inside each branch — same two fixes as the finSvc loop above.
        if (row.currency === "LBP") {
          mobileSvc.revenue_lbp += row.revenue;
          mobileSvc.cost_lbp += row.cost;
          mobileSvc.profit_lbp += row.profit;
          mobileSvc.kept_change_usd += row.kept_change;
          mobileSvc.count += row.count;
        } else if (row.currency === "USD") {
          mobileSvc.revenue_usd += row.revenue;
          mobileSvc.cost_usd += row.cost;
          mobileSvc.profit_usd += row.profit;
          mobileSvc.kept_change_lbp += row.kept_change;
          mobileSvc.count += row.count;
        }
      }

      // 3. Recharges (MTC/Alfa).
      const rechargeRows = this.repo.getRechargesByCurrency(fromDt, toDt);

      const recharges = {
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        kept_change_usd: 0,
        kept_change_lbp: 0,
        count: 0,
      };
      for (const row of rechargeRows) {
        // LO-V1/PA-3.1 — same convention as mobileSvc above.
        // LO-R5 (round 3): EXACT 'USD' match (not a bare `else`), and
        // `count` moved INSIDE each branch — same two fixes as the finSvc/
        // mobileSvc loops (a dropped third-currency row's transactions used
        // to still inflate `recharges.count` though its money landed in
        // neither bucket).
        if (row.currency_code === "LBP") {
          recharges.revenue_lbp += row.revenue;
          recharges.cost_lbp += row.cost;
          recharges.profit_lbp += row.profit;
          recharges.kept_change_usd += row.kept_change;
          recharges.count += row.count;
        } else if (row.currency_code === "USD") {
          recharges.revenue_usd += row.revenue;
          recharges.cost_usd += row.cost;
          recharges.profit_usd += row.profit;
          recharges.kept_change_lbp += row.kept_change;
          recharges.count += row.count;
        }
      }

      // 4. Custom services.
      const custom = this.repo.getCustomServicesTotals(fromDt, toDt);

      // 5. Maintenance.
      const maint = this.repo.getMaintenanceTotals(fromDt, toDt);

      // 5b. Loto ticket commissions (LBP).
      const loto = this.repo.getLotoTotals(fromDt, toDt);

      // 6. Exchange profit (v30+: sum leg profits).
      const exchange = this.repo.getExchangeTotals(fromDt, toDt);

      // Kept change stamped on debt repayments (T3 KC-2) — the only profit
      // source on DEBT_REPAYMENT rows; REFUND rows net a voided repayment out.
      const debtRepayments = this.repo.getDebtRepaymentProfit(fromDt, toDt);

      // CQ-10 (D1) — signed profit from counterparty discounts/write-offs
      // (debt/supplier/partner alike — one unified transaction type).
      const discountTotals = this.repo.getCounterpartyDiscountTotals(
        fromDt,
        toDt,
      );
      const discounts = {
        usd: discountTotals.profit_usd,
        lbp: discountTotals.profit_lbp,
      };

      // LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md), split by D17 /
      // PA-2.1 / PA-2.4: `supplierCommissionTotals` carries BOTH the
      // combined figure (used for gross calc below, unchanged arithmetic)
      // and the bills-only/cashless split — see SupplierCommissionTotalsRow's
      // own doc comment. The cashless share is surfaced on the Financial
      // Services block (`commission_at_settlement_usd/_lbp`, "Commission (at
      // settlement)"); the `supplier_commission` block returned below is
      // BILLS-ONLY now ("keep Supplier Commission for bills-only" — PA-2.4).
      const supplierCommissionTotals = this.repo.getSupplierCommissionTotals(
        fromDt,
        toDt,
      );
      finSvc.commission_at_settlement_usd =
        supplierCommissionTotals.cashless_profit_usd;
      finSvc.commission_at_settlement_lbp =
        supplierCommissionTotals.cashless_profit_lbp;
      const supplierCommission = {
        profit_usd: supplierCommissionTotals.bills_only_profit_usd,
        profit_lbp: supplierCommissionTotals.bills_only_profit_lbp,
        count: supplierCommissionTotals.bills_only_count,
      };

      // PA-2.3: TELECOM_CREDIT_BUYBACK + RECHARGE_TOPUP profit (owner ruling
      // 2026-09-21) — profit-only, same immediate-recognition treatment as
      // debtRepayments/discounts/supplierCommission.
      const topupsBuybacks = this.repo.getTopupBuybackProfit(fromDt, toDt);

      // 7. Expenses.
      const expenses = this.repo.getExpenseTotals(fromDt, toDt);

      // Deferred profit (PFT-6 partner + DBT-1 client-debt) — visibility
      // only; NOT netted into gross_profit_*/net_profit_* below, which
      // already exclude it via the same partner/debt gates.
      const deferredRow = this.repo.getDeferredProfit(fromDt, toDt);

      // PA-3.11: unpaid sales, previously nowhere on the Overview. Reuses
      // the SAME date-independent query the Pending tab already calls
      // (PA-3.8, "Pending means as of now") — no new SQL (rule 14).
      const unpaidSaleRows = this.repo.getPendingSaleProfit();
      const deferred = {
        ...deferredRow,
        unpaid_sales_outstanding_usd: unpaidSaleRows.reduce(
          (sum, r) => sum + r.outstanding_usd,
          0,
        ),
        unpaid_sales_potential_profit_usd: unpaidSaleRows.reduce(
          (sum, r) => sum + r.potential_profit_usd,
          0,
        ),
      };

      // Totals
      const grossRevenueUsd =
        sales.revenue_usd +
        finSvc.revenue_usd +
        recharges.revenue_usd +
        custom.revenue_usd +
        maint.revenue_usd +
        exchange.revenue_usd +
        mobileSvc.revenue_usd;
      const grossRevenueLbp =
        finSvc.revenue_lbp +
        recharges.revenue_lbp +
        custom.revenue_lbp +
        maint.revenue_lbp +
        loto.revenue_lbp +
        mobileSvc.revenue_lbp;
      const totalCostUsd =
        sales.cost_usd +
        recharges.cost_usd +
        custom.cost_usd +
        maint.cost_usd +
        mobileSvc.cost_usd;
      const totalCostLbp =
        recharges.cost_lbp +
        custom.cost_lbp +
        maint.cost_lbp +
        mobileSvc.cost_lbp;
      // PA-2.1/PA-2.4: gross profit sums the COMBINED supplier-commission
      // figure via its two now-separate homes (bills-only `supplierCommission`
      // + cashless `finSvc.commission_at_settlement_*`) — same total as
      // before this split, just attributed to two display blocks instead of
      // one (bills_only_profit + cashless_profit === the old combined value).
      // PA-3.1: sales.profit_lbp (kept change) is a NEW term — grossProfitLbp
      // previously had no sales contribution at all.
      // PA-2.3: topupsBuybacks is a NEW term, same immediate-recognition
      // treatment as debtRepayments/discounts.
      // LO-V1 (round 2) / LO-R2 (round 3): recharges/mobileSvc/loto/finSvc's
      // `kept_change_usd`/`_lbp` are the OTHER-currency kept change those
      // sources used to drop entirely (see each block's own comment above).
      // finSvc.kept_change_usd/_lbp (a settled FS commission row's own
      // off-currency stamp) was the last source still missing — see
      // `ProfitSummary.kept_change`'s own doc comment.
      const grossProfitUsd =
        sales.profit_usd +
        finSvc.commission_usd +
        finSvc.commission_at_settlement_usd +
        finSvc.pm_fee_usd +
        finSvc.kept_change_usd +
        recharges.profit_usd +
        recharges.kept_change_usd +
        custom.profit_usd +
        maint.profit_usd +
        exchange.profit_usd +
        mobileSvc.profit_usd +
        mobileSvc.kept_change_usd +
        loto.kept_change_usd +
        debtRepayments.profit_usd +
        discounts.usd +
        supplierCommission.profit_usd +
        topupsBuybacks.profit_usd;
      const grossProfitLbp =
        sales.profit_lbp +
        finSvc.commission_lbp +
        finSvc.commission_at_settlement_lbp +
        finSvc.pm_fee_lbp +
        finSvc.kept_change_lbp +
        recharges.profit_lbp +
        recharges.kept_change_lbp +
        custom.profit_lbp +
        maint.profit_lbp +
        loto.profit_lbp +
        mobileSvc.profit_lbp +
        mobileSvc.kept_change_lbp +
        debtRepayments.profit_lbp +
        discounts.lbp +
        supplierCommission.profit_lbp +
        topupsBuybacks.profit_lbp;

      // LO-V1 / LO-R2 — additive visibility roll-up for the Kept Change card
      // (see ProfitSummary.kept_change's own doc comment); already inside
      // grossProfitUsd/Lbp above, not a second sum.
      const keptChange = {
        usd:
          recharges.kept_change_usd +
          mobileSvc.kept_change_usd +
          loto.kept_change_usd +
          finSvc.kept_change_usd,
        lbp: recharges.kept_change_lbp + mobileSvc.kept_change_lbp + finSvc.kept_change_lbp,
      };

      const netProfitUsd = grossProfitUsd - expenses.total_usd;
      const netProfitLbp = grossProfitLbp - expenses.total_lbp;

      // note #3 (2026-09-24, "no change"/CLOSED) — the combined
      // USD-folded-into-LBP net-profit line is REMOVED; net_profit_usd/
      // net_profit_lbp above stay separate per-currency figures and are
      // never combined into one number. lbp_buy_rate is read ONLY to weight
      // the By Module TOTAL row's mixed-currency margin_pct (LIRA-183,
      // kept) — tenant-scoped LBP buy_rate via RateRepository, NEVER
      // getUsdLbpSellRate (that reads the SELL rate, a different figure).
      // `null` when no LBP rate is configured — never a fabricated
      // fallback (rule 8).
      const lbpBuyRate = this.getLbpBuyRate();

      return {
        period: `${from} to ${to}`,
        sales,
        financial_services: finSvc,
        mobile_services: mobileSvc,
        recharges,
        custom_services: custom,
        maintenance: maint,
        loto,
        exchange,
        debt_repayments: debtRepayments,
        discounts,
        kept_change: keptChange,
        supplier_commission: supplierCommission,
        topups_buybacks: topupsBuybacks,
        expenses,
        totals: {
          gross_revenue_usd: grossRevenueUsd,
          gross_revenue_lbp: grossRevenueLbp,
          total_cost_usd: totalCostUsd,
          total_cost_lbp: totalCostLbp,
          gross_profit_usd: grossProfitUsd,
          gross_profit_lbp: grossProfitLbp,
          net_profit_usd: netProfitUsd,
          net_profit_lbp: netProfitLbp,
          lbp_buy_rate: lbpBuyRate,
        },
        deferred,
      };
    } catch (error) {
      logger.error({ error }, "ProfitService.getSummary error");
      throw error;
    }
  }

  /**
   * Profit breakdown by module/source type.
   */
  getByModule(from: string, to: string): ProfitByModule[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // margin_pct/margin_converted (PA-4.21) are computed once, after every
      // row is assembled — see the map() below — so every push site below
      // stays the raw row shape.
      const results: Omit<ProfitByModule, "margin_pct" | "margin_converted">[] =
        [];

      // Sales
      const salesRevCost = this.repo.getSalesRevCost(fromDt, toDt);
      const salesProfit = this.repo.getSalesProfit(fromDt, toDt);
      if (salesRevCost.count > 0) {
        // PFU-a-3 (verifier round 1) — `getSalesRevCost`'s revenue/cost is
        // the item MARGIN only (PA-4.23, net of discount/refund); it has no
        // term for T3 keep-change, which `SalesRepository.createSale` stamps
        // directly onto the SAME SALE transaction's `profit_usd`/`profit_lbp`
        // (`saleProfitUsd + (sale.kept_change_usd || 0)` / `sale
        // .kept_change_lbp || 0` — see that call site's own comment). There
        // is no persisted `sales.kept_change_usd/_lbp` column to re-query
        // (a migration this lane is not authorized to add), so the kept
        // change is instead DERIVED as the residual between the ledger's
        // own profit (`salesProfit`, which already includes it) and the
        // margin (`salesRevCost`, which never does): by construction,
        // `revenue − cost + keptChange ≡ profit` for every sale, exactly.
        // PFU-a-3-residual (verifier round 2): that identity is only a
        // tautology about the subtraction — it does NOT mean this residual
        // is always genuine T3 kept change (any other SALE-stamp/margin
        // disagreement lands in the same number); see
        // `ProfitByModule.sale_kept_change_usd`'s own doc comment above for
        // why a negative value is rendered downstream as an "unexplained
        // difference" instead. `revenue_lbp`/`cost_lbp` are always 0 for
        // this row (sales are USD-priced — see the field literal below), so
        // `keptChangeLbp` reduces to `salesProfit.profit_lbp` itself (the
        // LBP side of a sale's ledger profit is ENTIRELY kept change; sales
        // carry no LBP margin of their own).
        const keptChangeUsd =
          salesProfit.profit_usd -
          (salesRevCost.revenue_usd - salesRevCost.cost_usd);
        const keptChangeLbp = salesProfit.profit_lbp;
        results.push({
          module: "SALE",
          label: "Product Sales",
          revenue_usd: salesRevCost.revenue_usd,
          revenue_lbp: 0,
          cost_usd: salesRevCost.cost_usd,
          cost_lbp: 0,
          profit_usd: salesProfit.profit_usd,
          // PA-3.1: kept change stamped in LBP — was hard-coded 0.
          profit_lbp: salesProfit.profit_lbp,
          count: salesRevCost.count,
          // PFU-a-3 — set ONLY when non-negligible (matches this file's own
          // 0.005 USD / 1 LBP epsilon convention, e.g. `notDebtPending`) so
          // a sale with no kept change renders the plain equation, exactly
          // as before this fix. `sale_kept_change_*`, NOT the generic
          // `kept_change_*` fields — see ProfitByModule's own doc comment:
          // this value is already INSIDE profit_usd/profit_lbp, unlike
          // every other module's additive off-currency kept change, and
          // reusing that field name double-counted it in the Overview =
          // Σ By Module reconciliation (caught by
          // ProfitRepository.auditBatchLO.test.ts).
          ...(Math.abs(keptChangeUsd) > 0.005
            ? { sale_kept_change_usd: keptChangeUsd }
            : {}),
          ...(Math.abs(keptChangeLbp) > 1
            ? { sale_kept_change_lbp: keptChangeLbp }
            : {}),
        });
      }

      // Financial services by provider — settled only.
      const finRows = this.repo.getFinancialSettledByProvider(fromDt, toDt);
      for (const row of finRows) {
        results.push({
          module: `FINANCIAL_SERVICE_${row.provider}`,
          // PA-4.12: human label for the raw provider code.
          label: humanizeProviderLabel(row.provider),
          revenue_usd: row.revenue_usd,
          revenue_lbp: row.revenue_lbp,
          // PA-2.9: real BILL-flow cost — was hard-coded 0 while revenue =
          // price (row.cost_usd/_lbp now carries fs.cost, see
          // ProfitRepository.getFinancialSettledByProvider's own comment).
          cost_usd: row.cost_usd,
          cost_lbp: row.cost_lbp,
          profit_usd: row.profit_usd,
          profit_lbp: row.profit_lbp,
          // LO-V1/PA-3.1 — off-currency kept change (see
          // ProfitRepository.getFinancialSettledByProvider's own comment).
          kept_change_usd: row.kept_change_usd,
          kept_change_lbp: row.kept_change_lbp,
          count: row.count,
        });
      }

      // Custom services.
      const customRow = this.repo.getCustomServicesTotals(fromDt, toDt);
      if (customRow.count > 0) {
        results.push({
          module: "CUSTOM_SERVICE",
          label: "Custom Services",
          revenue_usd: customRow.revenue_usd,
          revenue_lbp: customRow.revenue_lbp,
          cost_usd: customRow.cost_usd,
          cost_lbp: customRow.cost_lbp,
          profit_usd: customRow.profit_usd,
          profit_lbp: customRow.profit_lbp,
          count: customRow.count,
        });
      }

      // Recharges by carrier.
      const rechargeRows = this.repo.getRechargesByCarrier(fromDt, toDt);
      for (const row of rechargeRows) {
        results.push({
          module: `RECHARGE_${row.carrier}`,
          label: `${row.carrier} Recharges`,
          revenue_usd: row.revenue_usd,
          revenue_lbp: row.revenue_lbp,
          cost_usd: row.cost_usd,
          cost_lbp: row.cost_lbp,
          profit_usd: row.profit_usd,
          profit_lbp: row.profit_lbp,
          // LO-V1/PA-3.1 — off-currency kept change (see
          // ProfitRepository.getRechargesByCarrier's own comment).
          kept_change_usd: row.kept_change_usd,
          kept_change_lbp: row.kept_change_lbp,
          count: row.count,
        });
      }

      // Maintenance. LIRA-176: one Maintenance row, with a labour-vs-parts
      // detail breakdown attached — parts are always USD (owner decision
      // 2026-09-07), so the split only has a USD side. `profit_usd` also
      // carries T3 kept-change; subtracting the parts margin out of it
      // attributes that kept-change gain to labour (documented approximation,
      // not an oversight — see the field doc on ProfitByModule).
      const maintRow = this.repo.getMaintenanceTotals(fromDt, toDt);
      if (maintRow.count > 0) {
        const partsRevenueUsd = maintRow.parts_revenue_usd;
        const partsCostUsd = maintRow.parts_cost_usd;
        const partsProfitUsd = partsRevenueUsd - partsCostUsd;
        const labourProfitUsd = maintRow.profit_usd - partsProfitUsd;
        results.push({
          module: "MAINTENANCE",
          label: "Maintenance",
          revenue_usd: maintRow.revenue_usd,
          revenue_lbp: maintRow.revenue_lbp,
          cost_usd: maintRow.cost_usd,
          cost_lbp: maintRow.cost_lbp,
          profit_usd: maintRow.profit_usd,
          profit_lbp: maintRow.profit_lbp,
          count: maintRow.count,
          parts_revenue_usd: partsRevenueUsd,
          parts_cost_usd: partsCostUsd,
          parts_profit_usd: partsProfitUsd,
          labour_profit_usd: labourProfitUsd,
          labour_profit_lbp: maintRow.profit_lbp,
        });
      }

      // Loto ticket commissions (LBP). Loto is a commission service like
      // OMT/WHISH: revenue = ticket face value, cost = 0, profit = commission.
      // (The ticket face passes through to the loto provider; only the
      // commission is the shop's margin — same convention as the FS rows above.)
      const lotoRow = this.repo.getLotoTotals(fromDt, toDt);
      if (lotoRow.count > 0) {
        results.push({
          module: "LOTO",
          label: "Loto Tickets",
          revenue_usd: 0,
          revenue_lbp: lotoRow.revenue_lbp,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 0,
          profit_lbp: lotoRow.profit_lbp,
          // LO-V1/PA-3.1 — USD-side kept change (see
          // ProfitRepository.getLotoTotals's own comment).
          kept_change_usd: lotoRow.kept_change_usd,
          count: lotoRow.count,
        });
      }

      // Payment-method fees (immediate shop profit on wallet payments).
      const pmFeeRows = this.repo.getPmFeeTotals(fromDt, toDt);
      // LO-V10 (round 2): EXACT currency match — `!== "LBP"` lumped any
      // third currency's fee into pmFeeUsd; now dropped, matching PA-1.4 and
      // the identical getSummary fix above.
      const pmFeeUsd = pmFeeRows
        .filter((r) => r.currency_code === "USD")
        .reduce((s, r) => s + r.total, 0);
      const pmFeeLbp = pmFeeRows
        .filter((r) => r.currency_code === "LBP")
        .reduce((s, r) => s + r.total, 0);
      const pmFeeCount = pmFeeRows
        .filter((r) => r.currency_code === "USD" || r.currency_code === "LBP")
        .reduce((s, r) => s + r.count, 0);
      if (pmFeeCount > 0 && (pmFeeUsd !== 0 || pmFeeLbp !== 0)) {
        results.push({
          module: "PM_FEE",
          label: "Payment Method Fees",
          revenue_usd: pmFeeUsd,
          revenue_lbp: pmFeeLbp,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: pmFeeUsd,
          profit_lbp: pmFeeLbp,
          count: pmFeeCount,
        });
      }

      // Exchange (v30+: sum leg profits)
      const exchangeRow = this.repo.getExchangeTotals(fromDt, toDt);
      if (exchangeRow.count > 0) {
        results.push({
          module: "EXCHANGE",
          label: "Currency Exchange",
          revenue_usd: exchangeRow.revenue_usd, // USD equivalent of all exchanges
          revenue_lbp: 0,
          cost_usd: exchangeRow.revenue_usd - exchangeRow.profit_usd, // Revenue - Profit = Cost
          cost_lbp: 0,
          profit_usd: exchangeRow.profit_usd,
          profit_lbp: 0,
          count: exchangeRow.count,
        });
      }

      // PA-2.1 — three sources getSummary already counts in gross profit but
      // getByModule never surfaced as their own rows. Profit-only (no
      // separate revenue/cost pair — see each source's own doc comment on
      // ProfitSummary).
      // LO-V12 (round 2 adversarial review): revenue is 0, NOT equal to
      // profit — a profit-only row (no real "sale" behind it: kept change,
      // a discount, a settlement commission, a top-up/buyback) has no
      // revenue figure to report. Setting revenue = profit made a By Module
      // TOTAL footer double-count these rows as both revenue AND profit
      // (so Σrevenue included profit-only amounts a second time) and made
      // computeMargin report a nonsensical 100% margin on every one of
      // them (a forgiven, NEGATIVE discount would show -100%). With
      // revenue = 0, computeMargin's `revenue !== 0 ? ... : null` correctly
      // reports `margin_pct: null` ("N/A") for these rows instead. Read
      // `profit_usd`/`profit_lbp` for the row's dollar amount, never
      // `revenue_usd`/`revenue_lbp` (now always 0 here).
      const keptChange = this.repo.getDebtRepaymentProfit(fromDt, toDt);
      if (keptChange.profit_usd !== 0 || keptChange.profit_lbp !== 0) {
        results.push({
          module: "KEPT_CHANGE",
          label: "Kept Change",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: keptChange.profit_usd,
          profit_lbp: keptChange.profit_lbp,
          count: keptChange.count,
        });
      }

      const discountTotals = this.repo.getCounterpartyDiscountTotals(
        fromDt,
        toDt,
      );
      if (discountTotals.profit_usd !== 0 || discountTotals.profit_lbp !== 0) {
        results.push({
          module: "COUNTERPARTY_DISCOUNT",
          label: "Discounts",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: discountTotals.profit_usd,
          profit_lbp: discountTotals.profit_lbp,
          count: discountTotals.count,
        });
      }

      // Bills-only ONLY (the cashless share is already counted under the FS
      // provider rows above via getFinancialSettledByProvider's allocation
      // arm — adding the combined figure here would double it, per the
      // owner's own instruction: "cashless is already under the provider
      // rows — do not count it twice").
      const supplierCommissionTotals = this.repo.getSupplierCommissionTotals(
        fromDt,
        toDt,
      );
      if (
        supplierCommissionTotals.bills_only_profit_usd !== 0 ||
        supplierCommissionTotals.bills_only_profit_lbp !== 0
      ) {
        results.push({
          module: "SUPPLIER_COMMISSION",
          label: "Supplier Commission (Bills)",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: supplierCommissionTotals.bills_only_profit_usd,
          profit_lbp: supplierCommissionTotals.bills_only_profit_lbp,
          count: supplierCommissionTotals.bills_only_count,
        });
      }

      // PA-2.3 — TELECOM_CREDIT_BUYBACK + RECHARGE_TOPUP profit.
      const topupsBuyback = this.repo.getTopupBuybackProfit(fromDt, toDt);
      if (topupsBuyback.profit_usd !== 0 || topupsBuyback.profit_lbp !== 0) {
        results.push({
          module: "TOPUP_BUYBACK",
          label: "Top-ups / Buybacks",
          revenue_usd: 0,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: topupsBuyback.profit_usd,
          profit_lbp: topupsBuyback.profit_lbp,
          count: topupsBuyback.count,
        });
      }

      // PA-4.21: margin_pct/margin_converted, computed once per row here
      // (not at every push site above — rule 14).
      const buyRate = this.getLbpBuyRate();
      const withMargins: ProfitByModule[] = results.map((row) => ({
        ...row,
        ...computeMargin(row, buyRate),
      }));

      // PA-4.12: sort by USD-EQUIVALENT profit at the LBP buy rate — the old
      // `profit_usd`-only sort always sank an LBP-only module (loto, an
      // LBP-only recharge/custom-service row) to the bottom regardless of
      // its real value. Degrades to the old USD-only sort when no LBP rate
      // is configured (usdEquivalentForSort's own fallback).
      return withMargins.sort(
        (a, b) =>
          usdEquivalentForSort(b, buyRate) - usdEquivalentForSort(a, buyRate),
      );
    } catch (error) {
      // PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6): see getByPaymentMethod's
      // own comment for the full rationale — a caught-and-swallowed `[]`
      // here was indistinguishable from a real day with no module activity.
      logger.error({ error }, "ProfitService.getByModule error");
      throw error;
    }
  }

  /**
   * PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the
   * Profits page's "Show transactions" drill-down under a By Module row.
   * SALE and RECHARGE_<carrier> only (slice 2); every other module key
   * throws a clear "not built yet" error — slice 3 is a later ticket, and a
   * silent empty list here would read as "this module truly has no
   * transactions" instead of "the drill-down for this module doesn't exist
   * yet" (same "don't swallow a real gap into an empty-looking state"
   * discipline as PA-4.16 elsewhere in this file).
   *
   * Assembly only (rule 13) — every predicate/weight comes from the
   * repository (rule 14, shared with the By Module totals query); this
   * method only splits counted (weight > 0) from not-yet-counted (weight =
   * 0), states WHY a not-yet-counted row is excluded, and sums the counted
   * side. `counted_total_profit_usd`/`_lbp` reproduces the By Module row's
   * own `profit_usd`/`profit_lbp` EXACTLY — proven by
   * `ProfitRepository.moduleDetailReconciliation.test.ts` (rule 17).
   */
  getModuleDetail(
    moduleKey: string,
    from: string,
    to: string,
  ): ProfitModuleDetail {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      if (moduleKey === "SALE") {
        return this.buildSaleModuleDetail(fromDt, toDt);
      }
      if (moduleKey.startsWith("RECHARGE_")) {
        const carrier = moduleKey.slice("RECHARGE_".length);
        return this.buildRechargeModuleDetail(carrier, fromDt, toDt);
      }
      throw new Error(
        `No transaction-level detail is available for "${moduleKey}" yet (slice 3, a later ticket).`,
      );
    } catch (error) {
      logger.error(
        { error, moduleKey },
        "ProfitService.getModuleDetail error",
      );
      throw error;
    }
  }

  private buildSaleModuleDetail(
    fromDt: string,
    toDt: string,
  ): ProfitModuleDetail {
    const rows = this.repo.getSalesDetail(fromDt, toDt);
    const counted: ProfitModuleDetailRow[] = [];
    const notCounted: ProfitModuleDetailRow[] = [];
    let countedProfitUsd = 0;
    let countedProfitLbp = 0;

    for (const r of rows) {
      // Epsilon matches this file's own 0.005 USD convention (notDebtPending
      // et al.) — a weight this close to 0/1 is "fully" that side, not a
      // genuine sliver of partial recognition. Used ONLY to word the reason
      // text below — see the counted/not-counted split just below for why
      // the split itself uses a plain `weight > 0` instead (PROF-DD-FIX,
      // review round, m5).
      const weight = r.weight;
      const isFull = weight >= 0.9995;
      const isNone = weight <= 0.0005;
      const countedProfitUsdRow = r.profit_usd * weight;
      const countedProfitLbpRow = r.profit_lbp * weight;
      const counterpart = r.client_name || r.client_phone || "Walk-in";
      // PROF-DD-FIX (review round, M4) — was `paid $${r.paid_usd} of
      // $${r.total_amount_usd}`: pre-discount total and USD-only paid, while
      // the weight/recognition gate itself ({@link saleFullyPaid}) compares
      // `final_amount_usd` (post-discount) against paid_usd + paid_lbp
      // converted at the sale's snapshot rate. A sale discounted to $90 and
      // paid entirely in LBP used to read "paid $0.00 of $100.00" — now
      // reads the SAME two figures the gate itself used to decide "not full".
      const reason = isFull
        ? null
        : r.has_partner_obligation
          ? isNone
            ? "Partner has not settled this sale yet."
            : `Partner has settled ${Math.round(r.partner_coverage_ratio * 100)}% of this sale so far.`
          : `Customer still owes — paid $${r.paid_total_usd.toFixed(2)} of $${r.final_amount_usd.toFixed(2)}.`;

      const row: ProfitModuleDetailRow = {
        id: r.sale_id,
        date: r.created_at,
        counterpart,
        detail: r.items_summary,
        amount_usd: r.revenue_usd,
        amount_lbp: 0,
        cost_usd: r.cost_usd,
        cost_lbp: 0,
        profit_usd: r.profit_usd,
        profit_lbp: r.profit_lbp,
        counted_pct: Math.round(weight * 1000) / 10,
        counted_profit_usd: countedProfitUsdRow,
        counted_profit_lbp: countedProfitLbpRow,
        reason,
        fee_note: null,
      };

      // PROF-DD-FIX (review round, m5) — split on the SAME `weight > 0`
      // predicate `getSalesRevCost`'s own `COUNT(DISTINCT CASE WHEN weight >
      // 0 ...)` uses, not the epsilon above. A sliver weight (e.g. 0.0003)
      // still contributes `profit_usd * weight` to the By Module row's own
      // total (it is not gated out there), so classifying it as
      // not-counted here — and leaving it out of `countedProfitUsd` —
      // silently broke "counted rows sum exactly to the module row" by that
      // sliver. The epsilon stays reserved for reason WORDING only.
      if (weight > 0) {
        counted.push(row);
        countedProfitUsd += countedProfitUsdRow;
        countedProfitLbp += countedProfitLbpRow;
      } else {
        notCounted.push(row);
      }
    }

    return {
      module: "SALE",
      counted,
      not_counted: notCounted,
      counted_total_profit_usd: countedProfitUsd,
      counted_total_profit_lbp: countedProfitLbp,
    };
  }

  private buildRechargeModuleDetail(
    carrier: string,
    fromDt: string,
    toDt: string,
  ): ProfitModuleDetail {
    const rows = this.repo.getRechargeDetail(carrier, fromDt, toDt);
    const counted: ProfitModuleDetailRow[] = [];
    const notCounted: ProfitModuleDetailRow[] = [];
    let countedProfitUsd = 0;
    let countedProfitLbp = 0;

    for (const r of rows) {
      // getRechargesByCarrier (the totals query) hard-excludes a
      // debt-pending row via notDebtPending in its WHERE — not a weight —
      // so a debt-pending row's weight here is 0 regardless of any partner
      // coverage; partner coverage only prorates a NON-debt-pending row
      // (rule 14 — same two gates the totals query applies).
      const weight = r.debt_pending ? 0 : r.partner_coverage_ratio;
      const isFull = weight >= 0.9995;
      const isNone = weight <= 0.0005;
      const isUsd = r.currency_code === "USD";
      const rowProfitUsd = isUsd ? r.profit_usd : 0;
      const rowProfitLbp = isUsd ? 0 : r.profit_lbp;
      const countedProfitUsdRow = rowProfitUsd * weight;
      const countedProfitLbpRow = rowProfitLbp * weight;
      const reason = isFull
        ? null
        : r.debt_pending
          ? "Customer still owes — Recharge Debt not yet repaid."
          : r.has_partner_obligation
            ? isNone
              ? "Partner has not settled this recharge yet."
              : `Partner has settled ${Math.round(r.partner_coverage_ratio * 100)}% of this recharge so far.`
            : null;
      // PROF-DD-FIX (review round, m2) — was a bare `.toLocaleString()` on
      // the request path (rule 27: locale-dependent digit grouping differs
      // between the owner's desktop and the web backend's container, and it
      // duplicated the shared money-formatting convention — rule 14). Uses
      // the SAME zero-import `formatMoneyAmount` helper every money
      // repository already uses for a stored note string, and now shows
      // BOTH currencies (joined with " + ") when a fee posts a split
      // USD+LBP amount instead of silently dropping the LBP half.
      const feeParts: string[] = [];
      if (r.fee_expense_usd !== 0) {
        feeParts.push(
          `-${formatMoneyAmount(Math.abs(r.fee_expense_usd), "USD")}`,
        );
      }
      if (r.fee_expense_lbp !== 0) {
        feeParts.push(
          `-${formatMoneyAmount(Math.abs(r.fee_expense_lbp), "LBP")}`,
        );
      }
      const feeNote =
        feeParts.length > 0
          ? `${r.fee_expense_description ?? "Fee"}: ${feeParts.join(" + ")} (booked in expenses)`
          : null;

      const row: ProfitModuleDetailRow = {
        id: r.recharge_id,
        date: r.created_at,
        counterpart: r.client_name || r.phone_number || "Walk-in",
        detail: `${r.amount} credit`,
        amount_usd: isUsd ? r.price : 0,
        amount_lbp: isUsd ? 0 : r.price,
        cost_usd: isUsd ? r.cost : 0,
        cost_lbp: isUsd ? 0 : r.cost,
        profit_usd: rowProfitUsd,
        profit_lbp: rowProfitLbp,
        counted_pct: Math.round(weight * 1000) / 10,
        counted_profit_usd: countedProfitUsdRow,
        counted_profit_lbp: countedProfitLbpRow,
        reason,
        fee_note: feeNote,
      };

      // PROF-DD-FIX (review round, m5) — same `weight > 0` split as
      // buildSaleModuleDetail above; see that method's own comment.
      if (weight > 0) {
        counted.push(row);
        countedProfitUsd += countedProfitUsdRow;
        countedProfitLbp += countedProfitLbpRow;
      } else {
        notCounted.push(row);
      }
    }

    return {
      module: `RECHARGE_${carrier}`,
      counted,
      not_counted: notCounted,
      counted_total_profit_usd: countedProfitUsd,
      counted_total_profit_lbp: countedProfitLbp,
    };
  }

  /**
   * Daily profit breakdown for a date range (for charts).
   */
  getByDate(from: string, to: string): ProfitByDate[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.repo.getByDate(from, to, fromDt, toDt);
    } catch (error) {
      // PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6) — see getByPaymentMethod's
      // own comment for the full rationale: a swallowed `[]` here read as a
      // real, flat day-by-day chart with no data, not a query failure.
      logger.error({ error }, "ProfitService.getByDate error");
      throw error;
    }
  }

  /**
   * Profit breakdown by payment method.
   *
   * Shows only real customer-facing payment methods (CASH, CARD, etc.).
   * Excludes internal system flows: OMT, WHISH, RESERVE, COMMISSION drawer entries.
   *
   * Financial service commissions are shown as a separate "Commission" row:
   *   - Realized commission (is_settled = 1 AND not partner-pending AND not
   *     debt-pending — LIRA-108, same gates as the Summary per-currency view)
   *     → shown as positive profit
   *   - Pending commission (is_settled = 0, pre-recognition — no counterparty
   *     gates by design) → shown separately with status. A settled but
   *     partner-/debt-pending commission appears in NEITHER row here; it
   *     surfaces in the deferred-profit bucket until settlement/repayment.
   *     LIRA-158 D15: a commission_model = 1 row's pending commission is
   *     unknowable until settlement, so it contributes to
   *     `awaiting_settlement_count` (a COUNT) instead of
   *     `pending_commission_usd`/`_lbp` (a dollar figure, legacy model-0
   *     rows only).
   */
  getByPaymentMethod(from: string, to: string): ProfitByPaymentMethod[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      const paymentRows = this.repo.getPaymentMethodRows(fromDt, toDt);
      // LPAY-R3-3: strictUsdBucketing = true — this tab's dollar columns
      // follow PA-1.4's `= 'USD'` convention (same as getPaymentMethodRows's
      // own payment-leg rows above), never the shared methods' default
      // `!= 'LBP'` lumping other callers (getMonthlyPL, lane LO) still rely
      // on unchanged.
      const realizedCommission = this.repo.getRealizedCommissionTotals(
        fromDt,
        toDt,
        true,
      );
      const pendingCommission = this.repo.getPendingCommissionTotals(
        fromDt,
        toDt,
        true,
      );

      const results: ProfitByPaymentMethod[] = [...paymentRows];

      if (realizedCommission.count > 0) {
        results.push({
          method: "Commission (Settled)",
          total_usd: realizedCommission.total_usd,
          total_lbp: realizedCommission.total_lbp,
          count: realizedCommission.count,
          pending_commission_usd: 0,
          is_settled: 1,
        });
      }

      if (
        pendingCommission.count > 0 ||
        pendingCommission.awaiting_settlement_count > 0
      ) {
        // Build per-provider pending commission details for the label.
        // D15: a commission_model=1 provider has no dollar figure to show
        // (total_usd is 0 for it), only a count of transactions awaiting
        // settlement — surface that instead of a misleading "$0.00".
        const pendingByProvider = this.repo.getPendingCommissionByProvider(
          fromDt,
          toDt,
          true, // LPAY-R3-3 — see the realized/pending totals call above.
        );

        const providerLabel = pendingByProvider
          .map((p) => {
            const parts: string[] = [];
            if (p.total_usd > 0) parts.push(`$${p.total_usd.toFixed(2)}`);
            // LPAY-V7: an LBP-only legacy provider has total_usd === 0 but a
            // genuine total_lbp > 0 — show it instead of falling through to
            // the misleading "$0.00" default below.
            if (p.total_lbp > 0) {
              parts.push(`${Math.round(p.total_lbp).toLocaleString()} LBP`);
            }
            if (p.awaiting_settlement_count > 0) {
              parts.push(`${p.awaiting_settlement_count} awaiting settlement`);
            }
            return `${p.provider} ${parts.length > 0 ? parts.join(", ") : "$0.00"}`;
          })
          .join(", ");

        results.push({
          method: `Commission Pending Settlement (${providerLabel || "OMT/WHISH"})`,
          total_usd: 0, // not yet in hand — shown as pending
          total_lbp: 0,
          count: pendingCommission.count,
          pending_commission_usd: pendingCommission.total_usd,
          // Bug fix: this used to be hardcoded 0, so pending LBP commission
          // never reached the UI at all.
          pending_commission_lbp: pendingCommission.total_lbp,
          awaiting_settlement_count:
            pendingCommission.awaiting_settlement_count,
          is_settled: 0,
        });
      }

      // LPAY-R3-6: sort by USD, THEN LBP as a tiebreaker (was USD-only,
      // which sank an LBP-only tender behind every zero-USD tie in
      // insertion order rather than by its own size).
      return results.sort(
        (a, b) => b.total_usd - a.total_usd || b.total_lbp - a.total_lbp,
      );
    } catch (error) {
      // PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6): a caught-and-swallowed `[]`
      // here is indistinguishable from a real day with no payments — the
      // Profits page rendered "No payment data for this period" for a
      // genuine query failure. Log for observability, then RETHROW: the IPC
      // handler (`electron-app/handlers/profitHandlers.ts`, no try/catch of
      // its own) turns this into a rejected invoke promise, and the REST
      // route (`backend/src/api/profits.ts`) turns it into its existing
      // `{ success: false, error }` 500 response — both already-correct
      // outer layers just had nothing to catch before. The page's own loader
      // (`loadByPayment`) is the one place that now must stop swallowing it
      // too (see its own comment).
      logger.error({ error }, "ProfitService.getByPaymentMethod error");
      throw error;
    }
  }

  /**
   * Profit breakdown by user/cashier.
   */
  getByUser(from: string, to: string): ProfitByUser[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.repo.getByUser(fromDt, toDt);
    } catch (error) {
      // PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6): a query failure used to be
      // swallowed into an empty array, rendering the SAME "No data for this
      // period" empty state as a genuine no-activity day — a broken query
      // read as silence. Rethrow so the outer IPC handler / REST route (both
      // already correct) and the page's own loader can surface a visible
      // error instead — see getByPaymentMethod's identical fix, own
      // loader/tab only.
      logger.error({ error }, "ProfitService.getByUser error");
      throw error;
    }
  }

  /**
   * Top clients by profit generated.
   */
  getByClient(from: string, to: string, limit = 20): ProfitByClient[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.repo.getByClient(fromDt, toDt, limit);
    } catch (error) {
      // PA-4.16: see getByUser's identical fix above.
      logger.error({ error }, "ProfitService.getByClient error");
      throw error;
    }
  }

  /**
   * Pending profit from sales with outstanding debt.
   * These are completed sales where the customer hasn't fully paid yet.
   * Profit is deferred until the sale is fully paid.
   *
   * PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6): no swallow-to-empty catch. A
   * DB error used to come back as a normal-shaped, all-zero success payload
   * — indistinguishable on screen from "no pending profit this period". It
   * is now logged (unchanged diagnostic value) and RETHROWN, so the caller
   * (the IPC handler / REST route) sees a real failure and the Pending tab
   * can show a visible error state instead of a fabricated "no data".
   *
   * PA-3.7: `unsettled_totals.awaiting_settlement_count` and `deferred` are
   * additive visibility only — see {@link ProfitRepository.getUnsettledCommissions}
   * and {@link ProfitRepository.getDeferredProfit}'s own doc comments. Neither
   * is netted into `totals`/`unsettled_totals`'s dollar fields above; this
   * whole method remains report-time-only (no posting, no stored figure
   * changes — money invariant for this ticket).
   *
   * LP-3 (round 2): `awaiting_settlement_count` is now read straight from
   * {@link ProfitRepository.getPendingCommissionTotals} (owned by lane LO,
   * read-only here) instead of a second hand-rebuilt count
   * `getUnsettledCommissions` used to compute internally — ONE query answers
   * "how many model-1 rows are awaiting settlement" for both this tab and the
   * Overview (rule 14).
   *
   * LP-5 (round 2): `total_pending_commission_usd` used to bucket on
   * `currency !== "LBP"`, silently adding a third currency (e.g. a Binance
   * USDT financial-service row) into the USD figure — the exact PA-1.4 bug
   * class. Now an EXACT `currency === "USD"` match, matching the sanctioned
   * fix already applied to this same bug class elsewhere in this file (see
   * `getSummary`'s `finSvc` loop) — a non-USD/non-LBP row now contributes to
   * NEITHER bucket instead of being silently misattributed to USD.
   */
  getPendingProfit(
    from: string,
    to: string,
  ): {
    rows: PendingProfitRow[];
    totals: {
      total_outstanding_usd: number;
      total_pending_profit_usd: number;
      count: number;
    };
    unsettled_commissions: UnsettledCommissionRow[];
    unsettled_totals: {
      total_pending_commission_usd: number;
      total_pending_commission_lbp: number;
      count: number;
      /** PA-3.7: count of commission_model = 1 financial-service rows
       *  awaiting supplier settlement in this window — a COUNT only, never a
       *  dollar figure (their real commission is unknowable until
       *  settlement). See ProfitRepository.getUnsettledCommissions's own
       *  doc comment. */
      awaiting_settlement_count: number;
    };
    /** PA-3.7: profit already stamped but currently stranded behind an
     *  uncovered partner settlement or client-debt repayment — including
     *  post-cutover cashless (OMT/WHISH) settlement commission, which the
     *  `rows`/`unsettled_commissions` figures above cannot see at all
     *  (sales-only and legacy-commission-only respectively). Sourced
     *  unmodified from ProfitRepository.getDeferredProfit (owned by lane
     *  LO — read here, never edited). Additive visibility only, matching
     *  ProfitSummary.deferred's own contract: NOT netted into any total
     *  above. */
    deferred: DeferredProfitRow;
  } {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // Pending sales profit (debt not yet paid). PA-3.8: date-independent
      // by design — "Pending means as of now" — see the repository method's
      // own doc comment.
      const rows = this.repo.getPendingSaleProfit();

      const totals = {
        total_outstanding_usd: rows.reduce(
          (sum, r) => sum + r.outstanding_usd,
          0,
        ),
        total_pending_profit_usd: rows.reduce(
          (sum, r) => sum + r.potential_profit_usd,
          0,
        ),
        count: rows.length,
      };

      // Unsettled financial service commissions (RECEIVE rows not yet settled with supplier)
      const unsettled_commissions = this.repo.getUnsettledCommissions(
        fromDt,
        toDt,
      );

      // LP-3: single source for "how many model-1 rows are awaiting
      // settlement" — see this method's own doc comment. Read-only call;
      // getPendingCommissionTotals is owned by lane LO.
      const pendingCommissionTotals = this.repo.getPendingCommissionTotals(
        fromDt,
        toDt,
      );

      const unsettled_totals = {
        // LP-5: EXACT currency match (was `!== "LBP"`, silently lumping a
        // third currency into USD — see this method's own doc comment).
        total_pending_commission_usd: unsettled_commissions
          .filter((r) => r.currency === "USD")
          .reduce((s, r) => s + r.commission, 0),
        total_pending_commission_lbp: unsettled_commissions
          .filter((r) => r.currency === "LBP")
          .reduce((s, r) => s + r.commission, 0),
        count: unsettled_commissions.length,
        awaiting_settlement_count:
          pendingCommissionTotals.awaiting_settlement_count,
      };

      // PA-3.7: post-cutover partner-pending / debt-pending profit
      // (including cashless settlement commission) the two figures above
      // cannot see. Read-only call — getDeferredProfit is owned by lane LO.
      const deferred = this.repo.getDeferredProfit(fromDt, toDt);

      return {
        rows,
        totals,
        unsettled_commissions,
        unsettled_totals,
        deferred,
      };
    } catch (error) {
      logger.error({ error }, "ProfitService.getPendingProfit error");
      throw error;
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let profitServiceInstance: ProfitService | null = null;

export function getProfitService(): ProfitService {
  if (!profitServiceInstance) {
    profitServiceInstance = new ProfitService();
  }
  return profitServiceInstance;
}

export function resetProfitService(): void {
  profitServiceInstance = null;
}
