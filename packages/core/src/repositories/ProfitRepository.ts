/**
 * Profit Repository
 *
 * Cross-entity reporting repository for the Profits page. Owns EVERY SQL query
 * that feeds `ProfitService` (sales, financial services, mobile services,
 * recharges, custom services, maintenance, exchange, expenses, payments). The
 * service keeps only assembly, per-currency aggregation, currency-splitting and
 * business decisions — it never touches the database.
 *
 * Rule 14 — domain predicates are defined ONCE here and reused across queries:
 *   - SALE_FULLY_PAID            sale is fully paid (USD-equivalent within $0.05)
 *   - SALE_NOT_FULLY_PAID        sale still owes money (the negation, for pending)
 *   - FS_SETTLED / FS_PENDING    financial service settled-vs-pending gate
 *   - DATE_RANGE(col)            inclusive [from, to] date-range bound on a column
 *   - usdBucket / lbpBucket      USD-vs-LBP currency bucketing CASE fragments
 *   - EXCHANGE_LEG_PROFIT        leg1 + leg2 exchange profit (v30+) sum
 *   - FS_REVENUE                 financial-service revenue (price when cost>0 else amount)
 *   - EMBEDDED_COMMISSION(alias) `fs.commission` column is settled truth only for
 *                                a legacy (commission_model = 0) row — LIRA-158 Phase 2a
 *   - allocationNotDebtPending   a CASHLESS settlement's commission defers until the
 *                                CLIENT repays the underlying transfer — LIRA-158 D17
 *   - cashlessCommissionBatch    re-derives isBillsOnlyBatch's negation in SQL from
 *                                settlement_commission_allocations — LIRA-158 D17
 */

import type Database from "better-sqlite3";
import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  INTERNAL_LEG_METHODS,
  PROVIDER_STOCK_DRAWERS,
  sessionBasketNotReversedSql,
} from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { COMMISSION_PROVIDERS_SQL_LIST } from "../constants/commissionProviders.js";
import { MOBILE_SERVICE_PROVIDERS_SQL_LIST } from "../constants/mobileServiceProviders.js";

// =============================================================================
// Row types (raw rows returned to the service for assembly)
// =============================================================================

export interface SalesRevCostRow {
  revenue_usd: number;
  cost_usd: number;
  count: number;
}

export interface SalesProfitRow {
  profit_usd: number;
  /**
   * PA-3.1 (OWNER_NOTES_2026-09-21.md §6.5) — a sale's kept change stamped in
   * LBP (`transactions.profit_lbp = kept_change_lbp`, SalesRepository.ts
   * ~:817) was dropped from every profits view: this method used to select
   * only `profit_usd`. A USD sale with LBP kept change is the ONLY source of
   * this field — sales carry no other LBP profit component.
   */
  profit_lbp: number;
}

export interface FinCurrencyRow {
  currency: string;
  revenue: number;
  commission: number;
  count: number;
  /**
   * LO-R2 (round 3 adversarial review, OWNER_NOTES_2026-09-21.md §6, closing
   * PA-3.1 for this arm) — this row's OTHER-currency kept change (see
   * {@link otherCurrencyKeptChangeUsd}/{@link otherCurrencyKeptChangeLbp}'s
   * own doc comment). Grouped by `fs.currency` like the rest of this row, so
   * exactly ONE of the two is ever non-zero per row: a `currency: 'LBP'` row
   * carries `kept_change_usd` (its USD-side kept change), a `currency: 'USD'`
   * row carries `kept_change_lbp` — the mirror image of `revenue`/
   * `commission` above, not a repeat of them. Before this field, a model-1
   * OMT/WHISH row's off-currency kept change (exactly what a D1 Whish
   * RECEIVE-fee stamp is) never reached the Overview at all, though By
   * Module (`FinByProviderRow.kept_change_usd/_lbp`) and By Date
   * (`daily_commissions`) already carried it — the tabs disagreed in the
   * (post-cutover) common case. Additive — NOT folded into `commission`
   * above, matching every other kept-change field in this file.
   *
   * Optional, NOT a fabricated 0 (same convention as
   * `ProfitByModule.kept_change_usd`'s own doc comment): only
   * `getFinancialSettledByCurrency` selects these columns (always via
   * `COALESCE(..., 0)`, so THAT arm's rows never actually have them
   * `undefined`). `getFinancialPendingByCurrency` shares this same return
   * type but does not select them — a legacy-only, pre-recognition bucket
   * (PA-0.1) has no settled kept-change figure to report — so its rows
   * genuinely omit the keys rather than lying with a stamped 0.
   */
  kept_change_usd?: number;
  kept_change_lbp?: number;
}

/**
 * Owner decision (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md §6.9,
 * L0-4). One row per currency: the FS commission that IS recognised
 * ({@link fsStampRecognized}) but is currently excluded from
 * {@link ProfitRepository.getFinancialSettledByCurrency}'s gross figure only
 * because the underlying transfer is still CUSTOMER_ACCOUNT-debt-pending
 * ({@link notDebtPending}, inverted). No `revenue` field — the Financial
 * Services card's "waiting for repayment" line is a commission-only figure
 * (owner: "kept out of profit until repaid"), never added to gross/net.
 */
export interface FsWaitingForRepaymentRow {
  currency: string;
  commission: number;
  count: number;
}

export interface MobileCurrencyRow {
  currency: string;
  revenue: number;
  cost: number;
  profit: number;
  /**
   * PA-3.1/LO-V1 (round 2, OWNER_NOTES_2026-09-21.md §6) — kept change
   * stamped in the OTHER currency on this row's own transaction (e.g. an
   * LBP iPick/Katsh row paid with cash that needed USD change back —
   * `FinancialServiceRepository.ts` ~:2158 stamps that on the SAME
   * transaction's `profit_usd`/`profit_lbp` column the OWN margin doesn't
   * use). Additive: NOT already folded into `profit` above (see
   * {@link otherCurrencyKeptChangeUsd}/{@link otherCurrencyKeptChangeLbp}'s
   * own doc comment for the full rationale).
   */
  kept_change: number;
  count: number;
}

export interface RechargeCurrencyRow {
  currency_code: string;
  revenue: number;
  cost: number;
  profit: number;
  /** @see MobileCurrencyRow.kept_change — same convention, RechargeRepository.ts ~:780. */
  kept_change: number;
  count: number;
}

export interface CustomTotalsRow {
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  count: number;
}

export interface MaintTotalsRow {
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  count: number;
  parts_revenue_usd: number;
  parts_cost_usd: number;
}

export interface LotoTotalsRow {
  revenue_lbp: number;
  profit_lbp: number;
  /**
   * PA-3.1/LO-V1 (round 2) — USD-side kept change on an otherwise
   * LBP-native loto ticket (`LotoTicketRepository.ts` ~:190). Loto carries
   * no USD margin of its own — this is the ONLY USD figure a loto row can
   * ever report.
   */
  kept_change_usd: number;
  count: number;
}

export interface PmFeeCurrencyRow {
  currency_code: string;
  total: number;
  count: number;
}

export interface ExchangeTotalsRow {
  revenue_usd: number;
  profit_usd: number;
  count: number;
}

export interface ExpenseTotalsRow {
  total_usd: number;
  total_lbp: number;
  count: number;
}

export interface FinByProviderRow {
  provider: string;
  revenue_usd: number;
  revenue_lbp: number;
  /**
   * PA-2.9 (OWNER_NOTES_2026-09-21.md §6.4) — a BILL-flow row's real cost
   * (`financial_services.cost`; 0 for a plain SEND/RECEIVE), so By Module can
   * show Revenue − Cost = Profit for an FS-provider row instead of hard-coding
   * cost 0 while revenue = price.
   */
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  /** @see MobileCurrencyRow.kept_change — same convention, split by which
   *  side is the "other" currency since this row mixes both. */
  kept_change_usd: number;
  kept_change_lbp: number;
  count: number;
}

export interface RechargeByCarrierRow {
  carrier: string;
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  /** @see FinByProviderRow.kept_change_usd */
  kept_change_usd: number;
  kept_change_lbp: number;
  count: number;
}

/**
 * PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — one row
 * of the Profits page's "Show transactions" drill-down under the SALE By
 * Module row. Same revenue/cost shape as {@link SalesRevCostRow} but
 * per-sale instead of summed, plus the raw recognition inputs
 * ({@link saleRecognitionWeight}'s own branches) so the SERVICE (rule 13 —
 * this repository never renders text) can classify each row as counted /
 * not-yet-counted and state why. `revenue_usd`/`cost_usd` are this sale's
 * OWN net-of-discount/refund margin (unweighted); `weight` is
 * {@link saleRecognitionWeight}'s [0,1] fraction — multiplying the two gives
 * this row's counted contribution, and summing that product over every row
 * {@link ProfitRepository.getSalesDetail} returns reproduces
 * {@link SalesRevCostRow}'s own `revenue_usd`/`cost_usd` EXACTLY, because
 * both queries share the identical `sale_agg` body (rule 14,
 * {@link saleAggBody}).
 */
export interface SaleDetailRow {
  sale_id: number;
  created_at: string;
  client_name: string | null;
  client_phone: string | null;
  items_summary: string | null;
  revenue_usd: number;
  cost_usd: number;
  weight: number;
  fully_paid: 0 | 1;
  has_partner_obligation: 0 | 1;
  partner_coverage_ratio: number;
  /** Stamped ledger profit (unweighted) — {@link SalesProfitRow}'s per-sale
   *  source, from this sale's own SALE transaction row. */
  profit_usd: number;
  profit_lbp: number;
  total_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
  /** PROF-DD-FIX (review round) — `sales.final_amount_usd` (post-discount)
   *  and the SAME "paid, USD + LBP-at-snapshot-rate" figure
   *  {@link saleFullyPaid} gates on ({@link saleTotalPaidUsdEquiv}). The
   *  service's "Customer still owes" reason is built from these two, never
   *  from `total_amount_usd`/`paid_usd` above (pre-discount / USD-only —
   *  kept for back-compat, not for this text). */
  final_amount_usd: number;
  paid_total_usd: number;
}

/**
 * PROF-DD — per-recharge row for the drill-down under a RECHARGE_<carrier>
 * By Module row. `debt_pending` mirrors {@link notDebtPending}'s own gate —
 * {@link ProfitRepository.getRechargesByCarrier} applies it as a hard WHERE
 * filter (not a weight), so a debt-pending row's counted contribution is
 * always 0 regardless of `partner_coverage_ratio`; `has_partner_obligation` /
 * `partner_coverage_ratio` mirror {@link partnerCoverageRatio}'s own per-row
 * weight. Summing each row's counted contribution (the service derives it as
 * `debt_pending ? 0 : value * partner_coverage_ratio`) reproduces
 * {@link RechargeByCarrierRow}'s own totals EXACTLY (rule 14 — same
 * WHERE/weight fragments as the totals query).
 */
export interface RechargeDetailRow {
  recharge_id: number;
  created_at: string;
  phone_number: string | null;
  client_name: string | null;
  currency_code: string;
  amount: number;
  price: number;
  cost: number;
  profit_usd: number;
  profit_lbp: number;
  has_partner_obligation: 0 | 1;
  partner_coverage_ratio: number;
  debt_pending: 0 | 1;
  /** Linked auto-booked fee expense(s) (SMS/Line_Usage — `is_auto` rows,
   *  `expenses.source_ref_table = 'recharges'`), shown NEXT TO this row,
   *  never subtracted from its profit (owner decision,
   *  OWNER_NOTES_REMAINING_BUILD.md #14 slice 2: "+90,000 LBP profit · SMS
   *  fee -0.32$ (booked in expenses)"). */
  fee_expense_usd: number;
  fee_expense_lbp: number;
  fee_expense_description: string | null;
}

export interface ProfitByDateRow {
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

export interface PaymentMethodRow {
  method: string;
  /** NEW-SALES intake, net of change/payout OUT legs and partial item
   *  refunds — owner decision 1 (2026-09-24, OWNER_NOTES_2026-09-21.md §6.5):
   *  "what actually stayed in the drawer, by tender." Never includes
   *  DEBT_REPAYMENT intake — see {@link debt_repayment_usd}. */
  total_usd: number;
  total_lbp: number;
  /** Owner decision 3: debt-repayment intake, shown as its OWN column
   *  instead of the old all-or-nothing `is_debt_repayment_only` flag — a
   *  method can take BOTH new-sales and debt-repayment money in the same
   *  period, and the old flag hid one or the other. */
  debt_repayment_usd: number;
  debt_repayment_lbp: number;
  count: number;
  pending_commission_usd: number;
  is_settled: number;
}

export interface CommissionTotalsRow {
  total_usd: number;
  total_lbp: number;
  count: number;
}

/**
 * LIRA-158 Phase 3 (D15) — {@link ProfitRepository.getPendingCommissionTotals}'s
 * return shape. `total_usd`/`total_lbp`/`count` keep their PRE-existing
 * meaning unchanged (legacy `commission_model = 0` rows only — the dollar
 * figure). `awaiting_settlement_count` is NEW: the number of
 * `commission_model = 1` rows pending settlement in range, for which the
 * commission is unknowable until settlement (a count, never a dollar
 * figure — see {@link atSettlementCommission}). A separate interface from
 * {@link CommissionTotalsRow} (which `getRealizedCommissionTotals` also
 * returns and does NOT gain this field) rather than widening that shared
 * shape.
 */
export interface PendingCommissionTotalsRow {
  total_usd: number;
  total_lbp: number;
  count: number;
  awaiting_settlement_count: number;
}

export interface PendingCommissionByProviderRow {
  provider: string;
  total_usd: number;
  /** LPAY-V7 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3): was
   *  missing entirely — an LBP-only provider (legacy model-0 commission
   *  denominated in LBP) had a real pending commission but no column to
   *  carry it, so `ProfitService.getByPaymentMethod`'s per-provider label
   *  read "$0.00" for it even though it genuinely owed something. */
  total_lbp: number;
  count: number;
  /** @see PendingCommissionTotalsRow.awaiting_settlement_count */
  awaiting_settlement_count: number;
}

export interface ProfitByUserRow {
  user_id: number;
  username: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** PA-4.19: transaction_count minus REFUND/SUPPLIER_SETTLEMENT rows and an
   *  unrecognized FS row, PLUS (LCC-X4, Round 3) the count of kept-change,
   *  exchange, and re-attributed settlement-commission events also folded
   *  into profit_usd/profit_lbp — the correct "Avg Profit/Txn" denominator,
   *  matching every source that column's numerator sums. See getByUser's
   *  own doc comment for the full rationale. */
  recognized_transaction_count: number;
  pending_profit_usd: number;
  /** PA-1.3: LBP half of pending_profit_usd, split by fs2.currency. */
  pending_profit_lbp: number;
}

export interface ProfitByClientRow {
  client_id: number | null;
  client_name: string;
  client_phone: string | null;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** @see ProfitByUserRow.recognized_transaction_count */
  recognized_transaction_count: number;
  pending_profit_usd: number;
  /** @see ProfitByUserRow.pending_profit_lbp */
  pending_profit_lbp: number;
}

export interface PendingSaleProfitRow {
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

/**
 * Deferred-profit visibility (owner ask 2026-07-14): profit currently
 * STRANDED behind an uncovered partner-settlement row (PFT-6) or an
 * uncovered client-debt repayment row (DBT-1) — i.e. profit already stamped
 * on the transaction's profit_usd/profit_lbp but not yet counted as realized
 * by getSummary/getByUser/getByClient because their partner/debt gates
 * exclude it.
 */
export interface DeferredProfitRow {
  partner_profit_usd: number;
  partner_profit_lbp: number;
  client_debt_profit_usd: number;
  client_debt_profit_lbp: number;
  /**
   * PA-3.10 (OWNER_NOTES_2026-09-21.md §6.5) — the D17 cashless-settlement
   * share ALONE (the same figure already folded, undistinguished, into
   * `client_debt_profit_usd`/`_lbp` above as `cashlessDeferredRow`). Ordinary
   * debt-pending recharge/service/loto/maintenance profit is NEVER included
   * here — only a settlement `getSupplierCommissionTotals` classifies
   * cashless ({@link cashlessCommissionBatch}) whose underlying transfer is
   * itself still debt-pending. Exposed separately so the "Supplier
   * Commission: Deferred" card can gate on THIS figure instead of the
   * combined (and much more commonly nonzero) `client_debt_profit_usd`.
   * Purely additive — `client_debt_profit_usd`/`_lbp`'s own value and
   * meaning are unchanged.
   */
  cashless_deferred_profit_usd: number;
  cashless_deferred_profit_lbp: number;
}

/**
 * LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — bills-only settlement
 * commission, profit-only (no revenue/cost pair of its own — see
 * {@link ProfitRepository.getSupplierCommissionTotals}).
 */
export interface SupplierCommissionTotalsRow {
  profit_usd: number;
  profit_lbp: number;
  count: number;
  /**
   * PA-2.1 / PA-2.4 (OWNER_NOTES_2026-09-21.md §6.4) — the bills-only and
   * cashless halves this method already computes internally (`billsOnly` /
   * `cashless`), exposed separately so a caller can show "Supplier
   * Commission" as bills-only ONLY (its real-money-at-settlement meaning)
   * while the cashless share is shown on the Financial Services card instead
   * ("Commission (at settlement)") — see the method's own doc comment for the
   * exhaustive/disjoint partition proof. Purely additive: `profit_usd`/
   * `profit_lbp`/`count` above stay the COMBINED total, unchanged, so
   * `ProfitService.getSummary`'s existing gross-profit arithmetic is
   * untouched.
   */
  bills_only_profit_usd: number;
  bills_only_profit_lbp: number;
  bills_only_count: number;
  cashless_profit_usd: number;
  cashless_profit_lbp: number;
  cashless_count: number;
}

/**
 * PA-2.3 (OWNER_NOTES_2026-09-21.md §6.4) — profit-only bucket for
 * {@link ProfitRepository.getTopupBuybackProfit} (TELECOM_CREDIT_BUYBACK +
 * RECHARGE_TOPUP). No revenue/cost pair, matching the shape
 * debt_repayments/discounts/supplier_commission already use on
 * `ProfitSummary` — these transaction types stamp a signed `profit_usd`/
 * `profit_lbp` directly, with no separate revenue figure to report (see the
 * method's own doc comment for why).
 */
export interface TopupBuybackProfitRow {
  profit_usd: number;
  profit_lbp: number;
  count: number;
}

// =============================================================================
// Rule 14 — named domain-rule SQL fragments (defined ONCE, reused everywhere)
// =============================================================================

/**
 * PROF-DD-FIX (review round, 2026-09-24) — rule 14 extraction of the
 * "total paid, USD + LBP converted at the sale's snapshot rate" figure
 * {@link saleFullyPaid}/{@link saleNotFullyPaid} both compare against
 * `final_amount_usd`. Pulled out so `getSalesDetail`'s "Customer still owes"
 * drill-down reason can select the SAME number the gate itself uses (it used
 * to independently reference the pre-discount `total_amount_usd`/bare
 * `paid_usd`, which could read "paid $0.00 of $100.00" on a sale actually
 * paid in full via LBP — see `getSalesDetail`'s own doc comment).
 */
export function saleTotalPaidUsdEquiv(alias: string): string {
  return `(${alias}.paid_usd + COALESCE(${alias}.paid_lbp, 0) / COALESCE(NULLIF(${alias}.exchange_rate_snapshot, 0), 1))`;
}

/**
 * SALE fully-paid gate: total paid (USD + LBP converted at the sale's snapshot
 * rate) covers the final amount within a $0.05 tolerance. `alias` is the table
 * alias used for the `sales` row in the surrounding query.
 */
export function saleFullyPaid(alias: string): string {
  return `${saleTotalPaidUsdEquiv(alias)} >= ${alias}.final_amount_usd - 0.05`;
}

/** Negation of {@link saleFullyPaid} — sale still owes money (pending). */
function saleNotFullyPaid(alias: string): string {
  return `${saleTotalPaidUsdEquiv(alias)} < ${alias}.final_amount_usd - 0.05`;
}

/**
 * PFT-6 — for-partner profit is realized only when the partner settles
 * (owner decision, Model A). A source row is "partner-pending" while any of
 * its FOR_% partner_ledger rows is not fully covered by settlement FIFO
 * coverage (v128 covered_amount; PartnerRepository.applySettlementCoverage).
 * The rule has NO carve-outs — every provider (including iPick/Katsh) defers
 * until the partner's cash comes in (owner decision 2026-07-14, resolving the
 * former iPick/Katsh immediate exception). Non-partner rows have no FOR_% rows
 * and pass unchanged. reference_table + reference_id identify the source row
 * globally (one AUTOINCREMENT per table), so no tenant correlation is needed.
 */
export function notPartnerPending(refTable: string, idExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM partner_ledger plp
    WHERE plp.reference_table = '${refTable}'
      AND plp.reference_id = ${idExpr}
      AND plp.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
      AND plp.covered_amount < plp.amount - 0.005
  )`;
}

/**
 * Proportional-recognition foundation (owner decision 2026-09-05) — the
 * CONTINUOUS counterpart of {@link notPartnerPending}. Where
 * `notPartnerPending` answers a binary question ("is this source row still
 * blocked by ANY uncovered FOR_% obligation?"), `partnerCoverageRatio`
 * answers a continuous one: "what FRACTION of this source row's total
 * partner obligation has the partner actually paid so far?" — so a future
 * caller can recognise revenue/profit/commission/etc. PROPORTIONALLY as
 * settlement coverage arrives, instead of withholding the whole row until it
 * is 100% covered.
 *
 * Returns a scalar SQL expression (safe to embed directly in a SELECT list,
 * a weighting multiplier, or a CASE arm) computing:
 *
 *   SUM(covered_amount) / SUM(amount)
 *
 * over EXACTLY the same `partner_ledger` rows {@link notPartnerPending}
 * scans for the same `refTable`/`idExpr` pair: matching `reference_table`,
 * `reference_id`, and `transaction_type LIKE 'FOR\_%' ESCAPE '\'`. That WHERE
 * clause is copy-identical to `notPartnerPending`'s own (rule 14 — ONE
 * definition of "what counts as this row's partner obligation"; the two
 * fragments must never be free to drift apart about which rows belong to a
 * source row). The one difference from `notPartnerPending`'s own row
 * selection is deliberate: this fragment does NOT additionally filter by
 * `covered_amount < amount - 0.005` — that filter exists on
 * `notPartnerPending` only to detect the EXISTENCE of an uncovered row; here
 * every matching FOR_% row (covered or not) must contribute to both sums, or
 * the ratio would silently ignore already-fully-covered rows.
 *
 * Three defensive properties, each load-bearing for the callers this will
 * unblock:
 *
 *  - **Defaults to 1.0 when the row has no FOR_% rows at all.** A
 *    non-partner row (the overwhelming majority of every module's rows —
 *    any sale, recharge, or service that never involved a partner) has zero
 *    matching `partner_ledger` rows, so both SUMs are SQL NULL and the
 *    division is NULL. The outer `COALESCE(..., 1.0)` catches that and
 *    recognises the row FULLY — exactly as it is recognised today with no
 *    gate at all. This fragment MUST be a strict no-op for the common case;
 *    it only ever pulls a row's recognised share below 1.0 when that row
 *    genuinely has an outstanding partner obligation.
 *  - **Clamped to the range [0, 1]**, via the scalar (2-argument, NOT the
 *    1-argument aggregate) `MIN`/`MAX` forms. `covered_amount` should never
 *    exceed `amount`, but this is a defensive floor/ceiling matching the
 *    task's own requirement: an over-covered row (rounding, a same-instant
 *    FIFO race) can never recognise MORE than 100% of itself, and a
 *    (should-never-happen) negative figure can never recognise LESS than 0%.
 *  - **`NULLIF` guards the division** so a zero-`amount` FOR_% row (should
 *    never exist, but defensively) degrades to the same 1.0 default via the
 *    outer `COALESCE` rather than letting a SQL NULL propagate silently
 *    through whatever arithmetic a caller builds around this fragment.
 *
 * **Derived at read time. Never stamped — this is why rule 20 is satisfied
 * by construction, with no reversal owner to name.** Nothing about
 * proportional recognition is written to any row when this expression is
 * evaluated; it re-reads `covered_amount` fresh on every single query. That
 * means `PartnerRepository.applySettlementCoverage` incrementing
 * `covered_amount` (the partner settles more, oldest-uncovered-first FIFO)
 * and `TransactionRepository._unwindPartnerSettlementCoverage` decrementing
 * it (a refund/void gives coverage back, newest-covered-first reverse-FIFO)
 * BOTH automatically change what THIS fragment returns on the very next
 * read — with no corresponding "reverse the proportional recognition" step
 * for any caller to remember, because there is nothing recorded to reverse.
 * A rule-20 change normally must name a reversal owner for every new
 * ledger-row side effect; this fragment's answer is "there is no side
 * effect — the figure is recomputed from `partner_ledger` state, never
 * recorded against the source row."
 *
 * Cross-reference: {@link notPartnerPending} is this fragment's binary
 * sibling — `ratio < 1` implies `notPartnerPending` would say "pending" and
 * `ratio == 1` implies `notPartnerPending` would say "not pending" (a
 * pre-existing caller can keep using the binary gate unchanged; this
 * fragment only matters to a NEW caller that wants the fraction instead of
 * the yes/no). See `docs/plans/done_plans/PARTNER_PROPORTIONAL_RECOGNITION.md`
 * for the full call-site classification and lane split this fragment feeds.
 * NOT yet wired into any existing query — adding this fragment changes zero
 * behaviour by itself (proven by the unchanged jest baseline).
 */
export function partnerCoverageRatio(refTable: string, idExpr: string): string {
  return `COALESCE(
    (
      SELECT MAX(0.0, MIN(1.0,
        SUM(plr.covered_amount) / NULLIF(SUM(plr.amount), 0)
      ))
      FROM partner_ledger plr
      WHERE plr.reference_table = '${refTable}'
        AND plr.reference_id = ${idExpr}
        AND plr.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
    ),
    1.0
  )`;
}

/**
 * PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — does
 * this module source row carry a for-partner obligation AT ALL (a FOR_%
 * partner_ledger row exists), independent of how much is settled? Generalizes
 * {@link saleHasPartnerObligation}'s EXISTS shape to any reference table/id
 * (rule 14 — one shared definition instead of a copy per module). Used ONLY
 * to classify a drill-down row's "why isn't this counted yet" reason;
 * {@link partnerCoverageRatio} already derives the counted FRACTION from the
 * same `partner_ledger` rows and is the one that feeds money weighting.
 */
export function hasPartnerObligation(refTable: string, idExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM partner_ledger plo
    WHERE plo.reference_table = '${refTable}'
      AND plo.reference_id = ${idExpr}
      AND plo.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
  )`;
}

/**
 * DBT-1 — client-account SERVICE profit is realized only when the client
 * repays (owner decision 2026-07-14, consistent with products + partners). A
 * source transaction is "debt-pending" while its module-debt charge row
 * (Recharge/Service/Custom Service/Loto/Maintenance Debt, keyed by the
 * unified transaction id) is not fully covered by repayment FIFO coverage
 * (v129 covered_usd/covered_lbp; DebtRepository._coverServiceDebtsFIFO).
 * 'Sale Debt' is excluded — sales recognize via sales.paid_usd. Refunded
 * charge rows are skipped (their source is excluded via notRefunded anyway).
 */
export function notDebtPending(txnIdExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM debt_ledger dlp
    WHERE dlp.transaction_id = ${txnIdExpr}
      AND dlp.transaction_type IN ('Recharge Debt', 'Service Debt', 'Custom Service Debt', 'Loto Debt', 'Maintenance Debt')
      AND COALESCE(dlp.is_refunded, 0) = 0
      AND (dlp.covered_usd < COALESCE(dlp.amount_usd, 0) - 0.005
           OR dlp.covered_lbp < COALESCE(dlp.amount_lbp, 0) - 1)
  )`;
}

/**
 * D17 (LIRA-158 follow-up, owner decision 2026-08-31) — the client-debt
 * counterpart of {@link notDebtPending} for a
 * `settlement_commission_allocations` row instead of a `transactions` row.
 * Owner-confirmed 2026-08-31: he settles OMT/WHISH batches out of his OWN
 * drawer BEFORE the customers who owe him for those transfers have paid, so
 * a CASHLESS settlement's commission is not unconditionally earned at
 * settlement — it is contingent on collecting the client's debt for the
 * underlying transfer, exactly like a legacy (`commission_model = 0`)
 * embedded-commission row already defers via {@link notDebtPending} (both
 * gate on the SAME `debt_ledger` rule; this is not a second copy of it —
 * see below).
 *
 * Resolves the allocation's own `financial_service_id` to THAT financial
 * service's own FINANCIAL_SERVICE transaction id (a scalar correlated
 * subquery; `LIMIT 1` defends against a never-expected second row sharing
 * one `source_id`, matching this file's existing scalar-subquery
 * discipline) and calls {@link notDebtPending} VERBATIM on that id — rule 14
 * forbids a second, hand-copied text of the debt-pending predicate.
 *
 * `scaAlias` is the alias for `settlement_commission_allocations` already in
 * scope at the call site (typically `sca`).
 */
export function allocationNotDebtPending(scaAlias: string): string {
  return notDebtPending(
    `(SELECT ft.id FROM transactions ft
        WHERE ft.source_table = 'financial_services'
          AND ft.source_id = ${scaAlias}.financial_service_id
          AND ft.type = 'FINANCIAL_SERVICE'
        LIMIT 1)`,
  );
}

/**
 * D17 — re-derives `SupplierRepository._resolveSettlementBatchModel` /
 * `isBillsOnlyBatch`'s JS boolean (SupplierRepository.ts ~:1185:
 * `batchModel === 1 && eligibleRows.every(r => r.service_type === 'BILL')`)
 * in SQL, from the SAME persisted per-row link
 * (`settlement_commission_allocations.service_type`) that boolean was
 * computed from at write time. A settlement's allocation rows are written
 * ATOMICALLY together, one per settled fs row, all sharing the same
 * `settlement_ledger_id` (`SupplierRepository._bookCommissionAtSettlement`'s
 * `insertAllocation` loop) — so "every row is BILL" (bills-only) and "at
 * least one row is NOT BILL" (cashless) are exhaustive, mutually-exclusive
 * re-derivations of the identical batch-level fact. This fragment computes
 * the CASHLESS side directly (the negation of bills-only) since every call
 * site needs the cashless predicate, not its complement.
 *
 * Document this pair as a JS/SQL twin needing lockstep maintenance, the same
 * discipline `isPendingSupplierSettlement`/`pendingSettlementSql` already
 * follow: if `isBillsOnlyBatch`'s definition in SupplierRepository.ts ever
 * changes, this fragment must change with it.
 *
 * Owner decision 2026-08-31 (D17) folds a MIXED bills+OMT batch into
 * "cashless too" — no real money arrives for the OMT/WHISH share of a mixed
 * batch either, only for its BILL share — which is exactly what "at least
 * one non-BILL row exists for this settlement" captures (a pure-BILL batch
 * has zero such rows, so it correctly evaluates to NOT cashless).
 *
 * `settlementLedgerIdExpr` is a SQL expression evaluating to the
 * settlement's `supplier_ledger.id` — pass `` `${alias}.settlement_ledger_id` ``
 * when correlating from an allocation row already in scope (the common
 * case), or a `transactions` row's own `source_id` (the SAME id, under
 * `supplier_ledger`'s naming on that table — see
 * `SupplierRepository._bookCommissionAtSettlement`'s
 * `source_id: ledgerEntryId` / `settlement_ledger_id: ledgerEntryId`, both
 * bound to the identical value) when classifying a SUPPLIER_SETTLEMENT/
 * REFUND transaction row instead of an allocation row — both
 * {@link ProfitRepository.getSupplierCommissionTotals} and
 * `ClosingRepository`'s settlement-day source need exactly that second use,
 * and rule 14 forbids a second copy of this predicate hard-coding a
 * different column name for the same fact. No `tenant_id` bind inside
 * (matching every other rule-14 fragment's convention of leaving tenant
 * scoping to the caller) — safe regardless, since `settlement_ledger_id` is
 * a `supplier_ledger.id` global AUTOINCREMENT PK, so a sibling allocation row
 * for the SAME id can never belong to a different tenant.
 */
export function cashlessCommissionBatch(
  settlementLedgerIdExpr: string,
): string {
  return `EXISTS (
    SELECT 1 FROM settlement_commission_allocations sca2
    WHERE sca2.settlement_ledger_id = ${settlementLedgerIdExpr}
      AND sca2.service_type != 'BILL'
  )`;
}

/**
 * DBT-2 — transaction-level partner-pending scan, correlating on a
 * transactions row's own `source_table`/`source_id` (instead of a fixed
 * table name) — same semantics as {@link notPartnerPending}.
 *
 * PROPORTIONAL CONVERSION (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md
 * Step 2) — `getByUser`/`getByClient`/`getDeferredProfit` (this fragment's
 * only production call sites) now weight by {@link txnPartnerCoverageRatio}
 * instead of gating on this predicate directly, so this function currently
 * has NO production call site. Kept (not deleted) for two reasons: (1) it is
 * still the canonical, exact definition of "what counts as an uncovered
 * partner row" for the transactions-alias case — `txnPartnerCoverageRatio`'s
 * own doc comment cross-references it, and its unit test proves row-
 * selection agreement against this predicate directly (rule 14 — one
 * definition, verified equivalent, not two independently-maintained ones);
 * (2) `profitRecognition.guard.test.ts`'s `GATE_FRAGMENTS` sanity check
 * asserts this name still exists as a callable function. Exported (was
 * previously module-private) so its own equivalence test can import it
 * directly instead of hand-copying its SQL text a second time.
 */
export function txnNotPartnerPending(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM partner_ledger plp
    WHERE plp.reference_table = ${alias}.source_table
      AND plp.reference_id = ${alias}.source_id
      AND plp.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
      AND plp.covered_amount < plp.amount - 0.005
  )`;
}

/**
 * Does this sale carry ANY for-partner obligation at all (a FOR_% row
 * exists), independent of how much of it is covered? Shared by
 * {@link salePaidOrPartnerSettled} (the pre-existing binary gate),
 * {@link saleRecognitionWeight} (its proportional counterpart, immediately
 * below), and — as of PA-3.2 round 2 (LP-1/LP-2) — `getPendingSaleProfit`'s
 * own `WHERE` clause (`AND NOT saleHasPartnerObligation("s")`), which
 * excludes every for-partner sale from the Pending tab's unpaid-sales list
 * outright (its pending share lives exclusively in `getDeferredProfit`'s
 * partner bucket instead, at every coverage level — not just weighted at the
 * value level). Three callers now share this ONE EXISTS check (rule 14) —
 * extracted here as the ONE place answering "is this a partner sale at all."
 */
function saleHasPartnerObligation(alias: string): string {
  // PROF-DD-FIX (review round, 2026-09-24) — delegates to the generic
  // {@link hasPartnerObligation} instead of re-pasting the same EXISTS
  // shape (rule 14): this function used to be the ONE definition, and
  // `hasPartnerObligation` was added later as a copy generalized to any
  // reference table/id. Byte-identical SQL for the 'sales' case either way.
  return hasPartnerObligation("sales", `${alias}.id`);
}

/**
 * SALE realized gate (PFT-6): fully paid by the customer OR a for-partner
 * sale (has a FOR_% row) whose partner has fully settled it. A for-partner
 * sale carries paid_usd = 0 (no counter cash), so without the OR-arm it
 * would stay pending forever even after the partner paid.
 *
 * Task 3 (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md): every production
 * call site (getSalesRevCost, getSalesProfit, getByDate's
 * daily_sales/daily_sales_profit, getByUser/getByClient's sale arm) has now
 * been converted to weight by {@link saleRecognitionWeight} instead of
 * gating on this binary predicate — this function currently has NO
 * production call site. Kept (not deleted), mirroring
 * {@link txnNotPartnerPending}'s own precedent, for two reasons: (1) it is
 * still the canonical statement of the old binary rule that
 * `saleRecognitionWeight`'s own doc comment cross-references (its 0/1
 * endpoints must agree with this predicate's yes/no, and its unit tests
 * assert exactly that); (2) `profitRecognition.guard.test.ts`'s
 * `GATE_FRAGMENTS` sanity check asserts this name still exists as a callable
 * function.
 */
function salePaidOrPartnerSettled(alias: string): string {
  return `(${saleFullyPaid(alias)} OR (${saleHasPartnerObligation(alias)} AND ${notPartnerPending("sales", `${alias}.id`)}))`;
}

/**
 * Proportional counterpart of {@link salePaidOrPartnerSettled} (owner
 * decision 2026-09-05, docs/plans/done_plans/PARTNER_PROPORTIONAL_RECOGNITION.md,
 * Lane A). Returns a NUMERIC weight in [0, 1] — NOT a boolean:
 *
 *  - `1.0` when the customer paid the sale in full ({@link saleFullyPaid}).
 *    A customer-paid sale recognises at 100% unconditionally; this branch is
 *    never made proportional — a customer's own payment is not a partner
 *    obligation, so there is nothing here to prorate.
 *  - `${partnerCoverageRatio("sales", alias.id)}` when this is a for-partner
 *    sale ({@link saleHasPartnerObligation}). THIS is the branch that becomes
 *    continuous: a partner sale recognises exactly the fraction the partner
 *    has actually paid so far, instead of all-or-nothing.
 *  - `0.0` otherwise — a genuinely pending, non-partner sale (ordinary
 *    customer debt). Untouched by this change (DBT-1/client debt is out of
 *    scope), so a plain unpaid sale still contributes nothing, exactly as
 *    {@link salePaidOrPartnerSettled} already excludes it today.
 *
 * The two branches are a disjunction, never a blend: a sale is never BOTH
 * customer-paid AND a for-partner sale (a for-partner sale carries
 * `paid_usd = 0` — see {@link salePaidOrPartnerSettled}'s own doc comment),
 * so checking `saleFullyPaid` first carries no double-counting risk.
 *
 * WIRED IN (Task 3, 2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md): every
 * call site named above as this fragment's motivation now multiplies its
 * monetary SELECT columns by this weight instead of gating on
 * {@link salePaidOrPartnerSettled} — `getSalesRevCost`, `getSalesProfit`
 * (bare `SUM(...)`, gate removed from the `WHERE` and folded into the summed
 * expression instead), `getByDate`'s `daily_sales`/`daily_sales_profit` CTEs
 * (same shape), and `getByUser`/`getByClient`'s sale arm (a value-level
 * `CASE`, where the old `WHEN salePaidOrPartnerSettled(s2) THEN <value> ELSE
 * 0` becomes `<value> * saleRecognitionWeight(s2)` directly — no `WHERE` to
 * remove there, it was never gated at that level). Gate-removal and
 * value-weighting always land in the SAME edit at every site: loosening the
 * boolean alone without weighting the value would overstate a
 * partially-covered for-partner sale's revenue/profit at its FULL amount —
 * strictly worse than the old all-or-nothing exclusion.
 */
export function saleRecognitionWeight(alias: string): string {
  return `(CASE
    WHEN ${saleFullyPaid(alias)} THEN 1.0
    WHEN ${saleHasPartnerObligation(alias)} THEN ${partnerCoverageRatio("sales", `${alias}.id`)}
    ELSE 0.0
  END)`;
}

/**
 * Module-source row not refunded/voided. Void and refund both set
 * `is_refunded = 1` on the source row (see TransactionRepository
 * `_markSourceRefunded`) — without this gate a refunded service keeps its full
 * revenue AND profit forever, because the REFUND/VOID reversal transaction row
 * never enters the module joins (they join on the module's own type).
 */
export function notRefunded(alias: string): string {
  return `COALESCE(${alias}.is_refunded, 0) = 0`;
}

/**
 * A `transactions` row `alias` has NOT since been reversed by an ACTIVE
 * REFUND transaction pointing back at it via `reverses_id`. `refundTransaction`
 * deliberately leaves the ORIGINAL row's `status = 'ACTIVE'` (so the
 * original + REFUND profit nets to zero — see `TransactionWithUser
 * .reversed_by_id`'s doc comment on `TransactionRepository.getRecent`), so a
 * plain `status` check cannot tell "was refunded" apart from "never
 * touched"; this correlated-subquery shape is the only way.
 *
 * Rule 14 (LPAY-5, OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review): extracted
 * from `getPaymentMethodRows`'s own inline `NOT EXISTS`, the only caller in
 * THIS file, so it cannot drift a second time within ProfitRepository.
 * `TransactionRepository.getRecent`'s `reversed_by_id` computed column is
 * the identical predicate but a different SHAPE (a scalar `(SELECT r.id
 * ...)` that surfaces the reversing row's id, not a boolean) and lives in a
 * file this lane (LPay) does not own (LPay may only touch
 * `TransactionRepository.ts`'s `INTERNAL_LEG_METHODS` export) — reusing
 * this exact fragment there instead of its own copy is left as a follow-up,
 * not fixed here (that pre-existing duplication predates this change).
 *
 * LPAY-R3-4 (round-3 review): the paragraph above says "ACTIVE REFUND" —
 * the SQL now actually checks `r.status = 'ACTIVE'` to match it. Before this
 * fix it didn't, which was harmless in practice only because
 * `_assertReversible` already forbids voiding a REFUND row (a REFUND can
 * never itself become VOIDED, so `r.status` was always 'ACTIVE' anyway) —
 * but the comment and the SQL disagreed, and nothing enforced they'd keep
 * agreeing if that invariant ever changed. Added defensively.
 */
export function notReversedByRefund(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM transactions r
    WHERE r.reverses_id = ${alias}.id
      AND r.type = 'REFUND'
      AND r.status = 'ACTIVE'
      AND r.tenant_id = ${alias}.tenant_id
  )`;
}

/**
 * The single definition of "this expense still counts" (rule 14). Both gates
 * are required because an expense can be undone through two different doors,
 * and each one flips a DIFFERENT column:
 *   - `ExpenseRepository.deleteExpense` (the Expenses page) sets
 *     `status = 'voided'` (and voids the unified transaction).
 *   - A void/refund driven from the Transactions viewer runs the GENERIC
 *     path, which reverses the drawer legs and sets `expenses.is_refunded = 1`
 *     via `TransactionRepository._markSourceRefunded`, but never touches
 *     `status`.
 * Gating on either column alone leaves a reversed expense counted forever
 * while its drawer leg has already been given back (rule 20). Reuses
 * `notRefunded` rather than pasting a second copy of the is_refunded test.
 * REV-4 (verifier round-1 fix, 2026-09-24): the caller list below used to
 * name a `getProfitByDate` method (no such method exists — the real one is
 * `getByDate`) and `FinancialRepository.getMonthlyPL` (deleted; that class
 * now exposes no report methods at all). Both were stale by the time LIRA-219
 * shipped: `ClosingService.getDailyStatsSnapshot` composes its profit figures
 * from `ProfitService.getSummary` (not raw SQL against this fragment) — see
 * `ClosingRepository.ts`'s own file-header note — so it never called
 * `activeExpense` either.
 *
 * Callers: `ProfitRepository.getExpenseTotals` + `getByDate`'s
 * `daily_expenses` CTE (both in THIS file), and `ClosingRepository
 * .getDailyActivityStats`'s own daily-expense count (`activeExpense`/
 * `dateRange` are the only two fragments that file still imports from here).
 */
export function activeExpense(alias = "expenses"): string {
  return `${alias}.status = 'active' AND ${notRefunded(alias)}`;
}

/**
 * Inclusive [from, to] date-range bound on a timestamp column (two bind params).
 *
 * The column is converted to machine-local wall-clock before comparison, so the
 * range is interpreted in the operator's local day, not UTC. ProfitService
 * passes `"${from} 00:00:00"` / `"${to} 23:59:59"`, so a sale at 01:00 Beirut
 * (stored as the previous UTC day) lands in the local day the operator expects.
 * `'localtime'` follows the machine TZ (Beirut on desktop; pin `TZ=Asia/Beirut`
 * on the web server). Non-sargable (defeats a `created_at` index) — same cost the
 * other `'localtime'` reporting queries already pay.
 *
 * Exported (same precedent as {@link notRefunded}/{@link activeExpense}) so
 * every caller in this file and in `ClosingRepository` binds the SAME
 * predicate text — the daily closing snapshot and the Profits page then
 * bound their windows identically (rule 14) instead of a second hand-written
 * `strftime('%Y-%m', …)` form drifting from this one.
 * REV-4 (verifier round-1 fix, 2026-09-24): this used to also name
 * `FinancialRepository.getMonthlyPL` as a caller binding this fragment via
 * `monthBounds()` (`utils/localDate.ts`) — `getMonthlyPL` has since been
 * deleted (`FinancialRepository` exposes no report methods at all now); see
 * `SalesService.ts`'s own doc comment on the Dashboard tile it replaced it
 * with, sourced from `ProfitRepository.getByDate` instead.
 */
export function dateRange(col: string): string {
  return `datetime(${col}, 'localtime') >= ? AND datetime(${col}, 'localtime') <= ?`;
}

/**
 * Rule 14 — the ONE "does this row belong in the USD column" predicate, in
 * its two allowed forms:
 *   - `strict = false` (every existing caller before LPAY-R3-3): the OLD
 *     `<col> != 'LBP'` bucketing — lumps EUR/USDT/anything-not-LBP into USD.
 *   - `strict = true` (ProfitService.getByPaymentMethod ONLY): the PA-1.4
 *     convention — `<col> = 'USD'` exactly, so a non-USD/non-LBP row is
 *     dropped from both currency totals instead of misreported as USD (same
 *     choice `getPaymentMethodRows` already makes for its own payment-leg
 *     rows, and `TransactionRepository.CUSTOMER_CASH_CURRENCIES` makes for
 *     the LIRA-064 cash-flow report).
 * Never inline a third copy of either form — call this instead.
 */
function usdBucketPredicate(columnRef: string, strict: boolean): string {
  return strict ? `${columnRef} = 'USD'` : `${columnRef} != 'LBP'`;
}

/** Financial-service revenue: price when a cost is present, else the amount. */
function fsRevenue(alias: string): string {
  return `CASE WHEN ${alias}.cost > 0 THEN ${alias}.price ELSE ${alias}.amount END`;
}

/**
 * Rule 14 — the ONE definition of "this row's own `commission` column is the
 * settled truth" (legacy EMBEDDED, D3 cutover: `commission_model = 0`).
 *
 * LIRA-158 (COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2a) — the row's own
 * `commission` column is the settled truth ONLY for a legacy EMBEDDED row
 * (`commission_model = 0`, D3 cutover). An AT_SETTLEMENT row
 * (`commission_model = 1`) has this same column auto-populated with an
 * ESTIMATE at creation time (`FinancialServiceRepository.ts` — the
 * `calculatedCommission` ternary feeding the INSERT) that is NEVER corrected
 * back — the real, operator-entered commission is recognised later on the
 * SUPPLIER_SETTLEMENT transaction instead (settlement-day, see
 * {@link ProfitRepository.getSupplierCommissionTotals}). Reading `commission`
 * directly for a model-1 row would report a number that was never true (OMT/
 * WHISH SEND/RECEIVE) or is force-zeroed and never becomes true here at all
 * (WHISH/BILL — their real commission is entered at settlement, off this
 * column entirely; see LIRA-158_COMMISSION_REPORTING_PLAN.md §1.1).
 *
 * `alias` is the table alias/prefix this predicate is embedded under — some
 * call sites are aliased (`fs`, `fs2`) and some read the bare table name
 * (`financial_services`), so the parameter handles both; there is no second
 * copy of this fragment for the unaliased case. `supported` is
 * {@link hasCommissionModelColumn}'s schema-drift guard: `"1 = 1"` on a
 * fixture that pre-dates `commission_model` deliberately reproduces today's
 * (pre-LIRA-158) behavior unchanged — the same degradation strategy
 * `pendingSettlementSql` already uses for its own schema-drift guard
 * (`FinancialServiceRepository.ts`, `commission_eligible`).
 *
 * Exported (same precedent as {@link notRefunded}, reused across repository
 * files) because `FinancialServiceRepository.getAnalytics` embeds this SAME
 * rule inside its five `CASE WHEN` sub-queries. Before this export,
 * `getAnalytics` carried a second, hand-copied ternary (`modelZeroOnly`) that
 * encoded the identical rule — there is now exactly one text of this
 * predicate in the codebase (rule 14).
 */
export function embeddedCommission(alias: string, supported: boolean): string {
  return supported ? `${alias}.commission_model = 0` : "1 = 1";
}

/**
 * PA-0.1 (OWNER_NOTES_2026-09-21.md §6.2, "Batch 0 — fix before committing")
 * — rule 14's ONE definition of "does this FS row's profit STAMP
 * (`transactions.profit_usd`/`profit_lbp` on its FINANCIAL_SERVICE row —
 * NEVER `financial_services.commission`, see {@link embeddedCommission}'s own
 * doc comment for why that column is a different question) count as
 * recognised profit right now."
 *
 * A model-1 (AT_SETTLEMENT, D3) row's STAMP never carries deferred supplier
 * commission, regardless of `is_settled`:
 *   - A plain OMT/WHISH SEND/RECEIVE (not cost/price) has its commission TERM
 *     force-zeroed at write time (`FinancialServiceRepository
 *     .createTransaction`'s `profit_usd`/`profit_lbp`, ~:2158-2173) — what
 *     survives is kept change and the D1 Whish RECEIVE fee, both money
 *     already in the drawer, never a number the supplier owes.
 *   - A cost/price BILL (iPick/Katsh) stamps `price - cost` instead (same
 *     lines) — that function's own doc comment (D14/option C) is explicit
 *     this is a MARGIN earned the moment the customer paid at the counter,
 *     not a supplier-commission estimate deferred to settlement (checked
 *     first, per PA-0.1's own caveat, before writing this predicate): the
 *     row's real, operator-entered commission is a SEPARATE figure, booked
 *     later on the SUPPLIER_SETTLEMENT transaction (see
 *     {@link ProfitRepository.getSupplierCommissionTotals}), so recognising
 *     the price-cost margin immediately double-counts nothing.
 *
 * Gating either shape's stamp on `is_settled = 1` therefore hid real,
 * already-collected money until an unrelated, later event (the supplier
 * settling) happened, and meanwhile mislabeled it "pending commission"
 * ({@link ProfitRepository.getFinancialPendingByCurrency}, restricted to
 * model 0 by this same fix) — then made it look backdated the moment
 * settlement flipped `is_settled`.
 *
 * A model-0 (legacy EMBEDDED) row is NOT covered by this predicate: its
 * `commission` term genuinely IS the settled truth only once
 * `is_settled = 1` ({@link embeddedCommission}'s own doc comment), so it
 * keeps needing that gate unchanged — this predicate ADDS
 * `commission_model = 1` as a second, independent way to recognise; it does
 * not relax or replace the `is_settled = 1` door for a model-0 row.
 *
 * `supported` mirrors {@link embeddedCommission}'s own schema-drift guard
 * ({@link hasCommissionModelColumn}): a fixture that predates the
 * `commission_model` column cannot have model-1 rows at all, so it degrades
 * to the pre-fix `is_settled = 1` alone.
 *
 * Applied to EVERY FS profit-stamp arm (PA-0.1's own enumeration):
 * {@link ProfitRepository.getFinancialSettledByCurrency}, the FS arms inside
 * {@link ProfitRepository.getByUser} / {@link ProfitRepository.getByClient},
 * the base arm of {@link ProfitRepository.getFinancialSettledByProvider}, and
 * {@link ProfitRepository.getByDate}'s `daily_commissions` CTE.
 *
 * L0-4 (Round 2 adversarial pass, documented not changed — owner has not
 * decided otherwise) — a SIDE EFFECT on the Overview's Financial Services
 * card specifically ({@link ProfitRepository.getFinancialSettledByCurrency}
 * + {@link ProfitRepository.getFinancialPendingByCurrency}, the two buckets
 * `ProfitService.getSummary` sums into that card): an unsettled model-1 row
 * that is ALSO CUSTOMER_ACCOUNT-debt-pending is now excluded from BOTH —
 * settled requires `notDebtPending(t.id)` (unchanged, pre-dates PA-0.1) and
 * pending is restricted to model-0 by this same fix — so its revenue/count
 * vanish from the card entirely, though its stamp still correctly reaches
 * `getDeferredProfit` (debt-pending profit was already excluded from
 * "settled" everywhere before this predicate existed, ProfitRepository
 * .debtAccountEntriesExcluded.test.ts). A settled model-0 debt-pending row
 * already behaved identically, so this is CONSISTENT with the pre-existing
 * rule, not a new gap PA-0.1 introduces — just not previously called out for
 * the model-1 case specifically. No code change: flagged here for whoever
 * next touches the Financial Services card's composition to decide whether
 * debt-pending FS revenue should have its own visible bucket there.
 */
export function fsStampRecognized(alias: string, supported: boolean): string {
  return supported
    ? `(${alias}.is_settled = 1 OR ${alias}.commission_model = 1)`
    : `${alias}.is_settled = 1`;
}

/**
 * PA-0.1 Round 2 (L0-1, OWNER_NOTES_2026-09-21.md §6.2 adversarial pass) —
 * rule 14's ONE definition of "is `alias` the REVERSAL row a VOID wrote",
 * as opposed to a REFUND row.
 *
 * `TransactionRepository.voidTransaction` (~:1516-1541) marks the original
 * `VOIDED` and INSERTs a reversal with the SAME `type` as the original,
 * `reverses_id` pointing at it, `amount_usd`/`amount_lbp` negated, and
 * `profit_usd`/`profit_lbp` left un-set (0 default — the INSERT's column
 * list never names them). A REFUND row is a different shape entirely: it
 * keeps `type = 'REFUND'` and DOES carry a negated `profit_usd`/`profit_lbp`
 * stamp, and every call site below already negates it via its own
 * `t.type = 'REFUND'` check — this predicate deliberately excludes REFUND
 * (`<> 'REFUND'`) so it never double-negates that shape.
 *
 * Why a caller needs this at all: `t.amount_usd`/`t.profit_usd` themselves
 * need no extra gate for a void reversal — the INSERT above already negates/
 * zeroes them correctly. But a `financial_services` revenue arm that
 * RE-DERIVES its number from the joined SOURCE row ({@link fsRevenue}, keyed
 * off `fs.price`/`fs.amount`, not `t.amount_usd`) recomputes that SAME
 * positive number a second time for the reversal row — it still joins the
 * SAME, unchanged `financial_services` row the original did — unless the
 * reversal is excluded explicitly (L0-1: a voided model-1 OMT/WHISH
 * transfer showed its full principal as revenue in
 * {@link ProfitRepository.getByUser} / {@link ProfitRepository.getByClient}
 * once {@link fsStampRecognized} stopped requiring `is_settled = 1`).
 * Applied ONLY where a value is re-derived from the source row that way —
 * not pasted onto every `financial_services` arm blindly (rule 14: one
 * predicate, used only where its condition actually applies).
 */
export function isVoidReversalRow(alias: string): string {
  return `${alias}.reverses_id IS NOT NULL AND ${alias}.type <> 'REFUND'`;
}

/**
 * Rule 14 — the ONE place that knows the `financial_services.commission_model`
 * column name and runs the PRAGMA to detect it. Feeds {@link
 * embeddedCommission}'s `supported` argument everywhere the predicate is used
 * (this repository's six commission queries and
 * `FinancialServiceRepository.getAnalytics`) so the rule and its schema-drift
 * guard cannot drift apart.
 *
 * This is a plain, uncached probe — each class wraps it in its OWN private
 * `_hasCommissionModelColumn()` method (kept private/per-class, matching
 * `_suppliersHasCommissionEligibleColumn()`'s precedent of not sharing
 * schema-introspection wrappers across repositories) so call sites keep
 * reading `this._hasCommissionModelColumn()` unchanged; only this repository's
 * wrapper adds memoization (see `_hasCommissionModelColumnCache`) —
 * `FinancialServiceRepository`'s wrapper already only calls this once per
 * `getAnalytics` invocation, so it doesn't need one.
 */
export function hasCommissionModelColumn(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(financial_services)`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === "commission_model");
}

/**
 * Rule 14 — the ONE place that knows the `settlement_commission_allocations`
 * table name and runs the `sqlite_master` probe to detect it (LIRA-158
 * Phase 3). Feeds both this repository's and `FinancialServiceRepository`'s
 * own private, per-class memoized `_hasSettlementAllocationsTable()`
 * wrappers — mirrors {@link hasCommissionModelColumn}'s own precedent
 * immediately above, replacing what used to be two independent copies of
 * the identical `sqlite_master` query (one per class) with a single shared
 * definition. The table only exists from migration v150 onward, and jest
 * fixtures in both files' own test suites (and `ProfitService`'s) hand-roll
 * fresh in-memory schemas that predate it — an unguarded reference throws
 * "no such table" and kills every test in that file's SETUP (the exact trap
 * `reference_test_schema_completeness` names).
 *
 * This is a plain, uncached probe, matching {@link hasCommissionModelColumn}'s
 * own shape — each class wraps it in its OWN private memoized method (same
 * precedent as that function's doc comment) rather than sharing a cache
 * across repository instances, so call sites in both classes keep reading
 * `this._hasSettlementAllocationsTable()` unchanged.
 */
export function hasSettlementAllocationsTable(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settlement_commission_allocations'`,
    )
    .get();
  return !!row;
}

/**
 * LCC-V3 (Round 2) — same `sqlite_master` schema-drift probe as
 * {@link hasSettlementAllocationsTable}, for `exchange_transactions`
 * instead. `getByUser`'s new {@link exchangeProfitForUser} arm (and its
 * orphan-row key source, see that method's own doc comment) are the FIRST
 * unconditional references to `exchange_transactions` from `getByUser`/
 * `getByClient` — several of this file's own jest fixtures for those two
 * methods (e.g. `ProfitRepository.debtAccountEntriesExcluded.test.ts`,
 * `ProfitRepository.rechargeTopupInProfitTxnTypes.test.ts`) hand-roll a
 * schema WITHOUT this table at all (they never needed it before), and an
 * unguarded reference would throw "no such table" and kill every test in
 * those files' SETUP (the exact trap `reference_test_schema_completeness`
 * names). Degrade to excluding the exchange arm entirely when absent —
 * byte-for-byte the pre-LCC-V3 query shape.
 */
export function hasExchangeTransactionsTable(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'exchange_transactions'`,
    )
    .get();
  return !!row;
}

/**
 * Rule 14 — complement of {@link embeddedCommission}: the row IS a genuine
 * AT_SETTLEMENT row (`commission_model = 1`), so its own `commission` column
 * is NOT the truth (see {@link embeddedCommission}'s doc comment for the
 * full rationale) — the real, operator-entered commission does not exist
 * until settlement. D15 (LIRA-158_COMMISSION_REPORTING_PLAN.md §8): a
 * model-1 row's pending commission is UNKNOWABLE until settlement, so the
 * pending surfaces ({@link ProfitRepository.getPendingCommissionTotals},
 * {@link ProfitRepository.getPendingCommissionByProvider}) report a COUNT of
 * these rows instead of a dollar figure — this predicate is what that count
 * filters on.
 *
 * `supported` mirrors {@link embeddedCommission}'s `supported` argument
 * (fed by the same {@link hasCommissionModelColumn} probe), but the
 * degradation is the OPPOSITE literal: a pre-v150 fixture (no
 * `commission_model` column at all) has NO model-1 rows by construction — it
 * predates the column entirely — so the correct degradation is "match
 * nothing" (`"1 = 0"`), not `"1 = 1"`. Returning `"1 = 1"` here would count
 * EVERY pending row on such a fixture as "awaiting settlement", the wrong
 * direction from `embeddedCommission`'s own degradation.
 */
export function atSettlementCommission(
  alias: string,
  supported: boolean,
): string {
  return supported ? `${alias}.commission_model = 1` : "1 = 0";
}

/**
 * Rule 14 — the ONE join shape linking an fs row to ITS current settlement
 * allocation, copied verbatim from `FinancialServiceRepository
 * .getAllByProvider`'s LEFT JOIN (LIRA-158_COMMISSION_REPORTING_PLAN.md
 * §1.4 — "the join shape to extract and reuse"; that method is the one place
 * in the codebase that already reads these two tables together correctly).
 * Matches BOTH `sca.financial_service_id = fs.id` AND
 * `sca.settlement_ledger_id = fs.settlement_id` so a voided-then-resettled
 * fs row can never surface a stale allocation from a settlement it is no
 * longer attached to — matching only the id would let an orphaned old
 * allocation row leak back in. `fsAlias`/`scaAlias` are the aliases used for
 * `financial_services` / `settlement_commission_allocations` in the
 * surrounding query. Callers still need their OWN `sca.tenant_id = ?` bind
 * (tenant scoping is not baked into this shared fragment, matching how
 * every other rule-14 fragment in this file leaves tenant binds to the
 * caller).
 */
export function currentSettlementAllocation(
  fsAlias: string,
  scaAlias: string,
): string {
  return `${scaAlias}.financial_service_id = ${fsAlias}.id AND ${scaAlias}.settlement_ledger_id = ${fsAlias}.settlement_id`;
}

/**
 * D17 (LIRA-158 follow-up, owner decision 2026-08-31) — the SUPPLIER_SETTLEMENT
 * / REFUND profit arm shared by {@link ProfitRepository.getByUser} and
 * {@link ProfitRepository.getByClient}'s `profit_usd`/`profit_lbp` `CASE`
 * expressions (rule 14 — one definition, reused in all FOUR arms — getByUser
 * usd/lbp, getByClient usd/lbp — instead of four hand-copied texts). Before
 * this fix both views fell through to their generic `ELSE t.profit_usd` /
 * `ELSE t.profit_lbp` arm for a settlement row, which stamps the FULL
 * entered commission unconditionally — contradicting D17 (a CASHLESS
 * settlement's commission defers until the client's own debt for the
 * underlying transfer is covered) even though every OTHER profit surface
 * ({@link ProfitRepository.getSupplierCommissionTotals},
 * {@link ProfitRepository.getFinancialSettledByProvider},
 * {@link ProfitRepository.getByDate}, {@link ProfitRepository.getDeferredProfit})
 * was already re-sourced for D17.
 *
 * A BILLS-ONLY batch ({@link cashlessCommissionBatch} false) keeps reading
 * the transaction-level stamp (`t.profit_usd`/`t.profit_lbp`) UNCHANGED —
 * real money, recognised immediately, matching
 * `getSupplierCommissionTotals`'s `billsOnly` bucket byte-for-byte.
 *
 * LCC-V9 (Round 2 adversarial review) — this paragraph used to describe a
 * CASHLESS batch (true) as "re-sourcing ONLY this settlement's OWN
 * allocations… weighted by partnerCoverageRatio… multiplied INSIDE the
 * SUM(...)". That was accurate for the version of this function PA-2.5
 * shipped WITH — it no longer is. PA-2.5's re-attribution (see
 * {@link reattributedSettlementCommission}) replaced that re-sourcing
 * entirely: a CASHLESS batch now contributes a flat `0` HERE (see this
 * function's own body/doc comment immediately below, which already
 * documents the current shape correctly) — every allocation's commission,
 * partner-coverage weighting included, moved to
 * {@link reattributedSettlementCommission}, which owns that SUM and that
 * weighting now. This function's only remaining job is the binary
 * bills-only/cashless SPLIT, not the cashless SUM itself.
 *
 * Degrades to `""` (the WHEN is omitted entirely, so the row falls through
 * to the existing `ELSE`) when `settlement_commission_allocations` doesn't
 * exist (§5): a pre-v150 fixture never had a way to write a cashless
 * allocation in the first place, so there is nothing to classify — matches
 * every other schema-drift degradation in this file. Callers MUST branch
 * their bind-param array on the SAME `hasAllocations` flag used here — but
 * (LCC-V9) this fragment itself embeds ZERO `?` placeholders in EITHER
 * branch (it only calls {@link cashlessCommissionBatch}, which embeds none
 * either); any bind-param bookkeeping a caller does for THIS function
 * specifically is unnecessary — the params `getByUser`/`getByClient` push
 * under `hasAllocations` belong to {@link reattributedSettlementCommission}
 * and {@link keptChangeProfitForKey}, not to this one.
 */
export function supplierSettlementProfitArm(
  hasAllocations: boolean,
  currency: "usd" | "lbp",
): string {
  if (!hasAllocations) return "";
  const profitCol = currency === "usd" ? "t.profit_usd" : "t.profit_lbp";
  return `WHEN t.source_table = 'supplier_ledger' AND t.type IN ('SUPPLIER_SETTLEMENT', 'REFUND') THEN (
              -- PA-2.5 (OWNER_NOTES_2026-09-21.md §6.4) — a CASHLESS batch's
              -- commission used to land HERE, on the settling transaction's
              -- own group (the settling user / no-client "Walk-in" bucket).
              -- It now contributes 0 at this row and is re-attributed to
              -- each allocation's OWN originating FINANCIAL_SERVICE
              -- transaction's user/client instead — see
              -- {@link reattributedSettlementCommission}, added once per
              -- output row at getByUser's/getByClient's own call site (not
              -- here — this arm has no GROUP BY key of its own to add it
              -- to). A bills-only batch is UNCHANGED: it is real money
              -- earned by whoever processed the settlement, not deferred
              -- attribution.
              CASE WHEN NOT (${cashlessCommissionBatch("t.source_id")}) THEN ${profitCol}
              ELSE 0
              END
            )`;
}

/**
 * PA-2.5 (OWNER_NOTES_2026-09-21.md §6.4) — a CASHLESS supplier-settlement
 * commission is earned by whoever created the UNDERLYING financial_services
 * transaction the allocation covers, not by whoever clicked "settle" (see
 * {@link supplierSettlementProfitArm}'s own doc comment, which now zeroes
 * that arm for exactly this reason). This fragment re-attributes each
 * allocation's commission to its own fs row's ORIGINATING
 * FINANCIAL_SERVICE transaction's `user_id`/`client_id`.
 *
 * `matchCondition` is a caller-built SQL boolean deciding whether an
 * originating `ft` row (the allocation's own FINANCIAL_SERVICE transaction,
 * aliased `ft` in this fragment's own FROM) belongs to the CURRENT output
 * row's group. Every row in a SQL GROUP BY group shares the identical group
 * identity, so adding this scalar ONCE to the group's output row (never
 * folded into the row-level `SUM(CASE ...)`, which would multiply it by the
 * group's row count) is the correct way to fold a second,
 * independently-grouped data source into an already-aggregated query
 * without a UNION rewrite.
 *
 * LCC-V1 (Round 2 adversarial review) — `matchCondition` used to be built
 * internally from a single `keyExpr`/`keyColumn` pair, NULL-safely compared
 * with `IS`. That is correct for `getByUser` (`ft.user_id IS
 * COALESCE(orig.user_id, t.user_id)`) because a cashier's output has AT MOST
 * one NULL/no-actor group. It is WRONG for `getByClient`: a walk-in/no-client
 * group's `t.client_id` is NULL for EVERY distinct walk-in name ('Ali',
 * 'Sara', the unnamed one, …), so `ft.client_id IS NULL` matched ALL of them
 * — one client-less cashless allocation's commission landed on EVERY walk-in
 * row, not just its own (measured: a single $12 allocation showed as $12 on
 * three separate walk-in groups, Σ $36 instead of $12). Callers now build
 * their OWN `matchCondition`: `getByUser` still uses the single NULL-safe
 * `IS` comparison (one NULL group only); `getByClient` instead matches on
 * `client_id` when the group is linked, or on the SAME name key its own
 * GROUP BY uses when it is a walk-in group — see that method's own doc
 * comment for the exact expression (mirrors the `pending_profit_*`
 * correlated subqueries' existing `(client_id IS NOT NULL AND … ) OR
 * (client_id IS NULL AND …)` idiom, so this is not a new idiom in this file).
 *
 * Dated by `sca.created_at` (stamped at settlement time, the same moment as
 * the SUPPLIER_SETTLEMENT transaction — `SupplierRepository
 * ._bookCommissionAtSettlement`'s `insertAllocation` loop writes both
 * atomically), not the underlying fs row's own date — this money is
 * recognised AT SETTLEMENT, matching supplierSettlementProfitArm's own
 * recognition timing; only WHO it belongs to changes, not WHEN.
 *
 * Reuses {@link cashlessCommissionBatch}, {@link notRefunded}, and
 * {@link allocationNotDebtPending} verbatim — the SAME gates
 * `supplierSettlementProfitArm`'s cashless branch used before this fix, so
 * the total attributed money (summed across every user/client) is
 * unchanged; only the attribution target moves. Degrades to `"0"` when
 * `settlement_commission_allocations` doesn't exist (§5), matching every
 * other schema-drift degradation in this file, and binds NO params in that
 * case — callers must branch on the SAME `hasAllocations` flag.
 *
 * LCC-V2 (Round 2) — a key with NO row in the main GROUP BY at all (the
 * originating user/client has no OTHER {@link PROFIT_TXN_TYPES} activity in
 * the window) used to lose this money entirely: the scalar is added to an
 * EXISTING output row, and a key with none never got one. `getByUser`/
 * `getByClient` now also call this fragment from a second, "orphan-row"
 * branch (UNION ALL) keyed directly off the reattribution/kept-change
 * source itself — see either method's own doc comment for the full
 * mechanism.
 */
export function reattributedSettlementCommission(
  matchCondition: string,
  currency: "usd" | "lbp",
  hasAllocations: boolean,
): string {
  if (!hasAllocations) return "0";
  const commissionCol =
    currency === "usd" ? "sca.commission_usd" : "sca.commission_lbp";
  return `COALESCE((
              SELECT SUM(${commissionCol} * ${partnerCoverageRatio("financial_services", "sca.financial_service_id")})
              FROM settlement_commission_allocations sca
              JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
              JOIN transactions ft ON ft.source_table = 'financial_services'
                AND ft.source_id = fs.id AND ft.type = 'FINANCIAL_SERVICE'
              WHERE ${allocationRecognitionGates("sca", "fs", "ft")}
                AND ${matchCondition}
            ), 0)`;
}

/**
 * LCC-V7 (Round 2 adversarial review, rule 14) — the ONE definition of "is
 * this transactions row a kept-change source" (a DEBT_REPAYMENT/REFUND row
 * sourced from `debt_ledger`, or a standalone KEPT_CHANGE row). Was
 * hand-copied three times: {@link ProfitRepository.getDebtRepaymentProfit}
 * (a different lane's function — NOT edited here, out of this lane's
 * ownership), `getByDate`'s daily kept-change CTE (same — a different lane's
 * query), and this fragment's own previous inline text.
 *
 * LCC-X8 (Round 3, doc-only correction): BOTH of those other two call sites
 * now call this fragment too (adopted at merge, as this comment originally
 * asked) — `getDebtRepaymentProfit` and `getByDate`'s `daily_kept_change`
 * CTE. There is exactly ONE definition of this predicate in the codebase
 * today, not three; this comment previously kept describing the pre-merge
 * state.
 */
export function keptChangeSource(alias: string): string {
  // LIRA-201c: a standalone KEPT_CHANGE row's own REFUND row (basket
  // reversal, `refundSessionBasket`) carries `source_table = 'customer_sessions'`
  // and `type = 'REFUND'` — NEITHER matches the debt_ledger branch above nor
  // the bare `type = 'KEPT_CHANGE'` branch, so without this third branch a
  // refunded (not voided) kept-change row kept its full profit forever, the
  // exact "REFUND row invisible to the sum" gap the debt_ledger branch's own
  // `type IN (..., 'REFUND')` already avoids for DEBT_REPAYMENT. This mirrors
  // that same shape (match the REFUND row via its `reverses_id` link) rather
  // than widening the debt_ledger branch, so DEBT_REPAYMENT's netting is
  // untouched. A VOIDED kept-change row needs no such branch — `status =
  // 'ACTIVE'` at every call site already drops it.
  return `((${alias}.source_table = 'debt_ledger' AND ${alias}.type IN ('DEBT_REPAYMENT', 'REFUND'))
                     OR ${alias}.type = 'KEPT_CHANGE'
                     OR (${alias}.type = 'REFUND'
                         AND EXISTS (
                           SELECT 1 FROM transactions kcorig
                           WHERE kcorig.id = ${alias}.reverses_id
                             AND kcorig.type = 'KEPT_CHANGE'
                             AND kcorig.tenant_id = ${alias}.tenant_id
                         )))`;
}

/**
 * LCC-M1 (round 4, rule 14) — a kept-change row's `user_id` names the wrong
 * actor for a REFUND. `TransactionRepository`'s generic void/refund path
 * always stamps a REFUND row's OWN `user_id` from the actor who performed
 * the refund, never the original creator (the SAME convention `getByClient`'s
 * PA-2.11 doc comment already documents for a SALE REFUND's `client_id`
 * fallback — "unlike a REFUND row's user_id, always the refunder"). Every
 * OTHER money-attribution scalar in this file that reads a REFUND row's
 * actor (`getByUser`'s own `USER_KEY`, the SALE/FINANCIAL_SERVICE branches
 * via the `orig` join) resolves to the ORIGINAL creator instead — kept
 * change was the one exception, so a DEBT_REPAYMENT created by Alice and
 * refunded by Bob showed Alice's row unaffected (+7 still hers alone) while
 * Bob's OWN row swallowed the -7, breaking "refund attributed to the
 * original seller" and, worse, attributing negative money to someone who
 * never received the +7 in the first place. Measured: Alice read +7.5 (her
 * own +0.5 sale, untouched), Bob read -6.75 (his own +0.25 sale minus the
 * whole -7) instead of Alice +0.5 / Bob +0.25 (net kept-change 0, exactly
 * like {@link keptChangeProfitForKey}'s own SUM across the pair).
 *
 * `alias.reverses_id` is NULL for a non-REFUND kept-change row (a
 * DEBT_REPAYMENT/KEPT_CHANGE row is never itself a reversal), so the
 * correlated subquery returns NULL and `COALESCE` falls through to
 * `alias.user_id` unchanged — this is a no-op for every kept-change row
 * that ISN'T a REFUND, matching this file's own reasoning for why
 * {@link refundOriginalIsProfitEvent}'s REFUND-only branch costs nothing on
 * a non-REFUND row.
 *
 * Deliberately embeds NO `tenant_id` bind (unlike the `orig`/`t2`-style
 * joins elsewhere in this file, which all add `AND <alias>.tenant_id = ?`):
 * `o.id = <alias>.reverses_id` is a lookup by `transactions.id`, a
 * database-wide unique primary key, not a value a cross-tenant collision
 * could ever match — the same reasoning `<origAlias>.id IS NULL` in
 * {@link refundOriginalIsProfitEvent} relies on structurally. Adding a
 * redundant `tenant_id` bind here would only add a THIRD `?` position (this
 * function is substituted at 3 call sites in `getByUser`) to this file's
 * already bind-position-sensitive `params` arrays for no behavioural gain.
 */
function keptChangeAttributedUserId(alias: string): string {
  return `COALESCE((SELECT o.user_id FROM transactions o WHERE o.id = ${alias}.reverses_id), ${alias}.user_id)`;
}

/**
 * LO-V5 (round 2 adversarial review, rule 14) — the ONE definition of "is
 * this transactions row a counterparty-discount profit event" (CQ-10/D1).
 * Was pasted verbatim between {@link ProfitRepository.getCounterpartyDiscountTotals}
 * and `getByDate`'s `daily_discounts` CTE — both now call this instead.
 */
export function counterpartyDiscountSource(alias: string): string {
  return `${alias}.type = 'COUNTERPARTY_DISCOUNT'`;
}

/**
 * LO-V5 (round 2, rule 14) — the ONE definition of "is this transactions row
 * a supplier-settlement profit event" (the source/type half of
 * {@link ProfitRepository.getSupplierCommissionTotals}'s bills-only/degraded
 * predicate — the bills-vs-cashless SPLIT itself stays
 * {@link cashlessCommissionBatch}, applied by each caller separately). Was
 * pasted verbatim across `getSupplierCommissionTotals`'s two branches and
 * `getByDate`'s `daily_bills_commission` CTE — all three now call this.
 */
export function supplierSettlementSource(alias: string): string {
  return `${alias}.source_table = 'supplier_ledger' AND ${alias}.type IN ('SUPPLIER_SETTLEMENT', 'REFUND')`;
}

/**
 * LO-V5 (round 2, rule 14) — the ONE definition of "is this transactions row
 * a top-up/buyback profit event" (PA-2.3). Was pasted verbatim between
 * {@link ProfitRepository.getTopupBuybackProfit} and `getByDate`'s
 * `daily_topup_buyback` CTE — both now call this.
 */
export function topupBuybackSource(alias: string): string {
  return `${alias}.type IN ('TELECOM_CREDIT_BUYBACK', 'RECHARGE_TOPUP')`;
}

/**
 * LCC-V7 (Round 2, rule 14) — the payment-method-fee recognition predicate
 * (PA-2.6): real money kept at the counter the instant it's charged,
 * regardless of whether the underlying transfer's OWN stamp has settled —
 * gated only on {@link notRefunded}, deliberately NOT
 * {@link fsStampRecognized}. Was hand-copied four times inside
 * `getByUser`/`getByClient` (one per currency, per method) plus a fifth,
 * independent copy in `getByDate`'s `daily_pmfee` CTE (a different lane's
 * query, not edited here — it should adopt this fragment at merge).
 *
 * LCC-X3 (Round 3 adversarial review, PA-1.4) — the USD arm used to gate on
 * `fs.currency != 'LBP'`, which lumps EUR (or any other code
 * `currencyCodeSchema` accepts) into the USD bucket — a EUR-denominated
 * transfer's fee showed up as USD. Now reuses this file's ONE existing
 * `usdBucketPredicate(columnRef, strict)` fragment (rule 14 — not a second
 * hand-written `= 'USD'` copy) with `strict = true`, the SAME exact-match
 * convention `getByDate`'s own `daily_pmfee` CTE already switched to for this
 * same PA item. The LBP arm is unchanged — `fs.currency = 'LBP'` was already
 * an exact match, never the lumping bug's target.
 */
export function pmFeeRecognized(
  fsAlias: string,
  currency: "usd" | "lbp",
): string {
  const currencyGate =
    currency === "usd"
      ? usdBucketPredicate(`${fsAlias}.currency`, true)
      : `${fsAlias}.currency = 'LBP'`;
  return `(CASE WHEN ${notRefunded(fsAlias)} AND ${currencyGate} THEN COALESCE(${fsAlias}.payment_method_fee, 0) ELSE 0 END)`;
}

/**
 * PA-2.6 (OWNER_NOTES_2026-09-21.md §6.4) — kept change stamped on
 * DEBT_REPAYMENT / KEPT_CHANGE rows is a DIFFERENT `transactions` row than
 * the one getByUser/getByClient's per-row CASE is summing (never
 * `financial_services`/`sales`). Those two types are deliberately NOT added
 * to {@link PROFIT_TXN_TYPES} — that shared constant also feeds
 * `getDeferredProfit` (a different lane's function under the batch-1..4
 * split in OWNER_NOTES_2026-09-21.md §6.1), so it stays untouched here; this
 * adds the missing source as its own correlated scalar instead, added once
 * per output row exactly like {@link reattributedSettlementCommission}
 * above (see that function's own doc comment for why a plain `SUM` cannot
 * be used here).
 *
 * `matchCondition` is a caller-built SQL boolean, same contract as
 * {@link reattributedSettlementCommission}'s own — see that fragment's LCC-V1
 * doc comment for why a plain NULL-safe `IS` on a single column is correct
 * for `getByUser` but WRONG for `getByClient`'s multiple walk-in groups.
 * LCC-V9 (Round 2): this fragment used to compare with a NULL-unsafe `=`
 * (`kc.${keyColumn} = ${keyExpr}`), which is not merely inconsistent with
 * `reattributedSettlementCommission`'s `IS` — for `getByClient`'s walk-in
 * case specifically, `keyExpr` (`t.client_id`) is NULL, and `col = NULL` is
 * never TRUE in SQL, so a walk-in client's kept change was silently dropped
 * outright (0 rows even matched) rather than merely mis-grouped. Both
 * `getByUser`/`getByClient` now build the SAME `matchCondition` shape they
 * already build for `reattributedSettlementCommission` (see either method's
 * own doc comment).
 *
 * Mirrors `getDebtRepaymentProfit`'s own source predicate via
 * {@link keptChangeSource} (kept intentionally un-exported from that method
 * and un-shared with it — editing that method is out of this lane's
 * ownership, so this stays a fresh, independent call to the SAME extracted
 * fragment, not an edit to it).
 */
export function keptChangeProfitForKey(
  matchCondition: string,
  currency: "usd" | "lbp",
): string {
  const profitCol = currency === "usd" ? "profit_usd" : "profit_lbp";
  return `COALESCE((
              SELECT SUM(kc.${profitCol})
              FROM transactions kc
              WHERE ${keptChangeRecognitionGates("kc")}
                AND ${matchCondition}
            ), 0)`;
}

/**
 * PA-3.1/LO-V1 (round 2 adversarial review, OWNER_NOTES_2026-09-21.md §6) —
 * a `transactions` row's profit stamp can carry BOTH currencies at once:
 * `profit_<own>` is the row's OWN margin/commission, kept in its native
 * currency; `profit_<other>` is kept change handed back in the OTHER
 * currency on the SAME row (e.g. a USD recharge paid with cash that needed
 * LBP change — the recharge's margin stamps `t.profit_usd`, the change
 * stamps `t.profit_lbp`; `RechargeRepository.ts` ~:780,
 * `FinancialServiceRepository.ts` ~:2158, `LotoTicketRepository.ts` ~:190).
 * Every per-currency query in this file used to pick only the row's OWN
 * currency column and silently drop the other — a USD recharge's 45,000 LBP
 * kept change showed 0 LBP everywhere (Overview, By Module, By Date). ONE
 * pair of fragments (rule 14), reused by every module query that buckets a
 * profit stamp by a currency column: `currencyExpr` is the CASE discriminant
 * that same query already uses for its OWN-currency columns (e.g.
 * `r.currency_code`, `fs.currency`), and `profitAlias` is the transactions
 * table's join alias (always `t` in this file's joins).
 *
 * Deliberately exposed as a SEPARATE `kept_change_usd`/`kept_change_lbp`
 * output, never silently folded into `profit_usd`/`profit_lbp` — a row's
 * `profit_*` keeps meaning "this module's own margin", so nothing that
 * already reads it changes shape, and the Kept Change card gets a real
 * number to render instead of an invisible one (LO-V1: sales already folds
 * kept change into `profit_lbp` with no separate figure, which is exactly
 * why it "reaches gross but renders on no card").
 */
export function otherCurrencyKeptChangeUsd(
  currencyExpr: string,
  profitAlias = "t",
): string {
  // The row's OWN currency is LBP -> its OTHER-currency stamp is profit_usd.
  return `CASE WHEN ${currencyExpr} = 'LBP' THEN ${profitAlias}.profit_usd ELSE 0 END`;
}
export function otherCurrencyKeptChangeLbp(
  currencyExpr: string,
  profitAlias = "t",
): string {
  // The row's OWN currency is USD (exact match, PA-1.4) -> its
  // OTHER-currency stamp is profit_lbp.
  return `CASE WHEN ${currencyExpr} = 'USD' THEN ${profitAlias}.profit_lbp ELSE 0 END`;
}

/**
 * LO-R4-residual (round 4, OWNER_NOTES_2026-09-21.md §6, rule 14) — the
 * "own-currency" selector `getFinancialSettledByCurrency`,
 * `getFinancialPendingByCurrency`, `getMobileServicesByCurrency` and
 * `getRechargesByCurrency` each hand-copied into both their SELECT and
 * HAVING: project a transactions row's profit stamp onto the SAME currency
 * as the query's own `currencyExpr` grouping column — an LBP-grouped row
 * picks `profit_lbp`, everything else picks `profit_usd`. Four independent
 * copies of one rule is exactly what rule 14 says not to paste twice, let
 * alone four times; extracted here so the four call sites can't drift from
 * each other. The `ELSE` is deliberately kept INCLUSIVE (not an exact 'USD'
 * match) — unlike {@link otherCurrencyKeptChangeUsd}/{@link
 * otherCurrencyKeptChangeLbp}, this is byte-for-byte the same fold all four
 * call sites already used; narrowing it is out of scope for this
 * extraction (each call site already restricts its own currency grouping
 * to the known set before this fragment ever runs).
 */
export function ownCurrencyProfit(
  currencyExpr: string,
  profitAlias = "t",
): string {
  return `CASE WHEN ${currencyExpr} = 'LBP' THEN ${profitAlias}.profit_lbp ELSE ${profitAlias}.profit_usd END`;
}

/**
 * LO-V2 (round 2 adversarial review, PA-2.8) — the ONE recognition gate for
 * a financial-service PROVIDER row (By Module / By Date), replacing the
 * inline `(fs.provider IN (MOBILE_PROVIDERS) OR fsStampRecognized(...))`
 * that was hand-copied between {@link ProfitRepository.getFinancialSettledByProvider}
 * and `getByDate`'s `daily_commissions` CTE — and, unlike that inline copy,
 * ALSO restricted to the KNOWN provider set (`MOBILE_PROVIDERS ∪
 * COMMISSION_PROVIDERS`) so a provider outside the 8 hard-coded codes is
 * excluded here the same way it already is excluded on the Overview
 * ({@link ProfitRepository.getFinancialSettledByCurrency}'s own
 * `provider IN (COMMISSION_PROVIDERS)` restriction,
 * {@link ProfitRepository.getMobileServicesByCurrency}'s own
 * `provider IN (MOBILE_PROVIDERS)` restriction). Before this fix, an
 * unknown provider (e.g. a misconfigured or future integration coded
 * 'SUYOOL') with `commission_model = 1` passed the bare `fsStampRecognized`
 * gate and showed a profit on By Module the Overview had no bucket for at
 * all (probe: $4 vs $0).
 */
function fsProviderRowRecognized(
  alias: string,
  hasCommissionModelColumn: boolean,
): string {
  return `((${alias}.provider IN (${MOBILE_PROVIDERS}))
        OR (${alias}.provider IN (${COMMISSION_PROVIDERS}) AND ${fsStampRecognized(alias, hasCommissionModelColumn)}))`;
}

/** Exchange leg profit (v30+): leg1 + leg2, NULL-safe. */
const EXCHANGE_LEG_PROFIT =
  "COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0)";

/**
 * LCC-V3 (Round 2 adversarial review, PA-2.6) — `getByUser`'s own caption
 * used to say exchange profit was "not attributable to a single cashier",
 * which is false: `ExchangeRepository.createTransaction` stamps the unified
 * transaction row's `user_id` from `createdBy` for every exchange (the
 * EXCHANGE row itself is simply not one of {@link PROFIT_TXN_TYPES}, so
 * `getByUser`'s per-row CASE never iterates it — the SAME "different source
 * row" shape as {@link keptChangeProfitForKey}). Only `getByClient` has a
 * genuine reason to exclude it: `ExchangeRepository.createTransaction` sets
 * `client_name` but never `client_id` on an exchange row, so a by-CLIENT
 * attribution would misattribute every exchange's profit onto the walk-in
 * bucket — that exclusion (and its caption) stays.
 *
 * Reuses {@link EXCHANGE_LEG_PROFIT}, {@link notRefunded}, {@link dateRange},
 * and {@link partnerCoverageRatio} — the SAME recognition gates
 * {@link ProfitRepository.getExchangeTotals} applies to the Overview's own
 * Exchange card (rule 14), so a shop's total exchange profit, summed across
 * every cashier row this adds, equals that card's total exactly (proportional
 * partner recognition included). `userKeyExpr` is the SAME GROUP BY key
 * `getByUser` already uses — added once per output row, the same "second,
 * independently-grouped data source folded in via a scalar" shape as
 * {@link reattributedSettlementCommission}/{@link keptChangeProfitForKey}
 * (see either's own doc comment for why a plain `SUM` cannot be used here).
 * USD-only (no LBP branch): `exchange_transactions` carries no LBP-scale
 * profit column of its own — matches {@link getExchangeTotals}, which is
 * also USD-only (PA-4.11 captions this).
 *
 * Degrades to `"0"` when `exchange_transactions` doesn't exist (§5) — see
 * {@link hasExchangeTransactionsTable}'s own doc comment — matching every
 * other schema-drift degradation in this file; binds NO params in that case
 * and callers must branch on the SAME `hasExchangeTable` flag, exactly like
 * `hasAllocations` gates {@link reattributedSettlementCommission}.
 */
export function exchangeProfitForUser(
  userKeyExpr: string,
  hasExchangeTable: boolean,
): string {
  if (!hasExchangeTable) return "0";
  return `COALESCE((
              SELECT SUM((${EXCHANGE_LEG_PROFIT}) * ${partnerCoverageRatio("exchange_transactions", "ext.id")})
              FROM exchange_transactions ext
              JOIN transactions et ON et.source_table = 'exchange_transactions'
                AND et.source_id = ext.id AND et.type = 'EXCHANGE'
              WHERE et.user_id IS ${userKeyExpr}
                AND ${exchangeRecognitionGates("ext", "et")}
            ), 0)`;
}

/**
 * LCC-X4 (Round 3 adversarial review, PA-4.19) — the COUNT twin of
 * {@link keptChangeProfitForKey}: how many kept-change events this SAME
 * `matchCondition`/window contributed to `profit_usd`/`profit_lbp`, so
 * `recognized_transaction_count` (the "Avg Profit/Txn" denominator) grows by
 * exactly the rows whose money {@link keptChangeProfitForKey} already added —
 * neither more (which would understate the average) nor fewer (which is the
 * bug this fixes: `getByUser`/`getByClient` used to add kept change to the
 * numerator via {@link keptChangeProfitForKey} without ever adding a matching
 * count to the denominator, inflating the average for any cashier/client with
 * kept-change activity). A zero-stamped row contributes nothing to the
 * numerator, so it is excluded here too — counting it would dilute the
 * average for zero added profit, the mirror-image defect.
 *
 * LCC-M1 (round 4) — additionally restricted to `kc.type IN
 * ('DEBT_REPAYMENT', 'KEPT_CHANGE')`, matching `getDebtRepaymentProfit`'s
 * own convention (that method's `count` counts only the repayments
 * themselves, never their REFUND rows — see its doc comment). A kept-change
 * REFUND is a NEGATING event for an already-counted original, not a second
 * distinct profit-bearing event, so counting it a second time here inflated
 * the "Avg Profit/Txn" denominator for a voided/refunded kept-change entry.
 */
export function keptChangeRecognizedCount(matchCondition: string): string {
  return `COALESCE((
              SELECT COUNT(*)
              FROM transactions kc
              WHERE ${keptChangeRecognitionGates("kc")}
                AND kc.type IN ('DEBT_REPAYMENT', 'KEPT_CHANGE')
                AND ${matchCondition}
                AND (kc.profit_usd <> 0 OR kc.profit_lbp <> 0)
            ), 0)`;
}

/**
 * LCC-X4 (Round 3, PA-4.19) — the COUNT twin of
 * {@link exchangeProfitForUser}, same rationale as
 * {@link keptChangeRecognizedCount} immediately above: `getByUser`'s
 * `profit_usd`/`profit_lbp` already sums exchange profit via
 * `exchangeProfitForUser` for every cashier row, but nothing ever added a
 * matching count — a cashier with one $2 sale and fifty $5 exchanges showed
 * "Avg Profit/Txn" of $252 (profit ÷ 1) instead of ≈$5. `getByClient` has no
 * caller for this (exchange rows carry no `client_id` — see
 * `exchangeProfitForUser`'s own doc comment). Excludes a zero-profit exchange
 * leg pair, matching `keptChangeRecognizedCount`'s convention.
 */
export function exchangeRecognizedCount(
  userKeyExpr: string,
  hasExchangeTable: boolean,
): string {
  if (!hasExchangeTable) return "0";
  return `COALESCE((
              SELECT COUNT(*)
              FROM exchange_transactions ext
              JOIN transactions et ON et.source_table = 'exchange_transactions'
                AND et.source_id = ext.id AND et.type = 'EXCHANGE'
              WHERE et.user_id IS ${userKeyExpr}
                AND ${exchangeRecognitionGates("ext", "et")}
                AND (${EXCHANGE_LEG_PROFIT}) <> 0
            ), 0)`;
}

/**
 * LCC-X4 (Round 3, PA-4.19) — the COUNT twin of
 * {@link reattributedSettlementCommission}, same rationale as
 * {@link keptChangeRecognizedCount}: a cashless settlement-commission
 * allocation's money is added to `profit_usd`/`profit_lbp` once per
 * allocation row, so this counts the SAME allocation rows (gated identically)
 * rather than re-deriving a different row set. Excludes a zero-commission
 * allocation (both currencies), matching the other two COUNT twins'
 * convention.
 */
export function reattributedSettlementRecognizedCount(
  matchCondition: string,
  hasAllocations: boolean,
): string {
  if (!hasAllocations) return "0";
  return `COALESCE((
              SELECT COUNT(*)
              FROM settlement_commission_allocations sca
              JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
              JOIN transactions ft ON ft.source_table = 'financial_services'
                AND ft.source_id = fs.id AND ft.type = 'FINANCIAL_SERVICE'
              WHERE ${allocationRecognitionGates("sca", "fs", "ft")}
                AND ${matchCondition}
                AND (sca.commission_usd <> 0 OR sca.commission_lbp <> 0)
            ), 0)`;
}

/**
 * Rule 14 — the ONE definition of "this exchange row's USD-denominated
 * notional" for revenue reporting. Owner ticket 2026-09-23 (#27): both call
 * sites below used to sum `amount_in` unconditionally, but `amount_in` is
 * denominated in `from_currency` — for a client selling LBP for USD
 * (`from_currency = 'LBP'`, the shop's own base pair), `amount_in` is an
 * LBP-scale figure (e.g. 8,950,000) that landed straight in `revenue_usd`
 * wearing a `$` sign. Reproduced directly (see
 * `ProfitRepository.exchangeCurrencyBlindRevenue.test.ts`): a single
 * LBP->USD row inflated `gross_revenue_usd` by ~89,000x its real dollar
 * value.
 *
 * Fix: use whichever leg is ALREADY denominated in USD — `amount_in` when
 * `from_currency = 'USD'`, `amount_out` when `to_currency = 'USD'` (covers
 * the shop's two dominant directions, USD->LBP and LBP->USD, and every
 * cross-currency trade that routes through USD per `via_currency`). A
 * direct exotic<->exotic leg with NEITHER side USD (e.g. LBP<->EUR with no
 * USD anchor) has no USD figure recorded on this row at all — rather than
 * inventing one from a foreign-currency amount (the exact bug being fixed),
 * it contributes 0 to `revenue_usd`. This is a known, bounded
 * under-count for that rare shape, not a fabricated conversion (rule 8).
 *
 * `supported` degrades to the OLD (buggy) `amount_in`-only behavior when
 * `from_currency`/`to_currency` aren't present on the row — same schema-
 * drift precedent as {@link embeddedCommission}, so the many jest fixtures
 * across this repo's test suite that hand-roll a trimmed
 * `exchange_transactions` table (no currency columns, single-currency USD
 * scenarios only) are byte-for-byte unaffected.
 */
function exchangeUsdRevenue(alias: string, supported: boolean): string {
  if (!supported) return `${alias}.amount_in`;
  return `CASE WHEN ${alias}.from_currency = 'USD' THEN ${alias}.amount_in
               WHEN ${alias}.to_currency = 'USD' THEN ${alias}.amount_out
               ELSE 0 END`;
}

/**
 * Rule 14 — the ONE place that knows the `exchange_transactions.from_currency`
 * column name and runs the PRAGMA to detect it. Feeds {@link
 * exchangeUsdRevenue}'s `supported` argument at both call sites (
 * {@link ProfitRepository.getExchangeTotals} and {@link
 * ProfitRepository.getByDate}'s `daily_exchange` CTE) so the rule and its
 * schema-drift guard cannot drift apart — same shape as
 * {@link hasCommissionModelColumn}.
 */
export function hasExchangeCurrencyColumns(db: Database.Database): boolean {
  const cols = db
    .prepare(`PRAGMA table_info(exchange_transactions)`)
    .all() as { name: string }[];
  return cols.some((c) => c.name === "from_currency");
}

/**
 * PA-4.23 (a) — the ONE place that knows the three columns
 * {@link ProfitRepository.getSalesRevCost}'s net-of-discount/refund query
 * needs (`sales.discount_usd`, `sales.total_amount_usd`,
 * `sale_items.refunded_quantity`) and runs the PRAGMA to detect them — same
 * shape as {@link hasCommissionModelColumn}/{@link hasExchangeCurrencyColumns}.
 * All three have been core schema columns since early migrations
 * (create_db.sql, migration #44 `add_refunded_quantity_to_sale_items`) and
 * every real database has them; this guard exists ONLY because ~10 of this
 * repo's own jest fixtures (and `ProfitService`'s) hand-roll a minimal
 * `sales`/`sale_items` schema for an unrelated assertion and never added
 * these three columns (`reference_test_schema_completeness` — an unguarded
 * reference would throw "no such column" and kill the whole file in SETUP).
 * Degrades to the pre-fix gross query (unchanged byte-for-byte) when absent.
 */
export function hasSaleDiscountAndRefundQuantityColumns(
  db: Database.Database,
): boolean {
  const salesCols = db.prepare(`PRAGMA table_info(sales)`).all() as {
    name: string;
  }[];
  const saleItemsCols = db.prepare(`PRAGMA table_info(sale_items)`).all() as {
    name: string;
  }[];
  return (
    salesCols.some((c) => c.name === "discount_usd") &&
    salesCols.some((c) => c.name === "total_amount_usd") &&
    saleItemsCols.some((c) => c.name === "refunded_quantity")
  );
}

/**
 * PFU-a-1 (verifier round-1 fix) — rule 14 extraction of the discount
 * pro-ration FORMULA {@link ProfitRepository.getSalesRevCost} introduced
 * (PA-4.23 (a)): a sale's discount, allocated by the REMAINING share of the
 * pre-discount total (same denominator `SalesRepository.refundSaleItem`
 * already uses for its own discount give-back — see `getSalesRevCost`'s own
 * doc comment for the full rationale). Applies to one row shaped like
 * `getSalesRevCost`'s own `sale_agg` CTE (`remaining_revenue`,
 * `discount_usd`, `total_amount_usd` columns) — multiply by `weight`
 * (partner coverage) and `SUM(...)` (one aggregate) or
 * `GROUP BY date(created_at, 'localtime')` (a per-day series) at the call
 * site; this fragment only computes the per-sale net revenue expression.
 *
 * Deliberately NOT a full CTE-generating fragment: this file's own
 * `sqlQueryUnits.ts` guard (`embeddedCommission.guard.test.ts`,
 * `profitRecognition.guard.test.ts`) statically scans EACH `.prepare()`
 * template's literal SOURCE TEXT for a `name AS (` CTE boundary — it does
 * NOT evaluate `${...}` interpolations, so hiding a CTE's own opening
 * (`sale_agg AS (`) behind a function call breaks that scan ("a query
 * starts with WITH but no CTE was found"), a real regression this fix hit
 * and reverted. A CTE's own `name AS (...)` therefore stays literal at
 * every `.prepare()` call site (`getSalesRevCost` below, `getByDate`'s
 * `daily_sales` CTE, and `getByUser`/`getByClient`'s SALE-row revenue
 * branch via {@link saleRevenueUsdCaseBranch} below — REV lane, 2026-09-24,
 * PA-4.23 a parity, closing the adoption this comment used to describe as
 * future work) — only the FORMULA inside it is shared.
 */
export function netSaleRevenueExpr(): string {
  return `(remaining_revenue - COALESCE(discount_usd, 0) * (
              CASE WHEN COALESCE(total_amount_usd, 0) > 0
                   THEN remaining_revenue * 1.0 / total_amount_usd
                   ELSE 0 END
            ))`;
}

/**
 * REV-V1 (verifier round-1 fix, 2026-09-24) — rule 14's ONE definition of
 * the per-sale aggregate BODY every sale revenue/cost query groups by: which
 * sale lines count (an ACTIVE, `status = 'completed'` sale; an un-refunded
 * line) plus the per-sale `total_amount_usd`/`discount_usd`/`weight`/
 * `remaining_revenue`/`remaining_cost` columns {@link netSaleRevenueExpr}'s
 * formula consumes. `getSalesRevCost`'s `sale_agg` CTE, `getByDate`'s
 * `daily_sale_agg` derived subquery, and {@link saleRevenueUsdCaseBranch}'s
 * net-columns subquery all call this now instead of each hand-pasting the
 * same body — the drift that closes: `saleRevenueUsdCaseBranch` used to omit
 * the `status = 'completed'` gate entirely, so voiding a sale (which sets
 * `sales.status = 'cancelled'` but never touches `sale_items`) left its
 * void-reversal row — still `type = 'SALE'`, per {@link isVoidReversalRow}'s
 * doc comment, and NOT excluded by this branch's own `t.type = 'SALE'` check
 * — re-deriving the sale's full, un-negated net figure from the UNCHANGED
 * `sales`/`sale_items` rows, while `getSalesRevCost`/`getByDate` (both
 * already gated) correctly read 0. Measured: a $90 discounted sale, voided —
 * Overview/By Date revenue read 0, By Cashier/By Client read 90.
 *
 * Each call site keeps its own literal CTE/subquery OPENING (`sale_agg AS (`,
 * the `daily_sale_agg` derived subquery's own alias, the scalar branch's own
 * `FROM (`) per {@link netSaleRevenueExpr}'s doc comment above — the static
 * `sqlQueryUnits.ts` guard needs a literal `name AS (` at the `.prepare()`
 * call site itself, so only this function's BODY text is shared, never the
 * boundary syntax around it.
 *
 * `extraSelectCols` lets a caller prepend its own grouping/correlation
 * columns (getByDate's `DATE(s.created_at, 'localtime') AS d,`;
 * getSalesRevCost's `s.id AS sale_id, s.created_at AS created_at,`) ahead of
 * the shared columns below — pass `""` for none (saleRevenueUsdCaseBranch
 * needs none: it correlates via `extraWhere`'s `s2.id = t.source_id`
 * instead of a GROUP BY column). `extraWhere` lets a caller AND its own
 * extra predicate (a date range + tenant binds, or a `source_id` correlation
 * + tenant binds) onto the shared `status = 'completed' AND is_refunded = 0`
 * gate this function owns — pass `"1=1"` for none.
 */
function saleAggBody(
  salesAlias: string,
  saleItemsAlias: string,
  extraSelectCols: string,
  extraWhere: string,
): string {
  return `SELECT
            ${extraSelectCols}
            ${salesAlias}.total_amount_usd AS total_amount_usd,
            ${salesAlias}.discount_usd AS discount_usd,
            (${saleRecognitionWeight(salesAlias)}) AS weight,
            SUM(${saleItemsAlias}.sold_price_usd * (${saleItemsAlias}.quantity - ${saleItemsAlias}.refunded_quantity)) AS remaining_revenue,
            SUM(${saleItemsAlias}.cost_price_snapshot_usd * (${saleItemsAlias}.quantity - ${saleItemsAlias}.refunded_quantity)) AS remaining_cost
          FROM sales ${salesAlias}
          JOIN sale_items ${saleItemsAlias} ON ${saleItemsAlias}.sale_id = ${salesAlias}.id
          WHERE ${salesAlias}.status = 'completed'
            AND ${saleItemsAlias}.is_refunded = 0
            AND ${extraWhere}
          GROUP BY ${salesAlias}.id`;
}

/**
 * REV lane (2026-09-24, PA-4.23 a parity) — `getByUser`/`getByClient`'s
 * counterpart of `getSalesRevCost`'s own discount/refund fix, extracted once
 * (rule 14) and called at both sites. A SALE-typed transaction row's
 * `revenue_usd` contribution, net of discount and refunded quantities via
 * {@link netSaleRevenueExpr}'s SAME formula.
 *
 * Both call sites attribute a REFUND row to the identical output group as
 * its original SALE — `getByUser`'s `COALESCE(orig.user_id, t.user_id)`,
 * `getByClient`'s client_id/CLIENT_NAME_KEY match — via the PA-2.11 `orig`
 * join (a REFUND's `t.source_id` already points at the SAME original sale
 * `s2` the SALE row itself joins). So this returns the sale's ENTIRE net
 * figure on the `t.type = 'SALE'` arm and `0` on the `t.type = 'REFUND'`
 * arm — the refunded quantity is already subtracted inside the net formula
 * (read straight off `sale_items.refunded_quantity`), not off the REFUND
 * transaction's own gross `amount_usd` a second time — and the caller's
 * `SUM(...)` over both rows still lands in the correct group.
 *
 * REV-V1/REV-V3 (verifier round-1 fixes, 2026-09-24): the net variant now
 * (a) shares {@link saleAggBody} with `getSalesRevCost`/`getByDate`, closing
 * the `status = 'completed'` gap that let a VOIDED sale's reversal row keep
 * contributing its full net figure (see `saleAggBody`'s own doc comment for
 * the measured defect this closes), and (b) wraps the per-row CASE in
 * `SUM(...)`/`COALESCE(..., 0)` instead of selecting it directly off a
 * scalar `FROM (...)`. That second change fixes a SEPARATE regression the
 * first one would otherwise introduce: `s2.id = t.source_id` matches AT MOST
 * one row, so the inner subquery returns either exactly one row or NONE at
 * all (a fully item-refunded sale already returned none pre-fix too — every
 * `si2.is_refunded = 0` row is filtered out — and the new `status =
 * 'completed'` gate adds a second way to get zero rows: a void, or a
 * whole-sale refund via `TransactionRepository.refundTransaction`, which
 * sets `sales.status = 'refunded'`). A bare scalar `SELECT expr FROM
 * (0-row subquery)` evaluates to SQL NULL, not 0 — measured: after a
 * whole-sale refund, `getByUser`/`getByClient` emitted `revenue_usd: null`
 * (typed `number`) for a user/client whose only window activity was that
 * sale. `SUM(...)` over 0-or-1 rows plus the outer `COALESCE(..., 0)`
 * degrades cleanly to 0 instead — and is a no-op on the 1-row case (`SUM` of
 * one value is that value), so every non-void, non-fully-refunded sale's
 * figure is byte-identical to before.
 *
 * Two variants, chosen by the caller's OWN `hasSaleDiscountAndRefundQuantityColumns()`
 * memoized check (the same gate `getSalesRevCost` uses — not re-probed here
 * to avoid a second, un-memoized PRAGMA per call): `hasNetCols = false`
 * returns the gross expression (one `?` for `s2.tenant_id`, now also gated
 * on `s2.status = 'completed'` for the SAME void-parity reason, and wrapped
 * in the SAME `SUM(...)`/`COALESCE(..., 0)` shape); `hasNetCols = true`
 * returns the net expression (a SECOND `?` for its own `sale_items
 * si2.tenant_id`) — callers push one extra tenantId param when `hasNetCols`
 * is true (see each call site's own params comment). Neither variant's `?`
 * count/order changed by this fix — only the WHERE/wrapping shape did.
 */
function saleRevenueUsdCaseBranch(hasNetCols: boolean): string {
  if (!hasNetCols) {
    return `SELECT COALESCE(SUM((CASE WHEN t.type = 'SALE'
                         THEN s2.final_amount_usd
                         ELSE t.amount_usd END) * ${saleRecognitionWeight("s2")}), 0)
            FROM sales s2 WHERE s2.id = t.source_id AND s2.status = 'completed' AND s2.tenant_id = ?`;
  }
  return `SELECT COALESCE(SUM(CASE WHEN t.type = 'SALE'
               THEN (${netSaleRevenueExpr()}) * weight
               ELSE 0 END), 0)
          FROM (
            ${saleAggBody("s2", "si2", "", "s2.id = t.source_id AND s2.tenant_id = ? AND si2.tenant_id = ?")}
          )`;
}

/**
 * Providers that represent OMT/WHISH-style commission financial services.
 * LC-3 (round 2, rule 14) — this used to be a second, hand-copied spelling of
 * `constants/commissionProviders.ts`'s `COMMISSION_PROVIDERS` list (that
 * module's own doc comment names this exact duplication and asks whichever
 * lane next has permission here to collapse it). Now a thin alias of the
 * shared `COMMISSION_PROVIDERS_SQL_LIST` export — one definition, reused.
 */
const COMMISSION_PROVIDERS = COMMISSION_PROVIDERS_SQL_LIST;

/**
 * Providers that represent cost/price mobile services. Spellings must match the
 * stored `financial_services.provider` values exactly — the schema CHECK
 * constraint allows 'Katsh' (not 'KATCH'), and SQLite's IN is case-sensitive:
 * a 'KATCH' entry here silently matched zero rows, hiding every Katsh sale's
 * profit from the overview. Guarded by ProfitService.transactionBased test (e).
 *
 * RULE14-DUP (round-1 chart-lane review, OWNER_NOTES_2026-09-21.md §7.1):
 * `SalesRepository.getChartData`'s "Sales" series needed this exact same
 * provider set and, unable to touch this file under the shared-tree
 * protocol at the time, hand-copied it as its own private
 * `TELECOM_ITEM_PROVIDERS_SQL` literal — this module's own doc comment
 * named that exact duplication and asked whichever lane next had
 * permission here to collapse it. Now a thin alias of the shared
 * `MOBILE_SERVICE_PROVIDERS_SQL_LIST` export — one definition, reused
 * (mirrors `COMMISSION_PROVIDERS` immediately above).
 */
const MOBILE_PROVIDERS = MOBILE_SERVICE_PROVIDERS_SQL_LIST;

/**
 * Internal/system payment flows excluded from the per-method profit view.
 * `LINE_CREDIT` (LIRA-145) is here for a different reason than the rest: the
 * ORIGINAL `Line_Usage` expense leg is already invisible to this view (it's
 * negative, and `getPaymentMethodRows` filters `p.amount > 0`), but
 * `TransactionRepository._reversePayments` mirrors every leg with `-p.amount`
 * on void, so voiding a line-usage expense writes a POSITIVE `LINE_CREDIT`
 * leg that WOULD otherwise surface as a bogus payment-method row.
 * `LINE_CREDIT` is not a registered payment method — it's a bookkeeping
 * label for credits the shop already owned.
 *
 * PA-3.5 (OWNER_NOTES_2026-09-21.md §6.5): this list had drifted from
 * `TransactionRepository.INTERNAL_LEG_METHODS` — missing TRANSFER,
 * DRAWER_TRANSFER, CREDIT_RETURN, CREDIT_USED, SMS_COST, PM_FEE — so voiding
 * an expense/payout posted through any of THOSE methods wrote a mirrored
 * POSITIVE reversal leg (same mechanism as the `LINE_CREDIT` case above)
 * that surfaced as its own bogus payment-method row (raw `PM_FEE` rows kept
 * voided fees this way). Built from that ONE shared, exported Set (rule 14)
 * instead of a second hand-copied literal that can drift again, unioned with
 * the provider-name markers below.
 *
 * Owner decision 2 (2026-09-24, OWNER_NOTES_2026-09-21.md §6.5): a sale a
 * CUSTOMER pays for via their OMT Wallet / Whish Wallet / Binance — real,
 * active `payment_methods.code` values a customer genuinely can tender —
 * MUST appear under that method now; the provider's OWN transfer/stock legs
 * stay excluded, but separated by DRAWER and internal method marker (see
 * `providerStockDrawersSql`/`INTERNAL_LEG_METHODS`'s `OMT_APP`/`WHISH_APP`/
 * `RESERVE`/`TRANSFER` entries — a customer's own tender always posts with
 * method `OMT`/`WHISH`/`BINANCE` against drawer `OMT_App`/`Whish_App`/
 * `Binance`, while every internal wallet-side/reserve/transfer leg posts
 * under a DIFFERENT method marker, never the bare provider code — grep
 * confirms no call site ever writes `method: "OMT"|"WHISH"|"BINANCE"` as an
 * internal marker), never by a blanket method-code exclusion. `OMT`/
 * `WHISH`/`BINANCE` are therefore REMOVED from this list (they used to be
 * blanket-excluded, hiding every customer wallet payment from this tab).
 *
 * `BOB`/`iPick`/`Katsh` stay excluded: they are mobile SERVICE-PROVIDER
 * codes (`service_providers.code`), never seeded into `payment_methods` —
 * TenantRepository.seedPaymentMethods only ever seeds CASH/OMT/WHISH/
 * BINANCE/CUSTOMER_ACCOUNT/GIFT_CARD — so a customer can never literally
 * tender "iPick"; any leg carrying one of these three as its `method` is
 * necessarily an internal commission/cost marker
 * (`FinancialServiceRepository`/`SupplierRepository` write these), and the
 * blanket exclusion for them is unchanged by this fix.
 */
const PAYMENT_REPORT_PROVIDER_MARKERS = ["BOB", "iPick", "Katsh"];
/**
 * LPAY-V3 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3): methods
 * that are internal/non-customer-facing for THIS report only — never added
 * to `TransactionRepository.INTERNAL_LEG_METHODS` (the shared set), because
 * that Set also gates the LIRA-078 refund-tender-override money path via
 * `isOverridableLeg`, and a reporting-only fix must not change money-path
 * behaviour (this lane's own invariant). `"WALLET_EXCHANGE"` (both legs of a
 * `WalletExchangeRepository` conversion — the shop converting its own
 * OMT_App/Whish_App wallet currency, never a customer) used to live in the
 * shared set; see `TransactionRepository.ts`'s comment on the same removal
 * and `TransactionRepository.walletExchangeRefundOverride.test.ts` for the
 * verified proof the move is behavior-neutral for the refund-override path.
 */
const PAYMENT_REPORT_ONLY_EXCLUSIONS = ["WALLET_EXCHANGE"];
/**
 * Lazily computed (NOT a top-level `const`): `TransactionRepository.ts` and
 * `ProfitRepository.ts` sit in the same require cycle
 * (TransactionRepository → FinancialServiceRepository → ProfitRepository,
 * `isPendingSupplierSettlement`/`embeddedCommission` et al.), so reading
 * `INTERNAL_LEG_METHODS` at ProfitRepository's own module-top-level runs
 * WHILE `TransactionRepository.ts` is still mid-initialization — its export
 * exists as a binding but the `Set` hasn't been assigned yet, so spreading it
 * throws "is not iterable" the instant any file requires the cycle. Deferring
 * the read into a function (called only once `getPaymentMethodRows()` runs,
 * long after every module in the cycle has finished loading) keeps this a
 * single shared source (rule 14) without re-triggering the cycle. Memoized
 * after the first call since the source Set never changes at runtime.
 */
let _internalPaymentMethodsSql: string | undefined;
function internalPaymentMethodsSql(): string {
  if (_internalPaymentMethodsSql === undefined) {
    _internalPaymentMethodsSql = [
      ...INTERNAL_LEG_METHODS,
      ...PAYMENT_REPORT_PROVIDER_MARKERS,
      ...PAYMENT_REPORT_ONLY_EXCLUSIONS,
    ]
      .map((m) => `'${m}'`)
      .join(", ");
  }
  return _internalPaymentMethodsSql;
}

/**
 * LPAY-V2 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3): a leg
 * posted to a provider-STOCK drawer (the shop's own MTC/Alfa/Katsh/iPick
 * credit float, never customer cash) — e.g. `RechargeRepository`'s
 * TELECOM_CREDIT_BUYBACK credit leg (`method`/`drawer_name` both the bare
 * provider code, "MTC"/"Alfa") and `FinancialServiceRepository`'s
 * TELECOM_SELF_CHARGE credit leg (`method: "SELF_CHARGE"`, `drawer_name`
 * the provider's stock drawer) — has no enumerable METHOD marker in common;
 * only the DRAWER does. Reuses `TransactionRepository.PROVIDER_STOCK_DRAWERS`
 * (rule 14 — the SAME drawer set `isInternalLegJs`/`customerCashLegSql`
 * already exclude by) rather than guessing at every method literal that
 * might target one. Same lazy/memoized shape as {@link internalPaymentMethodsSql}
 * and for the identical require-cycle reason.
 */
let _providerStockDrawersSql: string | undefined;
function providerStockDrawersSql(): string {
  if (_providerStockDrawersSql === undefined) {
    _providerStockDrawersSql = [...PROVIDER_STOCK_DRAWERS]
      .map((d) => `'${d}'`)
      .join(", ");
  }
  return _providerStockDrawersSql;
}

/**
 * Transaction types that count toward per-user / per-client profit.
 *
 * `TELECOM_CREDIT_BUYBACK` (CARRIER_LINES_VALIDITY_PLAN.md Phase 6) is
 * included deliberately — the plan's two options were "add it here" or
 * "type the row RECHARGE and skip this entirely"; D8 requires the dedicated
 * type, so this is the chosen option. It stamps a real `profit_usd` (credits
 * gained − cash paid, mirroring RECHARGE's own price−cost spread), so it
 * belongs in the same revenue/profit reporting bucket as a forward RECHARGE
 * sale — unlike `TELECOM_SELF_CHARGE` (LIRA-090 M3), which is deliberately
 * EXCLUDED because it always stamps 0 profit ("no profit row").
 *
 * `SUPPLIER_SETTLEMENT` (LIRA-137 fix, BILL_COMMISSION_SETTLEMENT_PLAN.md) is
 * included for the SAME reason: a bills-only Katsh/iPick settlement
 * (`SupplierRepository.settleTransactions`'s `isBillsOnlyBatch` branch)
 * stamps the operator's entered commission as real `profit_usd`/`profit_lbp`
 * on the settlement transaction itself — "our profit entirely" (owner). Every
 * OTHER settlement shape (legacy `commission_model = 0`, or a non-bills
 * new-model batch) stamps exactly 0/0 here, so this addition is a no-op for
 * them (byte-for-byte unchanged). Never partner-/debt-pending: no
 * `partner_ledger` row is ever created with `reference_table =
 * 'supplier_ledger'` and no `debt_ledger` module-debt row is ever keyed to a
 * SUPPLIER_SETTLEMENT transaction id, so `txnNotPartnerPending`/
 * `notDebtPending` always pass it through — it can never be wrongly deferred
 * by {@link getDeferredProfit}. Falls to the generic `ELSE` arms of
 * {@link getByUser}/{@link getByClient} (its `source_table` is
 * `'supplier_ledger'`, matching neither the `sales` nor `financial_services`
 * special-cased branches): revenue contribution is `t.amount_usd`, which is
 * contractually 0/0 for a bills-only batch (the commission is profit-only,
 * no revenue/cost pair), and profit is `t.profit_usd`/`t.profit_lbp` — the
 * stamped commission, attributed to the settling user, "Walk-in" client
 * bucket (no client on a settlement row) — a sensible home, not "unknown."
 * `REFUND` (already in this list) already carries the negated stamp for a
 * reversed settlement (`TransactionRepository._refundTransactionInternal`),
 * so adding `SUPPLIER_SETTLEMENT` here also closes a latent asymmetry: before
 * this fix, refunding a bills-only settlement would have summed the REFUND's
 * negative profit alone (REFUND was already in this list) with no positive
 * counterpart to net against.
 *
 * `RECHARGE_TOPUP` (owner ruling, 2026-09-21): `RechargeRepository
 * .topUpFromClient` stamps a real `profit_usd`/`profit_lbp` equal to the
 * shop's fee on a client-funded Whish App top-up — exactly the same
 * "genuine profit, needs a profit surface" reasoning as
 * `TELECOM_CREDIT_BUYBACK` immediately above. Deliberately narrow: this is
 * the ONLY change requested — `getRechargesByCurrency`/`getRechargesByCarrier`
 * (below) are NOT touched. Those join `t.type = 'RECHARGE'` and derive
 * revenue/cost from `recharges.price`/`cost`; a credit-buy top-up is not a
 * RECHARGE sale, and folding it into that section's columns would distort
 * them. `RECHARGE_TOPUP` profit surfaces via this constant only — By User, By
 * Client, and deferred profit — never the recharge-specific breakdown.
 */
const PROFIT_TXN_TYPES =
  "'SALE', 'FINANCIAL_SERVICE', 'RECHARGE', 'CUSTOM_SERVICE', 'MAINTENANCE', 'LOTO', 'REFUND', 'TELECOM_CREDIT_BUYBACK', 'SUPPLIER_SETTLEMENT', 'RECHARGE_TOPUP'";

/**
 * LCC-X1/X2 (Round 3 adversarial review, rule 14) — a REFUND row belongs in
 * `getByUser`/`getByClient`'s main per-row CASE only when its ORIGINAL
 * transaction is itself one of the "real module" {@link PROFIT_TXN_TYPES}
 * (SALE, FINANCIAL_SERVICE, RECHARGE, …). Two source kinds are reversed via a
 * REFUND row (`reverses_id`) but are NOT one of those types, and each ALREADY
 * nets its own create+refund pair to zero through a dedicated scalar that
 * reads BOTH rows directly, independent of this main CASE:
 *
 *  - A kept-change DEBT_REPAYMENT/KEPT_CHANGE original
 *    ({@link keptChangeSource}) — {@link keptChangeProfitForKey} sums BOTH the
 *    original's `+profit` stamp and the REFUND's `-profit` stamp off
 *    `debt_ledger`-linked/`KEPT_CHANGE` transactions rows directly.
 *  - An EXCHANGE original — {@link exchangeProfitForUser} reads the
 *    `exchange_transactions` row's OWN `notRefunded` flag, which drops its
 *    profit from the sum entirely once refunded (never adds a negated
 *    counter-entry — there is nothing TO counter).
 *
 * Before this fix, EITHER kind's REFUND row also fell into the main CASE's
 * `ELSE` arm (its `type = 'REFUND'` satisfies the bare
 * `t.type IN (PROFIT_TXN_TYPES)` row-membership test, and its
 * `source_table` — `debt_ledger`/`exchange_transactions` — matches neither
 * the `financial_services` nor `sales` special-cased branches), double-
 * counting the SAME reversal a second time and, because the main CASE's
 * `GROUP BY` key is `COALESCE(orig.user_id, t.user_id)` (the ORIGINAL
 * creator) while the dedicated scalars key off each row's OWN `user_id`,
 * mis-attributing the double-counted leg to whichever user the REFUND row's
 * `source_table` happened to route it to. Measured (getByUser, a kept-change
 * DEBT_REPAYMENT +7 created by one user and refunded by another): the
 * refunder's row read -7 on its own, while the Overview's
 * `getDebtRepaymentProfit` (the SAME create+refund pair) read 0.
 *
 * For every OTHER REFUND (its original IS one of {@link PROFIT_TXN_TYPES} —
 * SALE, FINANCIAL_SERVICE, RECHARGE, CUSTOM_SERVICE, MAINTENANCE, LOTO,
 * TELECOM_CREDIT_BUYBACK, SUPPLIER_SETTLEMENT, RECHARGE_TOPUP), this
 * predicate is a no-op: `orig.type` already reads back one of those exact
 * strings, so the row keeps flowing through the main CASE's existing
 * per-source branches exactly as before.
 *
 * `refundAlias`/`origAlias` must be the SAME join {@link refundOriginalJoin}
 * builds and every call site's own FROM clause already uses (originally
 * added for PA-2.11's date fix as a bare `<origAlias>.id =
 * <refundAlias>.reverses_id`; PA-2.11-itemrefund/LCC-itemrefund-fanout below
 * later widened it with a second, `reverses_id`-independent disjunct for
 * `refundSaleItem`'s item refunds — see {@link refundOriginalJoin}'s own doc
 * comment for that history) — this fragment adds no new join and no new
 * bind params of its own (`orig.type` costs nothing extra to read once the
 * join exists). For a non-REFUND row the first disjunct
 * (`<refundAlias>.type <> 'REFUND'`) is TRUE unconditionally, so the join's
 * NULL `orig` row (never matched for a non-REFUND `t`) is never evaluated —
 * safe regardless of whether `orig` resolved.
 *
 * LCC-B1 (round 4, BLOCKER regression introduced by the paragraph above) —
 * the join is LEFT, not INNER: a REFUND row whose `reverses_id` is NULL (or
 * points at a row the join can't otherwise resolve) leaves `orig` entirely
 * unmatched, and `<origAlias>.type IN (...)` against a NULL column is SQL
 * NULL, not FALSE. `FALSE OR NULL` is NULL, which a WHERE clause treats as
 * "exclude" — so EVERY such REFUND silently vanished from the main SELECT,
 * not merely zeroed. `SalesRepository.refundSaleItem`'s `createTransaction`
 * call never sets `reverses_id` at all (it links back via
 * `metadata_json.originalSaleId`/`source_id` instead), so at the time this
 * was written every partial item refund hit this exact NULL. Measured
 * (SALE $30/profit $9, item REFUND -$10/-$3, `reverses_id` NULL): the
 * Overview's `getSalesProfit` (which matches SALE+REFUND by `source_id`, not
 * `reverses_id`) correctly read profit 6, while `getByUser`/`getByClient`
 * read 9 — the REFUND row was absent, not netted. `refundOriginalJoin`'s
 * later `source_id` fallback (PA-2.11-itemrefund) now resolves `orig` for
 * that exact shape instead, so this `orig.id IS NULL` disjunct no longer
 * fires for a NORMAL item refund — it remains the guard for whatever refund
 * shape still cannot resolve an original at all (e.g. a `reverses_id` that
 * points at a row that no longer exists), which is why it stays a permanent
 * disjunct rather than being removed now that the common case is fixed
 * (`ProfitRepository.round3.laneLCC.test.ts`'s original B1 case is joined by
 * a NEW, still-unresolvable-by-either-path case added in round 2 — see
 * `refundOriginalJoin`'s own LCC-itemrefund-fanout paragraph and the
 * LCC-B1-disjunct-unguarded guard test below).
 *
 * Fix: add `<origAlias>.id IS NULL` as an explicit third disjunct — "no
 * original resolved at all" is treated as "include the row" (same as a
 * genuinely non-REFUND row), which is NULL-safe by construction (no
 * three-valued logic reaches the OR) and changes nothing for a REFUND whose
 * `orig` DOES resolve (kept-change/exchange exclusion, PA-2.11, LCC-V8, and
 * every SALE/FINANCIAL_SERVICE/etc. REFUND with a real `reverses_id` are all
 * unaffected — `orig.id IS NULL` is simply FALSE for them, same as before).
 */
function refundOriginalIsProfitEvent(
  refundAlias: string,
  origAlias: string,
): string {
  return `(${refundAlias}.type <> 'REFUND' OR ${origAlias}.id IS NULL OR ${origAlias}.type IN (${PROFIT_TXN_TYPES}))`;
}

/**
 * PA-2.11-itemrefund (OWNER_NOTES_2026-09-21.md §6, round-2 LCC follow-up) —
 * the ONE join that resolves a REFUND's ORIGINAL transaction row, used at
 * all FOUR call sites `getByUser`/`getByClient` each need (their own
 * main-SELECT `orig` and orphan-probe `orig3`) — previously re-pasted by
 * hand, and matching ONLY `reverses_id`.
 *
 * `SalesRepository.refundSaleItem`'s `createTransaction` call never sets
 * `reverses_id` — it links back only via `source_table`/`source_id` (the
 * SAME pair the original SALE row itself carries). A bare
 * `orig.id = t.reverses_id` therefore left `orig` unresolved for every
 * partial item refund. LCC-B1 (round 4) stopped that unresolved case from
 * being silently DROPPED (`refundOriginalIsProfitEvent`'s `orig.id IS NULL`
 * disjunct admits the row), but the row still dated/attributed itself by ITS
 * OWN `created_at`/`user_id`/`client_name` — wrong period, wrong cashier,
 * wrong walk-in name — because `orig` never carried the sale's actual data
 * to fall back to. Measured (a June SALE, a July item REFUND): the
 * Overview's `getSalesProfit` (which matches by `source_id`, not
 * `reverses_id`) read June 6 / July 0; `getByUser`/`getByClient` read June 9
 * / July -3 — the refund landed in July, on its own row, on the refunder.
 *
 * The second disjunct fires ONLY when `reverses_id IS NULL` (a normal
 * FINANCIAL_SERVICE/RECHARGE/CUSTOM_SERVICE/etc. REFUND always sets it, so
 * this is a no-op for them) and only for a `source_table = 'sales'` REFUND
 * matched to the OLDEST `type = 'SALE'` row sharing its `source_id` — the
 * exact shape `refundSaleItem` writes. Adds no new bind param (one
 * `${origAlias}.tenant_id = ?`, identical to before — the correlated
 * `MIN(o.id)` subquery below reads `${alias}.tenant_id`/`${alias}.source_id`
 * off the already-bound outer row, not a new placeholder) and changes
 * nothing for a REFUND whose `reverses_id` DOES resolve — the first
 * disjunct is tried first and behaves exactly as before (kept-change/
 * exchange exclusion, LCC-B1's own `orig.id IS NULL` fallback, and every
 * non-item-refund REFUND path are all unaffected).
 *
 * LCC-itemrefund-fanout (round-2 BLOCKER, caught before this shipped) — the
 * very first version of the fallback matched `${origAlias}.source_table =
 * 'sales' AND ${origAlias}.source_id = ${alias}.source_id AND
 * ${origAlias}.type = 'SALE'` directly, with NO uniqueness guarantee. That
 * is not one-to-one: `SalesRepository.processSale` inserts a NEW `type =
 * 'SALE'` transactions row on EVERY call — including a draft's autosave
 * (POS/index.tsx) and the SAME draft's later completion — with no status
 * gate and nothing voiding the earlier row, so one `sales.id` can legitimately
 * own several `SALE` transactions rows (`TransactionRepository
 * .refundBySaleId`'s own `ORDER BY id DESC LIMIT 1` already assumes this). A
 * plain equality `LEFT JOIN` fans a single item REFUND out across EVERY one
 * of them, and every downstream `orig`-keyed sum
 * (`profitTxnRowMembership`'s row membership itself, plus every fallback
 * listed below) then counts that ONE refund N times, spread over N
 * (possibly different) `orig.user_id`/`orig.created_at`/`orig.client_name`
 * values — a NEW mismatch against the Overview's `getSalesProfit` (which
 * matches by `source_id` and counts the refund once), on top of the exact
 * failure mode this fragment exists to fix. Resolved by resolving
 * `${origAlias}.id` to an explicit `SELECT MIN(o.id) ...` scalar instead of
 * a bare equality — the correlated subquery is guaranteed at most one row by
 * `MIN()`, so the LEFT JOIN can match at most one `orig` row for any given
 * `alias` row, the same one-to-one shape the `reverses_id` branch already
 * has. `MIN(o.id)` (oldest row, i.e. the draft's original autosave-created
 * row) was chosen over `MAX` because it is the row whose `created_at` is
 * closest to when the sale actually started, matching what an operator
 * means by "the sale" and what `refundBySaleId`'s own newest-row convention
 * is choosing BETWEEN (not the same call, but the same "one canonical row
 * for this `sales.id`" intent). Guarded by
 * `ProfitRepository.itemRefundOriginalLink.test.ts`'s fan-out case (NOT
 * RUN — red/green proof pending, tomorrow).
 *
 * Once `orig` resolves for an item refund, every EXISTING `orig`-keyed
 * fallback picks it up for free (rule 14 — nothing else needs to change):
 * `profitTxnRowMembership`'s date (`COALESCE(orig.created_at,
 * t.created_at)` — PA-2.11), `getByUser`'s `COALESCE(orig.user_id,
 * t.user_id)` attribution (its GROUP BY and USER_KEY), and `getByClient`'s
 * `CLIENT_NAME_KEY` (`COALESCE(t.client_name, orig.client_name, '')`) and
 * its main-SELECT display-name fallback
 * (`MAX(COALESCE(t.client_name, orig.client_name))`).
 */
function refundOriginalJoin(alias: string, origAlias: string): string {
  return `LEFT JOIN transactions ${origAlias} ON ${alias}.type = 'REFUND' AND ${origAlias}.tenant_id = ?
        AND (${origAlias}.id = ${alias}.reverses_id
          OR (${alias}.reverses_id IS NULL AND ${alias}.source_table = 'sales'
            AND ${origAlias}.id = (
              SELECT MIN(o.id) FROM transactions o
              WHERE o.tenant_id = ${alias}.tenant_id
                AND o.source_table = 'sales'
                AND o.source_id = ${alias}.source_id
                AND o.type = 'SALE'
            )))`;
}

/**
 * LCC-X7 (Round 3 adversarial review, rule 14) — the ONE "is this
 * transactions row a PROFIT_TXN_TYPES event, in the requested window,
 * tenant-scoped" row-membership test. `getByUser`/`getByClient` each apply
 * this EXACT test twice per method — once as the main SELECT's own WHERE,
 * once inside the orphan branch's `NOT EXISTS` probe of "does this key
 * already have a main-branch row" (`t3`/`orig3` aliases there) — four call
 * sites total, previously re-pasted by hand at each one. `alias`/`origAlias`
 * are the transactions/orig aliases in scope (`t`/`orig` in a main SELECT,
 * `t3`/`orig3` in an orphan probe); embeds exactly 3 bind params in this
 * fixed order — `dateRange`'s 2 (from, to), then `tenant_id`'s 1 —
 * IDENTICAL at every call site ({@link refundOriginalIsProfitEvent} embeds
 * none), so this refactor changes no bind-param count or order anywhere it
 * is substituted in.
 */
function profitTxnRowMembership(alias: string, origAlias: string): string {
  return `${alias}.status = 'ACTIVE'
          AND ${alias}.type IN (${PROFIT_TXN_TYPES})
          AND ${refundOriginalIsProfitEvent(alias, origAlias)}
          AND ${dateRange(`COALESCE(${origAlias}.created_at, ${alias}.created_at)`)}
          AND ${alias}.tenant_id = ?`;
}

/**
 * LCC-X7 (Round 3, rule 14) — the ONE "is this settlement_commission_
 * allocations row a recognised cashless allocation, in the requested window,
 * tenant-scoped" gate set, shared by {@link reattributedSettlementCommission},
 * {@link reattributedSettlementRecognizedCount}, and the orphan-key
 * allocation-originator UNION branch inside `getByUser`/`getByClient`
 * (`sca2`/`fs2`/`ft2` aliases there) — three call sites per method,
 * previously re-pasted by hand at each one. Does NOT include the caller's
 * own `matchCondition` (the reattribution scalars) or non-zero-commission
 * filter (the COUNT twin) — those stay caller-supplied, appended AFTER this
 * fragment, so this refactor changes no bind-param count or order. Embeds 4
 * bind params in this fixed order: `dateRange`'s 2, then `scaAlias.tenant_id`,
 * then `ftAlias.tenant_id`.
 */
function allocationRecognitionGates(
  scaAlias: string,
  fsAlias: string,
  ftAlias: string,
): string {
  return `${cashlessCommissionBatch(`${scaAlias}.settlement_ledger_id`)}
              AND ${notRefunded(fsAlias)}
              AND ${allocationNotDebtPending(scaAlias)}
              AND ${dateRange(`${scaAlias}.created_at`)}
              AND ${scaAlias}.tenant_id = ?
              AND ${ftAlias}.tenant_id = ?`;
}

/**
 * LCC-X7 (Round 3, rule 14) — the ONE "is this transactions row a
 * recognised kept-change source, in the requested window, tenant-scoped"
 * gate set, shared by {@link keptChangeProfitForKey},
 * {@link keptChangeRecognizedCount}, and the orphan-key kept-change UNION
 * branch inside `getByUser`/`getByClient` (`kc2` alias there) — three call
 * sites per method. Does NOT include the caller's own `matchCondition` or
 * non-zero-stamp filter — appended AFTER this fragment by the caller, so no
 * bind-param count or order changes. Embeds 3 bind params: `dateRange`'s 2,
 * then `kcAlias.tenant_id`.
 */
function keptChangeRecognitionGates(kcAlias: string): string {
  return `${kcAlias}.status = 'ACTIVE'
              AND ${keptChangeSource(kcAlias)}
              AND ${dateRange(`${kcAlias}.created_at`)}
              AND ${kcAlias}.tenant_id = ?`;
}

/**
 * LCC-X7 (Round 3, rule 14) — the ONE "is this exchange_transactions row a
 * recognised (not refunded), in-window, tenant-scoped" gate set, shared by
 * {@link exchangeProfitForUser}, {@link exchangeRecognizedCount}, and
 * `getByUser`'s orphan-key exchange UNION branch (`ext2`/`et2` aliases
 * there) — three call sites. Does NOT include the caller's own
 * `et.user_id IS <key>` match or non-zero-profit filter — appended by the
 * caller. Embeds 4 bind params: `dateRange`'s 2, then `extAlias.tenant_id`,
 * then `etAlias.tenant_id`.
 */
function exchangeRecognitionGates(extAlias: string, etAlias: string): string {
  return `${notRefunded(extAlias)}
              AND ${dateRange(`${extAlias}.created_at`)}
              AND ${extAlias}.tenant_id = ?
              AND ${etAlias}.tenant_id = ?`;
}

/**
 * LCC-M2 (round 4, rule 14) — the ONE "pending LEGACY (commission_model = 0)
 * commission for this key" fragment (PA-1.3/LCC-X3's own doc comment has the
 * full USD/LBP-split rationale), shared by `getByUser`'s and `getByClient`'s
 * `pending_profit_usd`/`pending_profit_lbp` columns — four call sites,
 * previously re-pasted by hand at each one (identical gate set:
 * `fs2.is_settled = 0`, `fs2.commission > 0`, {@link embeddedCommission},
 * {@link notRefunded}, `dateRange(fs2.created_at)`, tenant scoping —
 * differing only in the caller-built key match and the currency bucket).
 *
 * `matchCondition` is caller-built (same contract as
 * {@link reattributedSettlementCommission} — see its own doc comment):
 * `getByUser` passes its plain `t2.user_id = COALESCE(orig.user_id,
 * t.user_id)`; `getByClient` passes its linked/walk-in OR-branch keyed on
 * `CLIENT_NAME_KEY`, unchanged from before this extraction. `currency`
 * picks the bucket: `usd` reuses the shared strict USD bucket
 * ({@link usdBucketPredicate}, LCC-X3 — EUR is dropped, not lumped in);
 * `lbp` is `fs2.currency = 'LBP'`. `hasCommissionModelColumn` is the
 * caller's own `this._hasCommissionModelColumn()` (a repository method,
 * unreachable from this module-scope function, so it stays a parameter like
 * every other schema-drift flag in this file — {@link fsProviderRowRecognized}'s
 * own `hasCommissionModelColumn` parameter is the same shape).
 *
 * Embeds EXACTLY 4 bind params in this fixed order (`matchCondition` itself
 * embeds none at either existing call site): `dateRange`'s 2 (from, to),
 * then `fs2.tenant_id`, then `t2.tenant_id` — identical count and order to
 * the pre-extraction inline text, so this refactor changes no bind-param
 * count or order anywhere it is substituted in.
 *
 * `matchCondition` is wrapped in its OWN parens here (`WHERE (${matchCondition})
 * AND ...`), unlike this file's other `matchCondition`-taking fragments
 * ({@link reattributedSettlementCommission}, {@link keptChangeProfitForKey}),
 * which rely on the CALLER pre-wrapping a top-level-OR condition (e.g.
 * `clientReattMatchMain`'s own double parens). `getByClient`'s match here is
 * a bare `A OR B` with no outer wrap, so this fragment wraps it itself
 * rather than requiring a THIRD parenthesization convention at the call
 * site — safe either way (an already-wrapped `getByUser` match just gets a
 * redundant, harmless extra layer).
 */
function pendingLegacyCommissionForKey(
  matchCondition: string,
  currency: "usd" | "lbp",
  hasCommissionModelColumn: boolean,
): string {
  const currencyBucket =
    currency === "usd"
      ? usdBucketPredicate("fs2.currency", true)
      : "fs2.currency = 'LBP'";
  return `COALESCE((
              SELECT SUM(CASE WHEN ${currencyBucket} THEN fs2.commission ELSE 0 END)
              FROM financial_services fs2
              JOIN transactions t2 ON t2.source_table = 'financial_services' AND t2.source_id = fs2.id
                AND t2.type = 'FINANCIAL_SERVICE'
              WHERE (${matchCondition})
                AND fs2.is_settled = 0
                AND fs2.commission > 0
                AND ${embeddedCommission("fs2", hasCommissionModelColumn)}
                AND ${notRefunded("fs2")}
                AND ${dateRange("fs2.created_at")}
                AND fs2.tenant_id = ? AND t2.tenant_id = ?
            ), 0)`;
}

/**
 * Maintenance jobs that count as completed revenue: the device was delivered.
 * The maintenance workflow has NO "completed" status (its states are Received /
 * In_Progress / Ready / Delivered / Delivered_Paid) — the old lowercase
 * equality predicate matched nothing, so maintenance profit was always zero
 * in every profits view (B5). Takes an alias (mirrors `notRefunded(alias)`
 * immediately above) so a caller with a different table alias reuses this
 * ONE definition (rule 14) instead of hand-rolling a second copy that
 * silently drifts. Its two current callers, both in THIS file: `getMaintenanceTotals`
 * and `getByDate`'s `daily_maint` CTE.
 *
 * REV-4 (verifier round-1 fix, 2026-09-24): this used to also name
 * `ClosingRepository.getDailyStatsSnapshot`'s "unaliased `FROM maintenance`"
 * as a caller this fragment closed a drift bug for. That query is gone —
 * LIRA-219 moved daily-closing profit onto `ProfitService.getSummary`
 * entirely (see `ClosingRepository.ts`'s own file-header note), and
 * `getDailyStatsSnapshot` itself now lives on `ClosingService`, composing
 * that summary rather than running its own maintenance SQL. Neither
 * `maintenanceCompleted` nor `maintenanceCostUsd` has a `ClosingRepository`
 * caller any more.
 */
export function maintenanceCompleted(alias: string): string {
  return `${alias}.status IN ('Delivered', 'Delivered_Paid')`;
}

/**
 * Total maintenance USD cost = labour USD cost + parts cost. ONE definition
 * (rule 14) — `maintenance.cost_usd` means LABOUR cost only, so every query
 * that used it as "the job's cost" understates by the parts cost once a job
 * has parts. Takes an alias, mirroring `maintenanceCompleted` above, so a
 * caller with a different table alias can reuse it too — `getMaintenanceTotals`
 * and `getByDate`'s `daily_maint` CTE, both in THIS file, are its only two
 * current callers (REV-4, 2026-09-24 — see `maintenanceCompleted`'s doc
 * comment immediately above: `ClosingRepository` has no maintenance query of
 * its own left to reuse this from).
 * There is deliberately NO `_lbp` twin: parts are always USD and never
 * converted, so `cost_lbp` is already complete.
 */
export function maintenanceCostUsd(alias: string): string {
  return `(${alias}.cost_usd + ${alias}.parts_cost_usd)`;
}

/**
 * DBT-2 / PFT-6 (proportional recognition, 2026-09-05 — Step 2 of
 * docs/plans/done_plans/PARTNER_PROPORTIONAL_RECOGNITION.md) — the
 * transactions-alias counterpart of the (literal-`refTable`) fragment
 * `partnerCoverageRatio(refTable, idExpr)` documented in that plan (§1).
 * `partnerCoverageRatio` cannot be called from `getByUser`/`getByClient`/
 * `getDeferredProfit` because those views iterate unified `transactions`
 * rows spanning every FOR_% module at once — the module a given row belongs
 * to is only known at read time, off that row's OWN `source_table` column,
 * not as a compile-time string constant. This mirrors exactly the
 * relationship {@link txnNotPartnerPending} already has to
 * {@link notPartnerPending} (same correlation, `${alias}.source_table` /
 * `${alias}.source_id` instead of a literal table name) — this fragment is
 * {@link txnNotPartnerPending}'s proportional counterpart the same way
 * `partnerCoverageRatio` is `notPartnerPending`'s.
 *
 * Semantics are IDENTICAL to `partnerCoverageRatio` (only the correlation
 * differs), so this doc comment restates that fragment's rationale rather
 * than inventing a second one:
 *
 * - Returns `SUM(covered_amount) / SUM(amount)` over the row's FOR_%
 *   `partner_ledger` rows, selected by a WHERE clause copy-identical to
 *   {@link txnNotPartnerPending}'s own (rule 14 — one definition of "what
 *   counts as a partner row" for the transactions-alias case). The only
 *   difference from that predicate: this fragment does NOT additionally
 *   filter `covered_amount < amount - 0.005` — every matching FOR_% row
 *   (covered or not) must contribute to both SUMs, or an already-fully-
 *   covered row would be silently dropped from the ratio instead of
 *   correctly pushing it to 1.0.
 * - **Defaults to 1.0** when the row has no FOR_% rows at all (both SUMs
 *   are SQL NULL -> division is NULL -> outer `COALESCE` returns 1.0) — a
 *   non-partner row recognises fully, unchanged from today's binary gate.
 * - **Clamped to `[0, 1]`** via the scalar (2-argument) `MIN`/`MAX` forms —
 *   same empirically-verified better-sqlite3 behaviour `partnerCoverageRatio`
 *   relies on (2-argument MIN/MAX resolves to the scalar row-wise form even
 *   when an argument is itself an aggregate `SUM(...)` collapsed to one row).
 * - **`NULLIF`-guarded** against a zero-`amount` FOR_% row degrading to a
 *   bare NULL instead of the same 1.0 default.
 * - **Derived at read time, never stamped.** Because the value is computed
 *   from `covered_amount` when the query runs, a refund that unwinds
 *   coverage through the existing reverse-FIFO
 *   (`TransactionRepository._unwindPartnerSettlementCoverage`) corrects the
 *   figure automatically on the very next read — rule 20 is satisfied by
 *   construction, with no reversal code of its own needed, because nothing
 *   is recorded against the source row to begin with. This is a BINDING
 *   design constraint (not a style preference): stamping this ratio at
 *   write time would require a second reversal path to keep it in sync with
 *   `PartnerRepository.applySettlementCoverage` / the unwind above, and
 *   would drift the instant one of those two write paths changed without
 *   the stamp being touched in lockstep.
 *
 * Cross-reference: `partnerCoverageRatio` (this fragment's literal-table
 * sibling, used at the 19 `notPartnerPending` call sites classified in
 * PARTNER_PROPORTIONAL_RECOGNITION.md §4) names this exact fragment in its
 * own §6 as the piece Step 1 deliberately left unbuilt for
 * `getByUser`/`getByClient`/`getDeferredProfit` — this is that piece.
 *
 * Exported (matching `notPartnerPending`/`partnerCoverageRatio`/
 * `txnNotPartnerPending`'s convention — the last of those was made exported
 * by this same change, see its own doc comment) so this fragment's own unit
 * tests (`ProfitRepository.txnPartnerCoverageRatio.test.ts`) can exercise the
 * raw SQL expression directly, independent of any repository method — the
 * same reason `partnerCoverageRatio` itself is exported.
 */
export function txnPartnerCoverageRatio(alias: string): string {
  return `COALESCE(
    (
      SELECT MAX(0.0, MIN(1.0,
        SUM(plr.covered_amount) / NULLIF(SUM(plr.amount), 0)
      ))
      FROM partner_ledger plr
      WHERE plr.reference_table = ${alias}.source_table
        AND plr.reference_id = ${alias}.source_id
        AND plr.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
    ),
    1.0
  )`;
}

/**
 * Task 2 continuity guard (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md) —
 * a grouped list query (one row per provider/carrier/currency) that used to
 * gate a partner-pending row out via a binary `WHERE ... notPartnerPending`
 * predicate now instead WEIGHTS its monetary columns by
 * {@link partnerCoverageRatio}/{@link txnPartnerCoverageRatio}. That is
 * correct for the VALUES (rule: continuity — ratio 0 reads 0, ratio 1 reads
 * the full value, exactly like the old gate's two extremes), but it changes
 * ROW MEMBERSHIP as a side effect: the group key (e.g. "WHISH", "LBP") still
 * has underlying rows even when every one of them is fully partner-
 * uncovered, so `GROUP BY` still emits a row for it — just one where every
 * weighted column reads 0. Before this conversion such a group had ZERO
 * matching rows at all (the binary gate excluded them from the WHERE clause
 * before grouping), so it never appeared in the result set. A caller
 * rendering this list (e.g. Profits-by-provider) would show a new, wrong
 * "WHISH — $0.00" line where it used to show nothing — the money is
 * identical (zero either way) but the row's mere PRESENCE is a real,
 * user-visible regression the value-side conversion alone can't fix.
 *
 * This HAVING fragment restores exact row-membership parity: a group is kept
 * iff its summed contribution across every one of the given aggregate
 * expressions is non-zero in at least one of them (OR, not AND — see below);
 * a group whose EVERY given expression sums to exactly 0 is dropped, which
 * reproduces the old gate's "never matched a row" behaviour for the fully-
 * uncovered case while leaving a partially- or fully-covered group (which
 * has at least one nonzero column) untouched.
 *
 * OR, not AND, is required because sibling columns are not always jointly
 * zero for the same reason: `getFinancialSettledByProvider`'s allocation arm
 * deliberately stamps `revenue_usd`/`revenue_lbp`/`count` as 0 UNCONDITIONALLY
 * (a commission allocation carries no revenue/cost pair and its underlying
 * fs row is already counted by the base arm — see that method's own doc
 * comment) while `profit_usd`/`profit_lbp` can be genuinely non-zero there.
 * Requiring every column to be non-zero (AND) would wrongly drop that exact
 * row. Callers pass every weighted monetary AND count column from their own
 * SELECT list — omitting one would let a group survive on a contribution
 * this check never saw, so every ratio-weighted column belongs in the list.
 *
 * Rule 14 — the identical PATTERN ("drop iff every one of these is exactly
 * 0") recurs across `getFinancialSettledByProvider`, `getRechargesByCarrier`,
 * `getFinancialSettledByCurrency`, `getMobileServicesByCurrency` and
 * `getRechargesByCurrency`; this is the one place that pattern is defined so
 * a sixth grouped query converts by calling it, not by re-typing the OR
 * chain a second time.
 *
 * Takes fully-formed boolean CONDITIONS, not bare column names — and every
 * condition MUST be a freshly-recomputed `SUM(<raw expression>) != 0` (the
 * exact same expression the sibling SELECT column sums), never a bare
 * reference to that column's own OUTPUT ALIAS. This is not a style
 * preference — it was a SHIPPED BUG here, caught only by actually running
 * the fixture-backed tests (`ProfitRepository.zeroRowContinuity.test.ts`),
 * not by reasoning about the SQL in the abstract:
 *
 *  - **A bare alias silently resolves to a same-named FROM/JOIN column
 *    instead of the aggregate, with no error.** `getRechargesByCarrier` and
 *    `getMobileServicesByCurrency`/`getRechargesByCurrency` join
 *    `transactions t` (`profit_usd`/`profit_lbp` are REAL columns there) and
 *    `financial_services`/`recharges` (`cost` is a REAL column on both) —
 *    `HAVING profit_usd != 0` or `HAVING cost != 0` resolved to the RAW,
 *    un-weighted `t.profit_usd`/`fs.cost`/`r.cost` (whatever a single
 *    contributing detail row happened to hold) instead of this query's own
 *    ratio-weighted output alias of the identical name — so a fully
 *    partner-uncovered group (every weighted column genuinely 0) was NOT
 *    dropped whenever the RAW underlying column on its one contributing row
 *    was nonzero, which is the overwhelmingly common case. SQLite raises no
 *    error for this — the alias and the real column are both valid
 *    resolutions of the same bare name, and it silently prefers the
 *    FROM-clause column. Verified by hand against a minimal repro (a bare
 *    alias with NO colliding FROM column filtered correctly every time; the
 *    instant a same-named real column existed anywhere in the FROM/JOIN, the
 *    bare reference in `HAVING` silently bound to THAT instead).
 *  - **A bare alias can also collide with an unrelated guard's own text
 *    scan** — `getFinancialSettledByCurrency` names one column
 *    `AS commission`, and `embeddedCommission.guard.test.ts` greps for a bare
 *    `commission` token not preceded by `AS ` as a proxy for "reads
 *    `financial_services.commission` unsafely" — a second, bare occurrence
 *    of that exact word in this fragment's own OR chain tripped that guard
 *    as a false positive.
 *  - `getFinancialSettledByProvider` is the one call site that is NOT
 *    single-level: its outer `GROUP BY provider` runs over a DERIVED TABLE
 *    (`combined`) whose `revenue_usd`/`profit_usd`/etc. genuinely ARE real,
 *    unambiguous per-row columns of that subquery (nothing else is joined
 *    at that outer level to collide with), so `SUM(revenue_usd) != 0` there
 *    is both correct and necessary (collapsing the UNION ALL's multiple
 *    arms per provider) — the one place a bare column name belongs in a
 *    condition here, and even then it is wrapped in a fresh `SUM(...)`,
 *    never compared bare.
 *
 * Recomputing the full expression a second time is more verbose, but it is
 * the ONLY form proven safe against both failure modes above, at every
 * single-level call site, regardless of whether today's schema happens to
 * lack a colliding column name — a future column addition to
 * `financial_services`/`recharges`/`transactions` sharing a name with one of
 * these aliases would silently reintroduce this exact bug otherwise.
 *
 * Deliberately NOT applied to `getByDate`'s per-day CTEs: that method's outer
 * query always emits exactly one row per calendar day (from its own `dates`
 * CTE, unconditionally) and LEFT JOINs each daily_* CTE, `COALESCE`-ing a
 * missing match to 0 — so a day where a CTE would produce a lone zero-valued
 * row reads byte-for-byte identically to that day having NO CTE row at all.
 * There is no group-membership question for a fixed calendar-day axis the
 * way there is for a provider/carrier/currency axis pulled from the data
 * itself, so this fragment has no work to do there.
 */
function havingAnyContribution(conditions: string[]): string {
  return `HAVING ${conditions.join(" OR ")}`;
}

// =============================================================================
// Repository
// =============================================================================

export class ProfitRepository extends BaseRepository<{ id: number }> {
  constructor() {
    // Base table is irrelevant — this repo only runs cross-entity aggregations.
    super("sales", { softDelete: false });
  }

  protected getColumns(): string {
    return "id";
  }

  /**
   * Memoized result of {@link _hasCommissionModelColumn} — the schema cannot
   * change mid-process, so (mirroring `FinancialServiceRepository`'s own
   * `_hasSettlementAllocationsTableCache`) it is checked once per repository
   * instance rather than once per query. Several of this repo's queries
   * ({@link getRealizedCommissionTotals}, {@link getPendingCommissionTotals},
   * {@link getPendingCommissionByProvider}, {@link getByUser},
   * {@link getByClient}, {@link getUnsettledCommissions}) all embed
   * {@link embeddedCommission} and would otherwise each re-run the PRAGMA.
   */
  private _hasCommissionModelColumnCache: boolean | null = null;

  /**
   * Schema-drift guard (LIRA-158_COMMISSION_REPORTING_PLAN.md §5) — ~30 jest
   * fixtures across this repo (and `ProfitService`'s) build `financial_services`
   * WITHOUT a `commission_model` column, because they pre-date migration v148
   * (e.g. `ProfitRepository.commissionGates.test.ts`,
   * `ProfitRepository.tenantIsolation.test.ts`,
   * `ProfitRepository.partnerPendingCorrelation.test.ts`,
   * `ProfitService.transactionBased.test.ts`). Naming that column unguarded in
   * a WHERE clause makes every one of those fixtures throw "no such column"
   * and die in SETUP — which reads like a broken assertion, not a schema gap
   * (this exact trap has cost three separate failures in this repo; see
   * `reference_test_schema_completeness`). Rule 14 — the PRAGMA itself now
   * lives in the single exported {@link hasCommissionModelColumn} free
   * function above (shared with `FinancialServiceRepository`'s own wrapper of
   * the same name); this method only adds this repository's per-instance
   * memoization on top of it.
   */
  private _hasCommissionModelColumn(): boolean {
    if (this._hasCommissionModelColumnCache === null) {
      this._hasCommissionModelColumnCache = hasCommissionModelColumn(this.db);
    }
    return this._hasCommissionModelColumnCache;
  }

  /**
   * Memoized result of {@link hasSettlementAllocationsTable} — mirrors
   * `_hasCommissionModelColumnCache`'s own precedent immediately above: the
   * `sqlite_master` probe itself now lives in the single exported
   * {@link hasSettlementAllocationsTable} free function (shared with
   * `FinancialServiceRepository`'s own wrapper of the same name — rule 14,
   * de-duplicated from what used to be two independent copies of the
   * identical query); this cache only adds this repository's per-instance
   * memoization on top of it.
   */
  private _hasSettlementAllocationsTableCache: boolean | null = null;

  /**
   * `settlement_commission_allocations` only exists from migration v150
   * onward, and ~30 jest fixtures in this file's own test suite (and
   * `ProfitService`'s) hand-roll a fresh in-memory schema that predates it
   * (LIRA-158_COMMISSION_REPORTING_PLAN.md §5). Naming that table unguarded
   * in {@link getFinancialSettledByProvider} / {@link getByDate}'s
   * `daily_commissions` CTE would throw "no such table" and kill every one
   * of those fixtures in SETUP — degrade to the pre-Phase-3 query shape
   * (no allocation UNION arm) instead when the table is absent.
   */
  private _hasSettlementAllocationsTable(): boolean {
    if (this._hasSettlementAllocationsTableCache === null) {
      this._hasSettlementAllocationsTableCache = hasSettlementAllocationsTable(
        this.db,
      );
    }
    return this._hasSettlementAllocationsTableCache;
  }

  /**
   * Memoized result of {@link hasSaleDiscountAndRefundQuantityColumns} —
   * same per-instance memoization precedent as
   * `_hasCommissionModelColumnCache` above. Feeds {@link getSalesRevCost}
   * (PA-4.23 a).
   */
  private _hasSaleDiscountAndRefundQuantityColumnsCache: boolean | null =
    null;

  private _hasSaleDiscountAndRefundQuantityColumns(): boolean {
    if (this._hasSaleDiscountAndRefundQuantityColumnsCache === null) {
      this._hasSaleDiscountAndRefundQuantityColumnsCache =
        hasSaleDiscountAndRefundQuantityColumns(this.db);
    }
    return this._hasSaleDiscountAndRefundQuantityColumnsCache;
  }

  /**
   * Memoized result of {@link hasExchangeCurrencyColumns} — same per-instance
   * caching precedent as {@link _hasCommissionModelColumnCache} immediately
   * above. Feeds {@link exchangeUsdRevenue} at both call sites that need it
   * ({@link getExchangeTotals}, {@link getByDate}'s `daily_exchange` CTE).
   */
  private _hasExchangeCurrencyColumnsCache: boolean | null = null;

  private _hasExchangeCurrencyColumns(): boolean {
    if (this._hasExchangeCurrencyColumnsCache === null) {
      this._hasExchangeCurrencyColumnsCache = hasExchangeCurrencyColumns(
        this.db,
      );
    }
    return this._hasExchangeCurrencyColumnsCache;
  }

  /**
   * Memoized result of {@link hasExchangeTransactionsTable} — mirrors
   * `_hasSettlementAllocationsTableCache`'s own precedent. Feeds
   * `getByUser`'s (LCC-V3) exchange-profit arm — see
   * {@link hasExchangeTransactionsTable}'s own doc comment for why an
   * unconditional reference is unsafe.
   */
  private _hasExchangeTransactionsTableCache: boolean | null = null;

  private _hasExchangeTransactionsTable(): boolean {
    if (this._hasExchangeTransactionsTableCache === null) {
      this._hasExchangeTransactionsTableCache = hasExchangeTransactionsTable(
        this.db,
      );
    }
    return this._hasExchangeTransactionsTableCache;
  }

  // ---------------------------------------------------------------------------
  // Summary (getSummary) — per-category raw rows
  // ---------------------------------------------------------------------------

  /**
   * Sales revenue + cost from sale_items. Owner decision 2026-09-05
   * (PARTNER_PROPORTIONAL_RECOGNITION.md Task 3): the old binary
   * `salePaidOrPartnerSettled` WHERE gate is replaced by weighting every
   * monetary column with {@link saleRecognitionWeight} — 1.0 for a fully
   * customer-paid sale (unchanged), the partner's covered fraction for a
   * for-partner sale (was: all-or-nothing), 0 for a genuinely pending
   * non-partner sale (unchanged, DBT-1 out of scope). Gate removed AND value
   * weighted in the SAME edit (rule: a loosened gate without a weighted
   * value would overstate profit for a partially-covered sale). No
   * phantom-row risk (Task 2's continuity concern): this is a single-row
   * total, not a grouped list, so there is no group membership to protect —
   * a fully-uncovered period just reads 0, same as before.
   *
   * `count` is never weighted (a fractional "3.4 sales" has no sensible
   * rendering) — instead counted the moment ANY money is recognised
   * (`weight > 0`), matching every other converted count column in this
   * file.
   *
   * PA-4.23 (a) — owner decision 2026-09-24 (OWNER_NOTES_2026-09-21.md §6.9):
   * "Sale revenue and cost become net of discounts and refunded items, so
   * the row adds up to the ledger profit." Before this fix the SELECT above
   * summed the FULL `sold_price_usd`/`cost_price_snapshot_usd × quantity`
   * for every non-whole-sale-refunded line (`si.is_refunded = 0` only
   * catches a WHOLE-sale void — `SalesRepository.refundSaleItem` increments
   * `refunded_quantity` on a partial item refund and never touches
   * `is_refunded`), and never subtracted `sales.discount_usd` at all. A
   * $70/$42 example on real data netted a correct $22 ledger profit
   * (`getSalesProfit`) against a wrong $70/$42 revenue/cost pair.
   *
   * The fix, per sale: revenue = Σ(non-fully-refunded lines' `sold_price_usd
   * × (quantity − refunded_quantity)`) − `discount_usd × (that remaining
   * revenue ÷ the sale's PRE-discount total_amount_usd)`; cost = the same
   * remaining-quantity sum over `cost_price_snapshot_usd`, undiscounted (a
   * discount reduces what the customer paid, never what the shop paid its
   * supplier). The discount is allocated by the REMAINING share of the
   * pre-discount total — the same `lineShareOfSale` denominator
   * `SalesRepository.refundSaleItem` already uses to pro-rate a refund's own
   * discount give-back (see that method's own doc comment) — so this SQL
   * reproduces exactly the ledger's own math: `getSalesProfit` sums
   * `t.profit_usd` over the SALE row (Σ full-item margins − discount) and
   * every REFUND row (−(refunded margin − its pro-rata discount share)),
   * which nets to `Σ_remaining margins − discount × (remaining share)` —
   * algebraically identical to this query's `revenue_usd − cost_usd`
   * (verified end to end with real writers,
   * `ProfitRepository.salesRevCostNetOfDiscountAndRefund.test.ts`, rule 17).
   * Kept change (`sale.kept_change_usd`, stamped only on the SALE row) is
   * NOT reproduced here — it has no revenue/cost counterpart of its own (own
   * card, PA-3.1) — so THIS query's `revenue_usd − cost_usd` alone is exact
   * only when a sale carries no kept change. PFU-a-3 (verifier round 1)
   * closed that gap one layer up, not here: `ProfitService.getByModule`
   * derives the residual (`profit − (revenue − cost)`) as
   * `sale_kept_change_usd/_lbp` and the By Module UI renders it as a THIRD
   * term in the equation (`revenue − cost ± kept change = profit`), so the
   * rendered row reconciles exactly even when a sale carries kept change —
   * see `ProfitByModule.sale_kept_change_usd`'s own doc comment
   * (ProfitService.ts) for the full mechanism, including PFU-a-3-residual's
   * caveat that a NEGATIVE residual is relabeled "unexplained difference"
   * there rather than asserted to be kept change.
   *
   * Schema-drift-guarded ({@link hasSaleDiscountAndRefundQuantityColumns}):
   * degrades to the byte-for-byte pre-fix gross query when a jest fixture's
   * hand-rolled schema lacks `discount_usd`/`total_amount_usd`/
   * `refunded_quantity` (every real database has all three — see that
   * function's own doc comment).
   */
  getSalesRevCost(fromDt: string, toDt: string): SalesRevCostRow {
    if (!this._hasSaleDiscountAndRefundQuantityColumns()) {
      return this.db
        .prepare(
          `SELECT
            COALESCE(SUM(si.sold_price_usd * si.quantity * (${saleRecognitionWeight("s")})), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity * (${saleRecognitionWeight("s")})), 0) AS cost_usd,
            COUNT(DISTINCT CASE WHEN (${saleRecognitionWeight("s")}) > 0 THEN s.id END) AS count
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND ${dateRange("s.created_at")}
            AND si.tenant_id = ? AND s.tenant_id = ?`,
        )
        .get(
          fromDt,
          toDt,
          getCurrentTenantId(),
          getCurrentTenantId(),
        ) as SalesRevCostRow;
    }

    // PFU-a-1 — the CTE's own `sale_agg AS (` opening stays literal here
    // (the sqlQueryUnits.ts static guard requires it — see
    // netSaleRevenueExpr's own doc comment); the BODY (columns/FROM/WHERE/
    // GROUP BY) is shared via saleAggBody (rule 14 — REV-V1, 2026-09-24),
    // the SAME body `getByDate`'s `daily_sale_agg` subquery and
    // `saleRevenueUsdCaseBranch`'s net-columns subquery now call too — see
    // saleAggBody's own doc comment. `s.created_at` is selected but unused
    // by THIS method — `getByDate`'s own per-day `daily_sale_agg` subquery
    // is the day-grouped sibling that column anticipated (it passes
    // `DATE(s.created_at, 'localtime') AS d,` as its own extraSelectCols
    // instead), not a literal reuse of this CTE.
    // PFU-a-1 (cont.) — `extraWhere` built via plain string concatenation,
    // NOT a nested template literal: a backtick embedded directly inside
    // THIS `.prepare(\`...\`)` call's own template text would give the
    // sqlQueryUnits.ts guard's regex (`\.prepare\(\s*\`([\s\S]*?)\``) a
    // second backtick to stop at before the real one, truncating the
    // captured SQL mid-query — the exact trap `dailyCommissionsAllocationArm`
    // (getByDate) is built as its OWN pre-`.prepare()` variable to avoid (see
    // that variable's own doc comment). `saleAggBody`'s `extraWhere` param is
    // interpolated as literal SQL text either way, so plain concatenation and
    // a nested template literal are byte-identical here — only the SOURCE
    // FILE's own backtick-balance differs.
    const saleAggExtraWhere =
      dateRange("s.created_at") + " AND si.tenant_id = ? AND s.tenant_id = ?";
    return this.db
      .prepare(
        `WITH sale_agg AS (
          ${saleAggBody(
            "s",
            "si",
            "s.id AS sale_id, s.created_at AS created_at,",
            saleAggExtraWhere,
          )}
        )
        SELECT
          COALESCE(SUM(${netSaleRevenueExpr()} * weight), 0) AS revenue_usd,
          COALESCE(SUM(remaining_cost * weight), 0) AS cost_usd,
          COUNT(DISTINCT CASE WHEN weight > 0 THEN sale_id END) AS count
        FROM sale_agg`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as SalesRevCostRow;
  }

  /**
   * Sales profit from the unified ledger (SALE + REFUND). Dated by the
   * SALE's created_at (not the transaction's) so a REFUND nets against the
   * sale's period — matching getSalesRevCost, which sources revenue/cost
   * from sale_items attributed to the same sale. Using the refund
   * transaction's own date would split a refund into a different period than
   * the revenue it reverses, so profit and (revenue − cost) would not
   * reconcile.
   *
   * Owner decision 2026-09-05 (Task 3): weighted by
   * {@link saleRecognitionWeight} instead of gated by the old binary
   * `salePaidOrPartnerSettled` — see getSalesRevCost's own doc comment for
   * the full rationale (identical here; no count column to convert).
   */
  getSalesProfit(fromDt: string, toDt: string): SalesProfitRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(t.profit_usd * (${saleRecognitionWeight("s")})), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp * (${saleRecognitionWeight("s")})), 0) AS profit_lbp
        FROM transactions t
        JOIN sales s ON s.id = t.source_id
        WHERE t.status = 'ACTIVE'
          AND t.source_table = 'sales'
          AND t.type IN ('SALE', 'REFUND')
          AND s.status IN ('completed', 'refunded')
          AND ${dateRange("s.created_at")}
          AND t.tenant_id = ? AND s.tenant_id = ?`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as SalesProfitRow;
  }

  /**
   * Kept change stamped on debt repayments (T3 KC-2). DEBT_REPAYMENT rows
   * carry profit ONLY from keep-change; a voided repayment's REFUND row (same
   * source_table) carries the negated stamp, so summing the pair nets it out —
   * the same SALE+REFUND pattern getSalesProfit uses. Count counts only the
   * repayments themselves, not their refund rows.
   */
  getDebtRepaymentProfit(
    fromDt: string,
    toDt: string,
  ): { profit_usd: number; profit_lbp: number; count: number } {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp,
          COALESCE(SUM(CASE WHEN t.type IN ('DEBT_REPAYMENT', 'KEPT_CHANGE')
                             AND (t.profit_usd != 0 OR t.profit_lbp != 0)
                            THEN 1 ELSE 0 END), 0) AS count
        FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND ${keptChangeSource("t")}
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as {
      profit_usd: number;
      profit_lbp: number;
      count: number;
    };
  }

  /**
   * CQ-10 (D1) — signed profit from counterparty discounts/write-offs
   * (COUNTERPARTY_DISCOUNT rows across all three ledgers: debt/supplier/
   * partner). amount_usd/amount_lbp on these rows are always 0 (no cash
   * moved) — profit_usd/profit_lbp carry the SIGNED discount (forgiven =
   * negative, received = positive). COUNTERPARTY_DISCOUNT is
   * NON_REVERSIBLE_TRANSACTION_TYPES (no void/refund row ever exists to net
   * against), so a plain ACTIVE-status sum is complete — unlike
   * getDebtRepaymentProfit, there's no REFUND counterpart to sum in.
   */
  getCounterpartyDiscountTotals(
    fromDt: string,
    toDt: string,
  ): { profit_usd: number; profit_lbp: number; count: number } {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(profit_usd), 0) AS profit_usd,
          COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
          COUNT(*) AS count
        FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND ${counterpartyDiscountSource("t")}
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as {
      profit_usd: number;
      profit_lbp: number;
      count: number;
    };
  }

  /**
   * PA-2.3 (OWNER_NOTES_2026-09-21.md §6.4) — telecom-credit buyback
   * (`TELECOM_CREDIT_BUYBACK`) and client-funded top-up
   * (`RECHARGE_TOPUP`) profit, previously invisible on the Overview/By
   * Module/By Date (counted only in By Cashier/By Client via
   * `PROFIT_TXN_TYPES`, which already includes both types).
   *
   * Both types stamp `source_table = 'recharges'` (owner ruling 2026-09-21;
   * `RechargeRepository.ts`), so this joins `recharges` the SAME shape
   * `getRechargesByCurrency`/`getRechargesByCarrier` already use — including
   * their `notRefunded(r)` convention: a refunded/voided row is excluded by
   * dropping its ORIGINAL row from the join (the source row's own
   * `is_refunded` flips to 1 — rule 20), not by separately summing a negated
   * REFUND/reversal row. This is deliberately narrower than a bare
   * `t.type IN (...)` scan over `transactions` would be — it reuses the
   * established, already-correct reversal convention for this source table
   * instead of hand-rolling a second one (rule 14).
   *
   * Profit-only (no revenue/cost pair): a buyback's `amount_usd`/`amount_lbp`
   * is the cash paid OUT to the customer (not a sale price), and a top-up's
   * is the credit amount moved between drawers — neither is a meaningful
   * "revenue" figure for this card, matching how debt_repayments/discounts/
   * supplier_commission are already reported (profit-only rows on
   * `ProfitSummary`).
   *
   * Gated by {@link notDebtPending} (a customer-account-charged top-up should
   * defer the same as every other module-debt charge) and
   * {@link partnerCoverageRatio} (a partner-funded top-up recognises its
   * covered share only) — both default to a no-op (full recognition) for the
   * overwhelming majority of rows that have neither, so this is a
   * conservative extension of the existing per-module convention, not new
   * behavior for the common case.
   */
  getTopupBuybackProfit(
    fromDt: string,
    toDt: string,
  ): TopupBuybackProfitRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit_lbp,
          SUM(CASE WHEN (${partnerCoverageRatio("recharges", "r.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM recharges r
        JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id
          AND ${topupBuybackSource("t")}
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("r")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("r.created_at")}
          AND r.tenant_id = ? AND t.tenant_id = ?`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as TopupBuybackProfitRow;
  }

  /**
   * LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md), re-shaped by D17
   * (LIRA-158 follow-up, owner decision 2026-08-31) — the gate now keys on
   * whether real money arrived AT SETTLEMENT, not on `commission_model`:
   *
   *  - **BILLS-ONLY portion** (`billsOnly` below) — UNCHANGED source and
   *    semantics: `SupplierRepository.settleTransactions`'s
   *    `isBillsOnlyBatch` branch stamps the operator's entered commission as
   *    `profit_usd`/`profit_lbp` directly on the SUPPLIER_SETTLEMENT
   *    transaction (a real provider-drawer top-up, or real payment legs,
   *    funded BY the provider — "our profit entirely," owner). This is real
   *    cash the instant it is recognised, so it keeps immediate,
   *    settlement-day recognition byte-for-byte — restricted here to ONLY
   *    the settlements {@link cashlessCommissionBatch} classifies as
   *    bills-only (negated), since a CASHLESS or MIXED batch's stamp is now
   *    sourced from allocations instead (below) and must not ALSO be summed
   *    here (double-count).
   *  - **CASHLESS portion** (`cashless` below; every OTHER new-model batch,
   *    including a MIXED bills+OMT batch — no real money arrives for its
   *    OMT/WHISH share either) — the owner settles OMT/WHISH batches out of
   *    his OWN drawer BEFORE the client who owes for the underlying transfer
   *    has repaid, so this commission is not unconditionally earned; it is
   *    contingent on that repayment, exactly like a legacy
   *    (`commission_model = 0`) embedded-commission row already defers via
   *    `notDebtPending`. Re-sourced from `settlement_commission_allocations`
   *    (the per-row link {@link getFinancialSettledByProvider}'s allocation
   *    arm already established) — the ONLY place this fix can reach each
   *    allocated fs row's OWN client-debt status, since the flat
   *    SUPPLIER_SETTLEMENT/REFUND stamp has no per-row knowledge of it at
   *    all. Gated on {@link allocationNotDebtPending} (D17's new gate) and
   *    {@link notRefunded} (an fs row refunded WITHOUT voiding the
   *    settlement still needs excluding — matching
   *    {@link getFinancialSettledByProvider}'s allocation arm). Owner
   *    decision 2026-09-05 replaced this bucket's THIRD gate — a binary
   *    `notPartnerPending` (supplier-settled != partner-settled) — with the
   *    proportional {@link partnerCoverageRatio} weight below: a partially-
   *    covered partner row now contributes its covered fraction instead of
   *    being excluded whole. `getFinancialSettledByProvider`'s allocation
   *    arm (Lane C's range) still carries the binary `notPartnerPending`
   *    gate unconverted as of this change.
   *
   * **Partition proof (exhaustive + disjoint, no double count):** a
   * settlement's allocation rows are written ATOMICALLY, one per settled fs
   * row, ALL sharing one `settlement_ledger_id` — so
   * `cashlessCommissionBatch` (at least one row's `service_type != 'BILL'`)
   * and its negation (every row is `'BILL'`) partition EVERY new-model
   * (`commission_model = 1`) settlement into exactly one of the two buckets,
   * never both. A LEGACY (`commission_model = 0`) settlement's stamp is 0/0
   * (`SupplierRepository` only stamps `data.commission_usd`/`commission_lbp`
   * when `batchModel === 1`) and it never writes any allocation row at all
   * (`_bookCommissionAtSettlement` only runs `if (batchModel === 1 &&
   * eligibleRows.length > 0)`) — so it contributes 0 to `billsOnly` (its own
   * NOT-cashless classification is moot since its stamp is 0 either way) and
   * 0 to `cashless` (no allocation row exists to sum). Every dollar this
   * method reports comes from exactly ONE source: the transaction stamp
   * (bills-only) or the allocation table (cashless), never both.
   *
   * **Reversal (rule 20), verified per source:** a void/refund
   * hard-DELETEs a settlement's allocation rows
   * (`TransactionRepository._reverseCommissionAtSettlementRecords`), so a
   * voided/refunded CASHLESS settlement's `cashless` contribution drops to
   * exactly 0 with no REFUND-row bookkeeping needed on that side. Its
   * transaction-level stamp (original +X, REFUND -X, or a VOID's
   * zero-profit reversal row) is NEVER read by `billsOnly` in the first
   * place — `cashlessCommissionBatch("source_id")` classifies a CASHLESS
   * settlement's original/REFUND rows identically (both evaluate against the
   * SAME allocation-table state at query time), so neither ever enters
   * `billsOnly` — there is no "REFUND negates a stamp whose positive half
   * came from allocations" hazard, because that positive half was never
   * counted there. A voided BILLS-ONLY settlement nets to 0 the same way it
   * always has (original excluded via `status != 'ACTIVE'` on VOID; REFUND's
   * negated stamp cancels the still-ACTIVE original on a plain refund).
   *
   * **Schema drift** (§5): degrades to the OLD, undifferentiated stamp-only
   * query when `settlement_commission_allocations` doesn't exist at all
   * (pre-v150 fixture) — there is no per-row link to classify against on
   * such a schema, and no cashless-vs-bills split could ever have been
   * written there either.
   */
  getSupplierCommissionTotals(
    fromDt: string,
    toDt: string,
  ): SupplierCommissionTotalsRow {
    const tenantId = getCurrentTenantId();

    if (!this._hasSettlementAllocationsTable()) {
      // Named `degraded` (not returned inline) so the profitRecognition
      // guard's `precedingVarName` heuristic attributes this unit to a
      // meaningful label instead of accidentally borrowing the `tenantId`
      // declared above — see EXCLUDED_UNITS'
      // "ProfitRepository:getSupplierCommissionTotals:degraded" entry.
      const degraded = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(profit_usd), 0) AS profit_usd,
            COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
            COALESCE(SUM(CASE WHEN type = 'SUPPLIER_SETTLEMENT'
                               AND (profit_usd != 0 OR profit_lbp != 0)
                              THEN 1 ELSE 0 END), 0) AS count
          FROM transactions t
          WHERE t.status = 'ACTIVE'
            AND ${supplierSettlementSource("t")}
            AND ${dateRange("t.created_at")}
            AND t.tenant_id = ?`,
        )
        .get(fromDt, toDt, tenantId) as SupplierCommissionTotalsRow;
      // PA-2.1/PA-2.4: no allocations table on this schema means every
      // settlement is pre-D17 (no cashless/bills-only split ever existed) —
      // the whole degraded figure is reported as bills-only, cashless is 0.
      return {
        ...degraded,
        bills_only_profit_usd: degraded.profit_usd,
        bills_only_profit_lbp: degraded.profit_lbp,
        bills_only_count: degraded.count,
        cashless_profit_usd: 0,
        cashless_profit_lbp: 0,
        cashless_count: 0,
      };
    }

    const billsOnly = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(profit_usd), 0) AS profit_usd,
          COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
          COALESCE(SUM(CASE WHEN type = 'SUPPLIER_SETTLEMENT'
                             AND (profit_usd != 0 OR profit_lbp != 0)
                            THEN 1 ELSE 0 END), 0) AS count
        FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND ${supplierSettlementSource("t")}
          AND NOT (${cashlessCommissionBatch("t.source_id")})
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?`,
      )
      .get(fromDt, toDt, tenantId) as SupplierCommissionTotalsRow;

    // Owner decision 2026-09-05: partner coverage is proportional, not
    // binary — a partially-settled cashless commission recognises its
    // covered fraction instead of being excluded whole (partnerCoverageRatio).
    // `count` stays a row tally (never weighted — a fractional count has no
    // sensible rendering), counted once any coverage exists.
    const cashless = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(sca.commission_usd * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_usd,
          COALESCE(SUM(sca.commission_lbp * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_lbp,
          COUNT(DISTINCT CASE WHEN (${partnerCoverageRatio("financial_services", "sca.financial_service_id")}) > 0 THEN sca.settlement_ledger_id END) AS count
        FROM settlement_commission_allocations sca
        JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
        WHERE sca.tenant_id = ?
          AND ${notRefunded("fs")}
          AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
          AND ${allocationNotDebtPending("sca")}
          AND ${dateRange("sca.created_at")}`,
      )
      .get(tenantId, fromDt, toDt) as SupplierCommissionTotalsRow;

    return {
      profit_usd: billsOnly.profit_usd + cashless.profit_usd,
      profit_lbp: billsOnly.profit_lbp + cashless.profit_lbp,
      count: billsOnly.count + cashless.count,
      // PA-2.1/PA-2.4: the two halves this method already computed, exposed
      // separately — see SupplierCommissionTotalsRow's own doc comment.
      bills_only_profit_usd: billsOnly.profit_usd,
      bills_only_profit_lbp: billsOnly.profit_lbp,
      bills_only_count: billsOnly.count,
      cashless_profit_usd: cashless.profit_usd,
      cashless_profit_lbp: cashless.profit_lbp,
      cashless_count: cashless.count,
    };
  }

  /**
   * Settled financial-service commissions (OMT/WHISH family) grouped by
   * currency. Owner decision 2026-09-05: a for-partner row recognises
   * proportionally to partner coverage (partnerCoverageRatio) instead of
   * being excluded whole while any coverage is outstanding. `count` stays a
   * row tally, counted once any coverage exists (never weighted). A currency
   * with zero total contribution (every row fully partner-uncovered) is
   * dropped via {@link havingAnyContribution} — same continuity reasoning as
   * `getFinancialSettledByProvider` (Task 2, PARTNER_PROPORTIONAL_RECOGNITION.md).
   *
   * PA-0.1 — recognition is gated by {@link fsStampRecognized}, not a bare
   * `is_settled = 1`: a model-1 row's stamp (`commission` column here, really
   * `t.profit_usd`/`t.profit_lbp`) never carries deferred supplier
   * commission, so it counts from creation, not from settlement. See that
   * function's own doc comment for the full rationale.
   */
  getFinancialSettledByCurrency(
    fromDt: string,
    toDt: string,
  ): FinCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM((${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS revenue,
          COALESCE(SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS commission,
          SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count,
          COALESCE(SUM((${otherCurrencyKeptChangeUsd("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS kept_change_usd,
          COALESCE(SUM((${otherCurrencyKeptChangeLbp("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS kept_change_lbp
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE ${fsStampRecognized("fs", this._hasCommissionModelColumn())}
          AND fs.provider IN (${COMMISSION_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency
        ${havingAnyContribution([
          `SUM((${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) != 0`,
          `SUM((${otherCurrencyKeptChangeUsd("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM((${otherCurrencyKeptChangeLbp("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
        ])}`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as FinCurrencyRow[];
  }

  /**
   * Owner decision (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md
   * §6.9, L0-4) — "FS commission waiting for a customer's account
   * repayment: ADD a 'waiting for repayment' line to the Financial Services
   * card, kept out of profit until repaid."
   *
   * Mirrors {@link getFinancialSettledByCurrency}'s WHERE gates EXACTLY —
   * same {@link fsStampRecognized} recognition gate, same
   * `COMMISSION_PROVIDERS` restriction, same
   * {@link notRefunded}/{@link dateRange}/tenant gates (rule 14: no re-texted
   * predicate) — but INVERTS {@link notDebtPending} to select precisely the
   * rows that gate excludes from the settled bucket's gross figure: a
   * recognised commission whose underlying transfer is still charged to a
   * CUSTOMER_ACCOUNT and not yet repaid. The two buckets therefore PARTITION
   * the same recognised population (proven by
   * `ProfitRepository.financialWaitingForRepayment.test.ts`) — a row lands
   * in exactly one of {@link getFinancialSettledByCurrency} or here, never
   * both and never neither.
   *
   * PFU-h-count (verifier round 2) — the HAVING deliberately does NOT mirror
   * {@link getFinancialSettledByCurrency}'s own `count != 0` alternative: a
   * row's `count` is 1 whenever it merely has partner-ownership (`ratio >
   * 0`), regardless of whether its `commission` is 0 — a zero-commission
   * model-1 row (real writer's own 0/0 stamp before settlement) always has
   * `ratio > 0`, so a `count != 0` OR would keep it in `stampRows` with
   * `commission: 0`, producing the exact "1 txns, $0.00" reading this bucket
   * must never show (this figure has no `pending_revenue_*`-style non-zero
   * companion to justify a zero-commission row's presence the way a revenue
   * bucket might). Only `SUM(commission) != 0` gates a row in.
   *
   * PFU-h-count-residual (verifier round 3) — that group-level HAVING only
   * ever sees the WHOLE currency group's total, so it cannot catch a
   * zero-commission row sharing its currency with a DIFFERENT row that DOES
   * have a real stamp (the group sum is nonzero, so HAVING passes, and the
   * old `count` — gated on `ratio > 0` alone — counted the zero-commission
   * row too). The per-row `CASE` inside `count` now ALSO requires
   * `ownCurrencyProfit != 0`, so a row only ever contributes to `count` when
   * IT ITSELF has a real stamp, independent of what the rest of its currency
   * group sums to (`ProfitRepository.financialWaitingForRepayment.test.ts`,
   * "a zero-commission model-1 row sharing a currency group with a real
   * stamp does not inflate count").
   *
   * `fsStampRecognized`'s own doc comment (L0-4) names this exact gap: an
   * unsettled model-1 row that is ALSO debt-pending "vanish[ed] from the
   * card entirely, though its stamp still correctly reaches
   * `getDeferredProfit`" (the generic, all-modules deferred bucket) —
   * `getDeferredProfit` stays the right home for "money not yet realized
   * anywhere", while THIS method is the FS-card-specific, per-currency view
   * of that same subset the owner asked for.
   *
   * No `revenue` column (unlike {@link FinCurrencyRow}) — the owner's own
   * wording is "kept out of profit until repaid", i.e. a commission-only
   * figure, never folded into gross/net revenue or profit.
   *
   * PFU-h-1 (verifier round 1, fix-round-1 review) — the STAMP arm above
   * (`t.profit_usd`/`t.profit_lbp` via {@link ownCurrencyProfit}) is the
   * whole story ONLY for a LEGACY (`commission_model = 0`) row, whose
   * embedded commission is stamped on the FINANCIAL_SERVICE transaction
   * itself. A NEW-MODEL (`commission_model = 1`) OMT/WHISH row's real
   * commission is deliberately stamped 0 on that same transaction
   * (`FinancialServiceRepository.ts` ~:2158) — it only becomes real money
   * when the shop SETTLES the batch with the supplier, via
   * `settlement_commission_allocations` (D17/D6). A cashless settlement's
   * allocation is itself deferred a SECOND time by
   * {@link allocationNotDebtPending} (D17: the shop settles OMT/WHISH out of
   * its own drawer before the client repays) — exactly mirroring
   * {@link getSupplierCommissionTotals}'s `cashless` bucket, which this
   * fragment reuses VERBATIM (`cashlessCommissionBatch`, `notRefunded`,
   * {@link allocationNotDebtPending} inverted, `dateRange`, `partnerCoverageRatio`
   * — rule 14, no re-texted predicate) but flips {@link allocationNotDebtPending}
   * to select exactly the debt-pending half `getSupplierCommissionTotals`'s
   * own cashless bucket excludes. Without this arm, a fully
   * CUSTOMER_ACCOUNT-charged model-1 OMT SEND reported `waiting 0/0` even
   * though its commission is real, allocated, and genuinely waiting on the
   * client's own repayment — the exact gap L0-4 named and this bucket exists
   * to close.
   *
   * `commission_usd`/`commission_lbp` are NOT tied to `fs.currency` the way
   * the stamp arm's `ownCurrencyProfit` is: an operator can enter a batch
   * commission split across BOTH currencies regardless of any one fs row's
   * own currency (`SupplierRepository.settleTransactions`'s
   * `allocateProportional` splits `data.commission_usd`/`commission_lbp`
   * independently across the batch's eligible rows). So this arm is summed
   * ONCE across the whole cashless-debt-pending population (matching
   * `getSupplierCommissionTotals`'s own single-row `cashless` shape, not
   * `GROUP BY fs.currency`) and its two currency totals are folded into the
   * USD/LBP output rows directly — `commission_usd` into the `"USD"` row,
   * `commission_lbp` into the `"LBP"` row, creating that currency's row if
   * the stamp arm didn't already produce one.
   *
   * PFU-h-count (verifier round 2) — `count` is `COUNT(DISTINCT
   * financial_service_id)`, i.e. per underlying FS row, not per settlement
   * batch: the earlier `COUNT(DISTINCT settlement_ledger_id)` under-counted a
   * batch covering several rows to "1" and, combined with the stamp arm's
   * old count-based HAVING below, could double it (a settled model-1 row
   * showed up in BOTH the stamp arm — commission 0, count 1, kept alive by a
   * `count != 0` OR the stamp arm's HAVING no longer has — and this cashless
   * arm, reading "2 txns" for one transfer).
   *
   * PFU-h-count-residual (verifier round 3) — `count_usd`/`count_lbp` are
   * now TWO SEPARATE `COUNT(DISTINCT CASE …)` expressions, each gated on
   * that row's OWN `commission_usd`/`commission_lbp` being nonzero, not one
   * combined `count` added to both buckets. The single aggregate `count`
   * this replaced counted every ratio-owning row in the WHOLE batch and
   * folded that same total into BOTH the USD and LBP buckets whenever the
   * batch produced commission in both currencies — a row contributing to
   * USD only (its `commission_lbp` share is 0, since
   * `SupplierRepository.settleTransactions`'s currency-filtered
   * `allocateProportional` — see this method's own doc comment above — never
   * gives a USD-denominated row an LBP share) was still counted again in the
   * LBP bucket, and vice versa. Per-currency counting means a row now
   * contributes to `count` in exactly the currencies it actually has a
   * nonzero share in — still additive across rows within one currency
   * (matching `getSupplierCommissionTotals`'s own additive `count`
   * convention), just no longer additive ACROSS currencies for a row that
   * only touched one of them.
   *
   * Schema-drift-guarded ({@link _hasSettlementAllocationsTable}): degrades
   * to the stamp-only arm alone when `settlement_commission_allocations`
   * doesn't exist (pre-v150 fixture) — matching
   * {@link getSupplierCommissionTotals}'s own degradation, since no cashless
   * allocation could ever have been written on such a schema either.
   */
  getFinancialWaitingForRepaymentByCurrency(
    fromDt: string,
    toDt: string,
  ): FsWaitingForRepaymentRow[] {
    const tenantId = getCurrentTenantId();
    const stampRows = this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS commission,
          SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 AND (${ownCurrencyProfit("fs.currency")}) != 0 THEN 1 ELSE 0 END) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE ${fsStampRecognized("fs", this._hasCommissionModelColumn())}
          AND fs.provider IN (${COMMISSION_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND NOT (${notDebtPending("t.id")})
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency
        ${havingAnyContribution([
          `SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
        ])}`,
      )
      .all(
        fromDt,
        toDt,
        tenantId,
        tenantId,
      ) as FsWaitingForRepaymentRow[];

    const byCurrency = new Map<string, FsWaitingForRepaymentRow>();
    for (const row of stampRows) {
      byCurrency.set(row.currency, { ...row });
    }

    if (this._hasSettlementAllocationsTable()) {
      const cashless = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(sca.commission_usd * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS commission_usd,
            COALESCE(SUM(sca.commission_lbp * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS commission_lbp,
            COUNT(DISTINCT CASE WHEN (${partnerCoverageRatio("financial_services", "sca.financial_service_id")}) > 0 AND sca.commission_usd != 0 THEN sca.financial_service_id END) AS count_usd,
            COUNT(DISTINCT CASE WHEN (${partnerCoverageRatio("financial_services", "sca.financial_service_id")}) > 0 AND sca.commission_lbp != 0 THEN sca.financial_service_id END) AS count_lbp
          FROM settlement_commission_allocations sca
          JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
          WHERE sca.tenant_id = ?
            AND ${notRefunded("fs")}
            AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
            AND NOT (${allocationNotDebtPending("sca")})
            AND ${dateRange("sca.created_at")}`,
        )
        .get(tenantId, fromDt, toDt) as {
        commission_usd: number;
        commission_lbp: number;
        count_usd: number;
        count_lbp: number;
      };

      if (cashless.commission_usd !== 0) {
        const existing = byCurrency.get("USD");
        byCurrency.set("USD", {
          currency: "USD",
          commission: (existing?.commission ?? 0) + cashless.commission_usd,
          count: (existing?.count ?? 0) + cashless.count_usd,
        });
      }
      if (cashless.commission_lbp !== 0) {
        const existing = byCurrency.get("LBP");
        byCurrency.set("LBP", {
          currency: "LBP",
          commission: (existing?.commission ?? 0) + cashless.commission_lbp,
          count: (existing?.count ?? 0) + cashless.count_lbp,
        });
      }
    }

    return Array.from(byCurrency.values());
  }

  /**
   * Pending (unsettled) financial-service commissions grouped by currency.
   *
   * PA-0.1 — restricted to LEGACY (`commission_model = 0`,
   * {@link embeddedCommission}) rows. A model-1 row is never "pending
   * commission" in this bucket's sense: its stamp is recognised from
   * creation ({@link fsStampRecognized}, applied to this bucket's settled
   * sibling {@link getFinancialSettledByCurrency}), so an unsettled model-1
   * row belongs there, not here — counting it in both (or in neither) would
   * either double-count or silently drop it.
   *
   * L0-4 — this bucket has NO `notDebtPending` gate of its own (it never
   * needed one: a legacy row's revenue/count only ever move here vs. its
   * settled sibling, both undecided by debt status). A CUSTOMER_ACCOUNT-
   * debt-pending MODEL-1 row is therefore never double-counted here either —
   * it is excluded from the settled sibling by `notDebtPending` and never
   * reaches this bucket at all (model-1 is out of scope for this method).
   * See {@link fsStampRecognized}'s own doc comment (L0-4) for where that
   * row's revenue actually goes (nowhere on this card — `getDeferredProfit`
   * only).
   */
  getFinancialPendingByCurrency(
    fromDt: string,
    toDt: string,
  ): FinCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS commission,
          COALESCE(SUM((${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS revenue,
          SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.is_settled = 0
          AND ${embeddedCommission("fs", this._hasCommissionModelColumn())}
          AND fs.provider IN (${COMMISSION_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency
        ${havingAnyContribution([
          `SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM((${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) != 0`,
        ])}`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as FinCurrencyRow[];
  }

  /**
   * Mobile services (iPick/Katsh/BOB) revenue/cost/profit grouped by currency.
   * Owner decision 2026-09-05: a for-partner iPick/Katsh row recognises
   * proportionally to partner coverage (partnerCoverageRatio) — revenue,
   * cost and profit all scale by the SAME per-row ratio, matching the
   * deferred bucket / daily trend / getByUser/getByClient's own for-partner
   * treatment. `count` stays a row tally, counted once any coverage exists
   * (never weighted — a fractional count has no sensible rendering). A
   * currency with zero total contribution (every row fully
   * partner-uncovered) is dropped via {@link havingAnyContribution} — same
   * continuity reasoning as `getFinancialSettledByProvider` (Task 2,
   * PARTNER_PROPORTIONAL_RECOGNITION.md).
   */
  getMobileServicesByCurrency(
    fromDt: string,
    toDt: string,
  ): MobileCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM(fs.price * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS revenue,
          COALESCE(SUM(fs.cost * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS cost,
          COALESCE(SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS profit,
          -- LO-R4 (round 3, rule 14) — kept change via the SAME shared
          -- otherCurrencyKeptChangeUsd/Lbp fragments every other query in
          -- this file uses, not a hand-written CASE...ELSE. The hand-written
          -- version's ELSE was an INCLUSIVE fallback (any non-LBP currency,
          -- including a hypothetical third currency, landed in the
          -- USD-kept-change bucket) — a different rule from the fragments'
          -- EXACT 'USD'/'LBP' match (PA-1.4). Summing both fragments is
          -- safe: exactly one is non-zero for a given fs.currency group (a
          -- 'LBP' group only ever matches otherCurrencyKeptChangeUsd's
          -- currency = 'LBP' condition; a 'USD' group only ever matches
          -- otherCurrencyKeptChangeLbp's), and a third-currency group
          -- matches NEITHER, correctly dropping it.
          COALESCE(SUM((${otherCurrencyKeptChangeUsd("fs.currency")} + ${otherCurrencyKeptChangeLbp("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS kept_change,
          SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.provider IN (${MOBILE_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency
        ${havingAnyContribution([
          `SUM(fs.price * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM(fs.cost * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM((${ownCurrencyProfit("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM((${otherCurrencyKeptChangeUsd("fs.currency")} + ${otherCurrencyKeptChangeLbp("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) != 0`,
        ])}`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as MobileCurrencyRow[];
  }

  /**
   * Recharges (MTC/Alfa) revenue/cost/profit grouped by currency. Owner
   * decision 2026-09-05: a for-partner recharge recognises proportionally
   * to partner coverage (partnerCoverageRatio); `count` stays a row tally,
   * counted once any coverage exists (never weighted). A currency with zero
   * total contribution (every row fully partner-uncovered) is dropped via
   * {@link havingAnyContribution} — same continuity reasoning as
   * `getFinancialSettledByProvider` (Task 2, PARTNER_PROPORTIONAL_RECOGNITION.md).
   */
  getRechargesByCurrency(fromDt: string, toDt: string): RechargeCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          r.currency_code AS currency_code,
          COALESCE(SUM(r.price * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS revenue,
          COALESCE(SUM(r.cost * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS cost,
          COALESCE(SUM((${ownCurrencyProfit("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit,
          -- LO-R4 (round 3, rule 14) — same shared otherCurrencyKeptChangeUsd/
          -- Lbp fragments as getMobileServicesByCurrency's identical fix
          -- above, replacing a hand-written CASE...ELSE whose ELSE was an
          -- INCLUSIVE fallback (a different rule from the fragments' EXACT
          -- 'USD'/'LBP' match, PA-1.4) — see that query's own comment for
          -- why summing both fragments is safe.
          COALESCE(SUM((${otherCurrencyKeptChangeUsd("r.currency_code")} + ${otherCurrencyKeptChangeLbp("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS kept_change,
          SUM(CASE WHEN (${partnerCoverageRatio("recharges", "r.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM recharges r
        JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("r")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("r.created_at")}
          AND r.tenant_id = ? AND t.tenant_id = ?
        GROUP BY r.currency_code
        ${havingAnyContribution([
          `SUM(r.price * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
          `SUM(r.cost * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
          `SUM((${ownCurrencyProfit("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
          `SUM((${otherCurrencyKeptChangeUsd("r.currency_code")} + ${otherCurrencyKeptChangeLbp("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
          `SUM(CASE WHEN (${partnerCoverageRatio("recharges", "r.id")}) > 0 THEN 1 ELSE 0 END) != 0`,
        ])}`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as RechargeCurrencyRow[];
  }

  /**
   * Custom services totals (revenue/cost from source, profit from
   * transactions). Owner decision 2026-09-05: a for-partner job recognises
   * proportionally to partner coverage (partnerCoverageRatio) across every
   * monetary column; `count` stays a row tally, counted once any coverage
   * exists (never weighted).
   */
  getCustomServicesTotals(fromDt: string, toDt: string): CustomTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(cs.price_usd * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS revenue_usd,
          COALESCE(SUM(cs.price_lbp * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS revenue_lbp,
          COALESCE(SUM(cs.cost_usd * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS cost_usd,
          COALESCE(SUM(cs.cost_lbp * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS cost_lbp,
          COALESCE(SUM(t.profit_usd * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS profit_lbp,
          SUM(CASE WHEN (${partnerCoverageRatio("custom_services", "cs.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM custom_services cs
        JOIN transactions t ON t.source_table = 'custom_services' AND t.source_id = cs.id AND t.type = 'CUSTOM_SERVICE'
        WHERE cs.status = 'completed'
          AND t.status = 'ACTIVE'
          AND ${notRefunded("cs")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("cs.created_at")}
          AND cs.tenant_id = ? AND t.tenant_id = ?`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as CustomTotalsRow;
  }

  /**
   * Maintenance totals (revenue/cost from source, profit from transactions).
   * LBP jobs stamp profit_lbp (not profit_usd) — summing only the USD columns
   * made every LBP maintenance job invisible in the profits views.
   */
  getMaintenanceTotals(fromDt: string, toDt: string): MaintTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(m.final_amount_usd), 0) AS revenue_usd,
          COALESCE(SUM(m.final_amount_lbp), 0) AS revenue_lbp,
          COALESCE(SUM(${maintenanceCostUsd("m")}), 0) AS cost_usd,
          COALESCE(SUM(m.cost_lbp), 0) AS cost_lbp,
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp,
          COUNT(*) AS count,
          COALESCE(SUM(m.parts_price_usd), 0) AS parts_revenue_usd,
          COALESCE(SUM(m.parts_cost_usd), 0) AS parts_cost_usd
        FROM maintenance m
        JOIN transactions t ON t.source_table = 'maintenance' AND t.source_id = m.id AND t.type = 'MAINTENANCE'
        WHERE ${maintenanceCompleted("m")}
          AND t.status = 'ACTIVE'
          AND ${notRefunded("m")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("m.created_at")}
          AND m.tenant_id = ? AND t.tenant_id = ?`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as MaintTotalsRow;
  }

  /**
   * Loto ticket commissions (LBP). Loto stamps its commission as profit_lbp on
   * the LOTO transaction at sale time but was absent from every profits view.
   * Revenue is the ticket face value; profit is the shop's commission cut.
   * Owner decision 2026-09-05: a for-partner ticket recognises proportionally
   * to partner coverage (partnerCoverageRatio); `count` stays a row tally,
   * counted once any coverage exists (never weighted).
   */
  getLotoTotals(fromDt: string, toDt: string): LotoTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(lt.sale_amount * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS revenue_lbp,
          COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS profit_lbp,
          -- LO-V1/PA-3.1 — a loto ticket is always LBP-native, so ANY
          -- t.profit_usd stamped on its transaction row is, by construction,
          -- USD-side kept change (probe: a $1 kept change on a loto sale
          -- showed gross_usd = 0 before this).
          COALESCE(SUM(t.profit_usd * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS kept_change_usd,
          SUM(CASE WHEN (${partnerCoverageRatio("loto_tickets", "lt.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM loto_tickets lt
        JOIN transactions t ON t.source_table = 'loto_tickets' AND t.source_id = lt.id AND t.type = 'LOTO'
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("lt")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("lt.created_at")}
          AND lt.tenant_id = ? AND t.tenant_id = ?`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as LotoTotalsRow;
  }

  /**
   * Payment-method fees (PM_FEE audit rows) per currency. The fee the customer
   * pays on top when paying through a wallet stays in the wallet drawer as
   * immediate shop profit (realized at once — NOT gated by is_settled), but was
   * never counted in any profits view.
   *
   * Sourced from `financial_services.payment_method_fee` (the fee is stored on
   * the FS row) gated by `notRefunded`, dated by fs.created_at — the SAME
   * retroactive-removal semantics as commissions. Summing raw PM_FEE payment
   * rows instead would break at report boundaries: a void/refund's negated
   * PM_FEE row lands in the reversal's period (created_at = reversal time), so a
   * cross-period reversal would overstate the original period while the
   * commission was removed retroactively.
   */
  getPmFeeTotals(fromDt: string, toDt: string): PmFeeCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency_code,
          COALESCE(SUM(fs.payment_method_fee), 0) AS total,
          COUNT(*) AS count
        FROM financial_services fs
        WHERE COALESCE(fs.payment_method_fee, 0) <> 0
          AND ${notRefunded("fs")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ?
        GROUP BY fs.currency`,
      )
      .all(fromDt, toDt, getCurrentTenantId()) as PmFeeCurrencyRow[];
  }

  /**
   * Exchange totals (v30+: leg1 + leg2 profit; revenue = the row's USD leg —
   * see {@link exchangeUsdRevenue}, fixed 2026-09-23 for owner ticket #27: it
   * used to be a raw sum of `amount_in`, which is denominated in
   * `from_currency` and could be an LBP-scale figure posing as `$`).
   * Owner decision 2026-09-05: a for-partner exchange recognises
   * proportionally to partner coverage (partnerCoverageRatio); `count` stays
   * a row tally, counted once any coverage exists (never weighted).
   */
  getExchangeTotals(fromDt: string, toDt: string): ExchangeTotalsRow {
    const usdRevenue = exchangeUsdRevenue(
      "exchange_transactions",
      this._hasExchangeCurrencyColumns(),
    );
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM((${EXCHANGE_LEG_PROFIT}) * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS profit_usd,
          COALESCE(SUM((${usdRevenue}) * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS revenue_usd,
          SUM(CASE WHEN (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM exchange_transactions
        WHERE ${notRefunded("exchange_transactions")}
          AND ${dateRange("created_at")}
          AND tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as ExchangeTotalsRow;
  }

  /**
   * Active expenses totals in the date range.
   *
   * "Active" means both `status='active'` and not-refunded — see
   * {@link activeExpense} for why both gates are required (an expense can be
   * undone through two different doors, each flipping a different column).
   * Gating on `status` alone kept a transaction-viewer-voided expense in the
   * profit page's expense bucket forever, while its drawer leg had already
   * been reversed — the reversal-symmetry hole (rule 20) that LIRA-145's
   * `Line_Usage` netting proof surfaced. It was never specific to line usage:
   * EVERY expense voided from the Transactions table hit it.
   */
  getExpenseTotals(fromDt: string, toDt: string): ExpenseTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(amount_usd), 0) AS total_usd,
          COALESCE(SUM(amount_lbp), 0) AS total_lbp,
          COUNT(*) AS count
        FROM expenses
        WHERE ${activeExpense()}
          AND ${dateRange("expense_date")}
          AND tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as ExpenseTotalsRow;
  }

  /**
   * Deferred profit (owner ask 2026-07-14): the slice of transactions.profit_usd
   * / profit_lbp that is currently STRANDED behind an uncovered partner FOR_%
   * row (PFT-6) or an uncovered client-debt charge row (DBT-1) — the
   * complement of the recognition {@link getByUser}/{@link getByClient} apply
   * before counting a transaction's profit as realized.
   *
   * PROPORTIONAL CONVERSION (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md
   * Step 2) — `partnerRow` no longer gates by `txnNotPartnerPending("t")`
   * (an all-or-nothing "is ANY FOR_% row uncovered" test). Under proportional
   * recognition a partner row is no longer either fully realized or fully
   * deferred — {@link getByUser}/{@link getByClient} now recognise
   * `profit_usd * txnPartnerCoverageRatio(t)` per DBT-2-gated row (their own
   * conversion, this same step), so the DEFERRED complement of that, for the
   * SAME row, is `profit_usd * (1 - txnPartnerCoverageRatio(t))` — the
   * UNCOVERED remainder, not the full stamp. Multiplying by `(1 - ratio)`
   * over the UNGATED population (instead of filtering to "not fully covered"
   * then summing the full stamp) makes a non-partner or fully-covered row
   * contribute exactly 0 (ratio = 1 -> 1 - ratio = 0, same as being excluded
   * by the old WHERE), and an uncovered row contribute its full stamp
   * (ratio = 0 -> 1 - ratio = 1, same as the old WHERE's fully-in case) — the
   * two extremes reproduce the prior binary behaviour exactly, and only a
   * PARTIALLY covered row now differs, moving continuously between them.
   * This is what keeps `realized + deferred` reconciling to the row's full
   * stamp at every coverage level, not just at the two extremes (rule 20,
   * satisfied the same way the ratio fragment itself is: derived at read
   * time from `covered_amount`, so a refund's reverse-FIFO unwind corrects
   * both sides automatically on the next read, with no separate reversal
   * bookkeeping for THIS bucket either). `clientDebtRow` below is
   * deliberately UNTOUCHED by this conversion — client debt (DBT-1, the
   * `notDebtPending` gate) is explicitly OUT OF SCOPE for proportional
   * recognition (owner decision 2026-09-05 scopes this to partner
   * obligations only) and stays the same binary all-or-nothing bucket it
   * was before. Pre-existing, unrelated-to-this-conversion note: a
   * transaction that is BOTH partner-pending (partially) AND debt-pending
   * has NO gate coupling the two buckets together (each is computed by its
   * own independent query, exactly as before this conversion) — such a row
   * contributes to `partnerRow` AND (fully) to `clientDebtRow`
   * simultaneously, so the two deferred buckets are two independent
   * diagnostic reasons, not a strict partition; this overlap already existed
   * in the pre-conversion binary code (a fully-stamped double count in that
   * edge case, not something this conversion introduces or widens).
   *
   * D17 (LIRA-158 follow-up, owner decision 2026-08-31) — NON-OPTIONAL
   * addition: `clientDebtRow` above is transaction-shaped
   * (`t.type IN (PROFIT_TXN_TYPES)`, `notDebtPending("t.id")`), so it cannot
   * see a CASHLESS settlement's deferred commission at all — the
   * FINANCIAL_SERVICE transaction stamps 0 for a model-1 row (Phase 1), and
   * the SUPPLIER_SETTLEMENT transaction has no `debt_ledger` row keyed to
   * ITS OWN id (debt is keyed to the fs row's transaction, not the
   * settlement's), so it always passes `notDebtPending` and never lands
   * here. Without `cashlessDeferredRow` below, D17's whole point — money
   * that STOPS being recognised at settlement — would simply vanish from
   * every profits view instead of showing up as deferred. Sourced from
   * `settlement_commission_allocations` (mirrors
   * {@link getSupplierCommissionTotals}'s cashless bucket exactly, negating
   * its {@link allocationNotDebtPending} gate to select the STILL-PENDING
   * allocations instead of the covered ones), restricted to
   * {@link cashlessCommissionBatch} (a bills-only settlement's commission is
   * real money the instant it's recognised — never deferred, never here) and
   * {@link notRefunded} (matching every other allocation-sourced query in
   * this file). Degrades to a 0 contribution when
   * `settlement_commission_allocations` doesn't exist (§5) — reconciles with
   * `getSupplierCommissionTotals`'s own schema-drift degradation, which on
   * such a fixture recognises the OLD, undifferentiated stamp immediately
   * (nothing left to defer).
   */
  getDeferredProfit(fromDt: string, toDt: string): DeferredProfitRow {
    const tenantId = getCurrentTenantId();

    const partnerRow = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(t.profit_usd * (1 - ${txnPartnerCoverageRatio("t")})), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp * (1 - ${txnPartnerCoverageRatio("t")})), 0) AS profit_lbp
        FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?`,
      )
      .get(fromDt, toDt, tenantId) as {
      profit_usd: number;
      profit_lbp: number;
    };

    const clientDebtRow = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
        FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND NOT (${notDebtPending("t.id")})
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?`,
      )
      .get(fromDt, toDt, tenantId) as {
      profit_usd: number;
      profit_lbp: number;
    };

    const cashlessDeferredRow = this._hasSettlementAllocationsTable()
      ? (this.db
          .prepare(
            `SELECT
              COALESCE(SUM(sca.commission_usd), 0) AS profit_usd,
              COALESCE(SUM(sca.commission_lbp), 0) AS profit_lbp
            FROM settlement_commission_allocations sca
            JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
            WHERE sca.tenant_id = ?
              AND ${notRefunded("fs")}
              AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
              AND NOT (${allocationNotDebtPending("sca")})
              AND ${dateRange("sca.created_at")}`,
          )
          .get(tenantId, fromDt, toDt) as {
          profit_usd: number;
          profit_lbp: number;
        })
      : { profit_usd: 0, profit_lbp: 0 };

    return {
      partner_profit_usd: partnerRow.profit_usd,
      partner_profit_lbp: partnerRow.profit_lbp,
      client_debt_profit_usd:
        clientDebtRow.profit_usd + cashlessDeferredRow.profit_usd,
      client_debt_profit_lbp:
        clientDebtRow.profit_lbp + cashlessDeferredRow.profit_lbp,
      // PA-3.10: the cashless share ALONE, so a caller can gate the
      // "Supplier Commission: Deferred" card on this figure instead of the
      // combined client_debt_profit_usd/_lbp above (which fires for ANY
      // debt-pending profit, including ordinary unpaid recharge/service/
      // loto/maintenance debt — see DeferredProfitRow's own doc comment).
      cashless_deferred_profit_usd: cashlessDeferredRow.profit_usd,
      cashless_deferred_profit_lbp: cashlessDeferredRow.profit_lbp,
    };
  }

  // ---------------------------------------------------------------------------
  // By module (getByModule)
  // ---------------------------------------------------------------------------

  /**
   * Settled financial-service revenue/profit grouped by provider.
   *
   * LIRA-158 Phase 3 — restores per-provider ATTRIBUTION for
   * `commission_model = 1` rows. The base arm below (unchanged from before
   * Phase 3) already carries every settled fs row's revenue and count,
   * dated by `fs.created_at` (transaction day) — Phase 1 only zeroed the
   * COMMISSION TERM of the profit stamp for a model-1 row, so this arm
   * self-corrects to 0 profit for those rows without losing their revenue.
   * The real commission for a model-1 row is recognised on the settlement
   * day instead (D7), on a `SUPPLIER_SETTLEMENT` transaction that is NOT a
   * `financial_services` row and so cannot join here — its per-provider
   * share lives in `settlement_commission_allocations` instead
   * (LIRA-158_COMMISSION_REPORTING_PLAN.md §1.4). The second arm (added by
   * this UNION, guarded by {@link _hasSettlementAllocationsTable}) adds
   * exactly that share, dated by `sca.created_at` (settlement day) via
   * {@link currentSettlementAllocation}'s join shape, and re-aggregates with
   * the first arm so a provider settled in BOTH shapes within one period
   * gets one combined row.
   *
   * Deliberately `0 AS count` on the allocation arm: the underlying fs row
   * was already counted once by the base arm (which counts every settled fs
   * row unconditionally, regardless of `commission_model`) whenever both
   * arms fall in the same reporting period — adding a second count there
   * would double it. `revenue_usd`/`revenue_lbp` are `0` for the same
   * reason the doc comment on `getSupplierCommissionTotals` gives: an
   * allocation carries a commission SHARE only, no revenue/cost pair of its
   * own. A provider whose only settled activity in-period is a model-1
   * allocation (its underlying fs row transacted in an EARLIER period) still
   * surfaces via this arm's own `GROUP BY sca.provider`, with
   * `revenue_usd: 0`/`count: 0` and the real commission in `profit_usd`/
   * `profit_lbp` — not silently dropped.
   *
   * Gates on the allocation arm: {@link notRefunded} (an fs row refunded
   * WITHOUT voiding the settlement still needs excluding — the allocation
   * row survives that refund path since only a voided SETTLEMENT
   * hard-deletes allocations). No reversal predicate is needed beyond that:
   * a voided settlement hard-DELETEs its allocation rows
   * (`TransactionRepository.ts` — `DELETE FROM
   * settlement_commission_allocations WHERE settlement_ledger_id = ?`), so a
   * reversed allocation is physically gone rather than needing an
   * `is_voided` filter.
   *
   * Proportional recognition (owner decision 2026-09-05): a FOR-partner fs
   * row's allocated commission share no longer defers all-or-nothing on
   * {@link notPartnerPending}. Both `profit_usd`/`profit_lbp` here (and the
   * base arm's revenue/cost/profit/count below) are weighted by
   * {@link partnerCoverageRatio} instead — the same partner_ledger FOR_%
   * rows, read as a continuous `[0,1]` fraction rather than a binary gate.
   * `count` stays `0 AS count` regardless (unaffected — see the base arm's
   * own note on why counts are never weighted, only gated on `ratio > 0`).
   *
   * UPDATED by D17 (LIRA-158 follow-up, owner decision 2026-08-31; this
   * paragraph replaces a now-FALSE claim that lived here — "commission
   * recognition at settlement is against the SUPPLIER relationship, not the
   * client's account status" is no longer true for a CASHLESS settlement):
   * the owner settles OMT/WHISH batches out of his OWN drawer BEFORE the
   * client who owes for the underlying transfer has repaid, so a cashless
   * settlement's commission is contingent on that repayment. This arm now
   * ALSO carries {@link allocationNotDebtPending} (the new D17 gate) and
   * {@link cashlessCommissionBatch} (restricting this arm to CASHLESS
   * settlements only — a BILLS-ONLY settlement's commission is real money
   * the instant it's recognised, per {@link getSupplierCommissionTotals}'s
   * own doc comment, and stays out of this UNION arm entirely to avoid
   * double-counting against that method's now-separate bills-only bucket).
   *
   * Task 2 continuity guard (2026-09-05): the outer `GROUP BY provider` now
   * carries {@link havingAnyContribution} — see its own doc comment for why
   * a fully partner-uncovered provider (ratio 0 on every one of its rows)
   * must be DROPPED from this list, not shown as a zero-valued row. This is
   * what `LIRA158.settlementAttribution.test.ts`'s "does not surface its
   * commission" case (a WHISH row settled with the supplier but wholly
   * uncovered by partner) asserts: `rows.find(r => r.provider === 'WHISH')`
   * must be `undefined`, matching the pre-conversion binary gate exactly.
   *
   * PA-0.1 (OWNER_NOTES_2026-09-21.md §6.2) — the base arm's WHERE is gated
   * by {@link fsStampRecognized}, not a bare `fs.is_settled = 1`: a model-1
   * row's stamp never carries deferred supplier commission, so it is
   * attributed to its provider from creation, not from settlement (the
   * separate settlement commission still arrives via the allocation arm
   * below, dated by `sca.created_at`, unaffected). A model-0 (legacy) row
   * still needs `is_settled = 1`, which the predicate preserves.
   */
  getFinancialSettledByProvider(
    fromDt: string,
    toDt: string,
  ): FinByProviderRow[] {
    const tenantId = getCurrentTenantId();
    const hasAllocations = this._hasSettlementAllocationsTable();
    const allocationArm = hasAllocations
      ? `
        UNION ALL
        SELECT
          sca.provider AS provider,
          0 AS revenue_usd,
          0 AS revenue_lbp,
          0 AS cost_usd,
          0 AS cost_lbp,
          COALESCE(SUM(sca.commission_usd * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_usd,
          COALESCE(SUM(sca.commission_lbp * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_lbp,
          -- LO-V1: a settlement-allocation row has no dual-currency
          -- transaction stamp of its own (sca.commission_usd/_lbp are
          -- settlement amounts, not a kept-change-carrying stamp) — 0 to
          -- keep this arm's column count matching the base arm's for UNION ALL.
          0 AS kept_change_usd,
          0 AS kept_change_lbp,
          0 AS count
        FROM settlement_commission_allocations sca
        JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
        WHERE sca.tenant_id = ?
          AND ${notRefunded("fs")}
          AND ${allocationNotDebtPending("sca")}
          AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
          AND ${dateRange("sca.created_at")}
        GROUP BY sca.provider`
      : "";

    const params: (string | number)[] = [fromDt, toDt, tenantId, tenantId];
    if (hasAllocations) params.push(tenantId, fromDt, toDt);

    return this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(SUM(revenue_usd), 0) AS revenue_usd,
          COALESCE(SUM(revenue_lbp), 0) AS revenue_lbp,
          COALESCE(SUM(cost_usd), 0) AS cost_usd,
          COALESCE(SUM(cost_lbp), 0) AS cost_lbp,
          COALESCE(SUM(profit_usd), 0) AS profit_usd,
          COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
          COALESCE(SUM(kept_change_usd), 0) AS kept_change_usd,
          COALESCE(SUM(kept_change_lbp), 0) AS kept_change_lbp,
          COALESCE(SUM(count), 0) AS count
        FROM (
          SELECT
            fs.provider AS provider,
            -- PA-1.4: EXACT currency match ('USD'/'LBP'), not '!= LBP' — a
            -- third currency (e.g. a Binance USDT row) used to be lumped
            -- into the USD bucket; it now contributes to neither, matching
            -- the Overview's own getFinancialSettledByCurrency (which
            -- already groups by fs.currency with no such binary fallback).
            COALESCE(SUM(CASE WHEN fs.currency = 'USD' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_lbp,
            -- PA-2.9: real BILL-flow cost (fs.cost; 0 for a plain
            -- SEND/RECEIVE) — was hard-coded 0 at the ProfitService layer
            -- while revenue = price.
            COALESCE(SUM(CASE WHEN fs.currency = 'USD' THEN fs.cost * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS cost_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN fs.cost * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS cost_lbp,
            COALESCE(SUM(CASE WHEN fs.currency = 'USD' THEN t.profit_usd * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS profit_lbp,
            -- LO-V1/PA-3.1 — kept change stamped in the OTHER currency (see
            -- otherCurrencyKeptChangeUsd/Lbp's own doc comment): before this,
            -- an LBP-native fs row's USD change (or a USD row's LBP change)
            -- was dropped here entirely.
            COALESCE(SUM((${otherCurrencyKeptChangeUsd("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS kept_change_usd,
            COALESCE(SUM((${otherCurrencyKeptChangeLbp("fs.currency")}) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS kept_change_lbp,
            -- LO-EUR-phantom (open_LO.txt) — count only fs.currency IN
            -- ('USD', 'LBP') rows. Every revenue/cost/profit column above is
            -- already currency-gated by PA-1.4 (a third currency like EUR/
            -- USDT contributes 0 to all of them), but this count was NOT, so
            -- a provider with ONLY third-currency rows still produced
            -- count = 1 and survived havingAnyContribution's OR below —
            -- an all-zero "FINANCIAL_SERVICE_OMT: 0/0 ... count 1" row
            -- (probe S5). The Overview's own count (ProfitService's finSvc
            -- loop, LO-V10) already only adds a row's count inside its
            -- matched USD/LBP branch, dropping an EUR row's count
            -- entirely — this makes By Module agree with it instead of the
            -- two tabs disagreeing on the same period's count.
            SUM(CASE WHEN fs.currency IN ('USD', 'LBP') AND (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count
          FROM financial_services fs
          JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
          -- PA-2.8/LO-V2: a mobile-services provider (iPick/Katsh/BOB)
          -- recognises unconditionally, the SAME way getMobileServicesByCurrency
          -- (the Overview's own mobile-services query) already does; a
          -- commission provider (OMT/WHISH/...) still needs fsStampRecognized;
          -- a provider outside BOTH known lists is now excluded here too,
          -- matching the Overview (see fsProviderRowRecognized's own doc
          -- comment for the full rationale and the probe that found the gap).
          WHERE ${fsProviderRowRecognized("fs", this._hasCommissionModelColumn())}
            AND t.status = 'ACTIVE'
            AND ${notRefunded("fs")}
            AND ${notDebtPending("t.id")}
            AND ${dateRange("fs.created_at")}
            AND fs.tenant_id = ? AND t.tenant_id = ?
          GROUP BY fs.provider
          ${allocationArm}
        ) combined
        GROUP BY provider
        ${havingAnyContribution(["SUM(revenue_usd) != 0", "SUM(revenue_lbp) != 0", "SUM(cost_usd) != 0", "SUM(cost_lbp) != 0", "SUM(profit_usd) != 0", "SUM(profit_lbp) != 0", "SUM(kept_change_usd) != 0", "SUM(kept_change_lbp) != 0", "SUM(count) != 0"])}`,
      )
      .all(...params) as FinByProviderRow[];
  }

  /**
   * Recharge revenue/cost/profit grouped by carrier. Weighted by
   * {@link partnerCoverageRatio} (owner decision 2026-09-05); a carrier with
   * zero total contribution (every row fully partner-uncovered) is dropped
   * from the list via {@link havingAnyContribution} — a phantom "MTC —
   * $0.00" row would be a user-visible regression the old binary gate never
   * produced (Task 2, PARTNER_PROPORTIONAL_RECOGNITION.md).
   */
  getRechargesByCarrier(fromDt: string, toDt: string): RechargeByCarrierRow[] {
    return this.db
      .prepare(
        `SELECT
          r.carrier AS carrier,
          -- LO-V10 (round 2, rule 14 consistency): EXACT 'USD' match, not
          -- '!= LBP' — matches the exact-currency discipline PA-1.4 already
          -- applied to the FS-provider query above (recharges only ever
          -- store 'USD'/'LBP' today, so this changes no observable total; it
          -- removes the ONE inconsistent bucketing style left in this file).
          COALESCE(SUM(CASE WHEN r.currency_code = 'USD' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_lbp,
          COALESCE(SUM(CASE WHEN r.currency_code = 'USD' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_lbp,
          COALESCE(SUM(CASE WHEN r.currency_code = 'USD' THEN t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS profit_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS profit_lbp,
          -- LO-V1/PA-3.1 — kept change stamped in the OTHER currency (see
          -- otherCurrencyKeptChangeUsd/Lbp's own doc comment).
          COALESCE(SUM((${otherCurrencyKeptChangeUsd("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS kept_change_usd,
          COALESCE(SUM((${otherCurrencyKeptChangeLbp("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS kept_change_lbp,
          SUM(CASE WHEN (${partnerCoverageRatio("recharges", "r.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM recharges r
        JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("r")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("r.created_at")}
          AND r.tenant_id = ? AND t.tenant_id = ?
        GROUP BY r.carrier
        ${havingAnyContribution([
          `SUM(CASE WHEN r.currency_code = 'USD' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'USD' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'USD' THEN t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM((${otherCurrencyKeptChangeUsd("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
          `SUM((${otherCurrencyKeptChangeLbp("r.currency_code")}) * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
          `SUM(CASE WHEN (${partnerCoverageRatio("recharges", "r.id")}) > 0 THEN 1 ELSE 0 END) != 0`,
        ])}`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as RechargeByCarrierRow[];
  }

  // ---------------------------------------------------------------------------
  // Profits drill-down (PROF-DD, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2)
  // ---------------------------------------------------------------------------

  /**
   * Per-sale drill-down feeding the Profits page's "Show transactions" list
   * under the SALE By Module row. Shares `sale_agg`'s body with
   * {@link getSalesRevCost} via {@link saleAggBody} (rule 14) so the two can
   * never drift: Σ(revenue_usd * weight) and Σ(cost_usd * weight) over every
   * row this returns reproduce `getSalesRevCost`'s own revenue_usd/cost_usd
   * exactly. Returns EVERY sale in range, including `weight = 0` ones —
   * `getSalesRevCost`'s own aggregate silently drops those; the service
   * (rule 13) needs them to render the "not counted yet" section and state
   * why. Schema-drift-guarded like `getSalesRevCost` (same fallback when a
   * jest fixture lacks discount_usd/total_amount_usd/refunded_quantity).
   *
   * PROF-DD-FIX (review round, 2026-09-24) — two defects closed here:
   *  (B1) The net-columns branch used to select `FROM sale_agg sa JOIN sales
   *  s` and then call {@link netSaleRevenueExpr}, whose formula references
   *  bare `discount_usd`/`total_amount_usd` — both `sale_agg` AND `sales`
   *  carry those column names, so SQLite failed every call with "ambiguous
   *  column name". Fixed by computing the net figure inside a SECOND CTE
   *  (`sale_net`, built from `sale_agg` ALONE — no ambiguity there, the same
   *  shape `getSalesRevCost`'s own `FROM sale_agg` uses) and only THEN
   *  joining `sales` for the columns that need it.
   *  (M1) `getSalesProfit` (the By Module total this drill-down must sum to
   *  EXACTLY) counts sales with `status IN ('completed', 'refunded')` —
   *  `SalesRepository.refundSaleItem` flips a sale to `'refunded'` once its
   *  LAST un-refunded line is refunded (see that method's own comment), and
   *  its residual SALE+REFUND profit (kept change, a stamp residual) still
   *  lands in the module total. `sale_agg`'s own `status = 'completed'`
   *  gate (needed for void-parity — see `saleAggBody`'s doc comment) then
   *  excludes that same sale from THIS method entirely, so "counted rows sum
   *  exactly to the module row" broke for any fully-item-refunded sale with
   *  a nonzero residual. Closed by merging in {@link getRefundedSalesDetail}
   *  — the SAME transactions-driven population `getSalesProfit`'s
   *  `status IN (...)` arm uses for `'refunded'`, with revenue/cost 0 (no
   *  sale_agg row exists for it) and the SAME weight/profit shape as every
   *  other row here.
   */
  getSalesDetail(fromDt: string, toDt: string): SaleDetailRow[] {
    const tenantId = getCurrentTenantId();
    const completedRows = this._hasSaleDiscountAndRefundQuantityColumns()
      ? this.getCompletedSalesDetailNet(fromDt, toDt)
      : this.getCompletedSalesDetailGross(fromDt, toDt);
    const refundedRows = this.getRefundedSalesDetail(fromDt, toDt, tenantId);
    return [...completedRows, ...refundedRows].sort((a, b) =>
      a.created_at === b.created_at
        ? b.sale_id - a.sale_id
        : a.created_at < b.created_at
          ? 1
          : -1,
    );
  }

  /** {@link getSalesDetail}'s schema-drift fallback branch (no discount/net
   *  columns on this fixture — degrades byte-for-byte like `getSalesRevCost`
   *  own fallback). */
  private getCompletedSalesDetailGross(
    fromDt: string,
    toDt: string,
  ): SaleDetailRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
            s.id AS sale_id,
            s.created_at AS created_at,
            c.full_name AS client_name,
            c.phone_number AS client_phone,
            NULL AS items_summary,
            COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd,
            (${saleRecognitionWeight("s")}) AS weight,
            CASE WHEN ${saleFullyPaid("s")} THEN 1 ELSE 0 END AS fully_paid,
            CASE WHEN ${saleHasPartnerObligation("s")} THEN 1 ELSE 0 END AS has_partner_obligation,
            (${partnerCoverageRatio("sales", "s.id")}) AS partner_coverage_ratio,
            -- Mirrors getSalesProfit's own per-sale SUM (SALE + any REFUND
            -- row for the same sale, both t.source_id = s.id) BEFORE the
            -- outer weight multiplication — a scalar subquery, not the
            -- 'SALE'-only LEFT JOIN this branch used before, so a
            -- partially-item-refunded but still-'completed' sale (a REFUND
            -- transaction row alongside its SALE row, same source_id) sums
            -- both here exactly as getSalesProfit's SUM(...) does, instead
            -- of missing the REFUND row's negative contribution.
            COALESCE((
              SELECT SUM(t.profit_usd) FROM transactions t
              WHERE t.source_table = 'sales' AND t.source_id = s.id
                AND t.type IN ('SALE', 'REFUND') AND t.status = 'ACTIVE' AND t.tenant_id = ?
            ), 0) AS profit_usd,
            COALESCE((
              SELECT SUM(t.profit_lbp) FROM transactions t
              WHERE t.source_table = 'sales' AND t.source_id = s.id
                AND t.type IN ('SALE', 'REFUND') AND t.status = 'ACTIVE' AND t.tenant_id = ?
            ), 0) AS profit_lbp,
            s.total_amount_usd AS total_amount_usd,
            s.paid_usd AS paid_usd,
            s.paid_lbp AS paid_lbp,
            s.final_amount_usd AS final_amount_usd,
            (${saleTotalPaidUsdEquiv("s")}) AS paid_total_usd
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = ?
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND ${dateRange("s.created_at")}
            AND si.tenant_id = ? AND s.tenant_id = ?
          GROUP BY s.id
          ORDER BY s.created_at DESC, s.id DESC`,
      )
      .all(
        tenantId,
        tenantId,
        tenantId,
        fromDt,
        toDt,
        tenantId,
        tenantId,
      ) as SaleDetailRow[];
  }

  /** {@link getSalesDetail}'s primary branch (discount/net columns present —
   *  every real DB). See {@link getSalesDetail}'s own doc comment for the B1
   *  ambiguous-column fix `sale_net` closes. */
  private getCompletedSalesDetailNet(
    fromDt: string,
    toDt: string,
  ): SaleDetailRow[] {
    const tenantId = getCurrentTenantId();
    const saleAggExtraWhere =
      dateRange("s.created_at") + " AND si.tenant_id = ? AND s.tenant_id = ?";
    return this.db
      .prepare(
        `WITH sale_agg AS (
          ${saleAggBody(
            "s",
            "si",
            "s.id AS sale_id, s.created_at AS created_at,",
            saleAggExtraWhere,
          )}
        ), sale_net AS (
          SELECT sale_agg.*, (${netSaleRevenueExpr()}) AS net_revenue_usd
          FROM sale_agg
        )
        SELECT
          sn.sale_id AS sale_id,
          sn.created_at AS created_at,
          c.full_name AS client_name,
          c.phone_number AS client_phone,
          (
            SELECT GROUP_CONCAT(p.name || ' x' || (si2.quantity - si2.refunded_quantity), ', ')
            FROM sale_items si2
            JOIN products p ON p.id = si2.product_id
            WHERE si2.sale_id = sn.sale_id
              AND si2.quantity - si2.refunded_quantity > 0
          ) AS items_summary,
          sn.net_revenue_usd AS revenue_usd,
          sn.remaining_cost AS cost_usd,
          sn.weight AS weight,
          CASE WHEN ${saleFullyPaid("s")} THEN 1 ELSE 0 END AS fully_paid,
          CASE WHEN ${saleHasPartnerObligation("s")} THEN 1 ELSE 0 END AS has_partner_obligation,
          (${partnerCoverageRatio("sales", "s.id")}) AS partner_coverage_ratio,
          -- Same scalar-subquery shape as the fallback branch above (see its
          -- own comment) — mirrors getSalesProfit's per-sale SUM exactly.
          COALESCE((
            SELECT SUM(t.profit_usd) FROM transactions t
            WHERE t.source_table = 'sales' AND t.source_id = s.id
              AND t.type IN ('SALE', 'REFUND') AND t.status = 'ACTIVE' AND t.tenant_id = ?
          ), 0) AS profit_usd,
          COALESCE((
            SELECT SUM(t.profit_lbp) FROM transactions t
            WHERE t.source_table = 'sales' AND t.source_id = s.id
              AND t.type IN ('SALE', 'REFUND') AND t.status = 'ACTIVE' AND t.tenant_id = ?
          ), 0) AS profit_lbp,
          s.total_amount_usd AS total_amount_usd,
          s.paid_usd AS paid_usd,
          s.paid_lbp AS paid_lbp,
          s.final_amount_usd AS final_amount_usd,
          (${saleTotalPaidUsdEquiv("s")}) AS paid_total_usd
        FROM sale_net sn
        JOIN sales s ON s.id = sn.sale_id
        LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = ?
        ORDER BY sn.created_at DESC, sn.sale_id DESC`,
      )
      .all(
        fromDt,
        toDt,
        tenantId,
        tenantId,
        tenantId,
        tenantId,
        tenantId,
      ) as SaleDetailRow[];
  }

  /**
   * {@link getSalesDetail}'s M1 fix — every sale `getSalesProfit` counts via
   * its `status = 'refunded'` arm (see `getSalesDetail`'s own doc comment)
   * that the completed-only branches above cannot see. Revenue/cost are
   * always 0 (no sale_items line still counts once every line is refunded);
   * weight/profit are the SAME shapes {@link getCompletedSalesDetailNet}
   * uses, so a for-partner or not-yet-fully-paid refunded sale still gets a
   * correct `reason` from the service instead of silently reading as
   * "counted" or "excluded" for the wrong reason. Restricted to sales with
   * at least one ACTIVE SALE/REFUND row (an EXISTS gate) so a `'refunded'`
   * sale with a genuinely zero net contribution doesn't clutter the
   * drill-down with an all-zero row nobody asked to see.
   */
  private getRefundedSalesDetail(
    fromDt: string,
    toDt: string,
    tenantId: number,
  ): SaleDetailRow[] {
    return this.db
      .prepare(
        `SELECT
          s.id AS sale_id,
          s.created_at AS created_at,
          c.full_name AS client_name,
          c.phone_number AS client_phone,
          NULL AS items_summary,
          0 AS revenue_usd,
          0 AS cost_usd,
          (${saleRecognitionWeight("s")}) AS weight,
          CASE WHEN ${saleFullyPaid("s")} THEN 1 ELSE 0 END AS fully_paid,
          CASE WHEN ${saleHasPartnerObligation("s")} THEN 1 ELSE 0 END AS has_partner_obligation,
          (${partnerCoverageRatio("sales", "s.id")}) AS partner_coverage_ratio,
          COALESCE((
            SELECT SUM(t.profit_usd) FROM transactions t
            WHERE t.source_table = 'sales' AND t.source_id = s.id
              AND t.type IN ('SALE', 'REFUND') AND t.status = 'ACTIVE' AND t.tenant_id = ?
          ), 0) AS profit_usd,
          COALESCE((
            SELECT SUM(t.profit_lbp) FROM transactions t
            WHERE t.source_table = 'sales' AND t.source_id = s.id
              AND t.type IN ('SALE', 'REFUND') AND t.status = 'ACTIVE' AND t.tenant_id = ?
          ), 0) AS profit_lbp,
          s.total_amount_usd AS total_amount_usd,
          s.paid_usd AS paid_usd,
          s.paid_lbp AS paid_lbp,
          s.final_amount_usd AS final_amount_usd,
          (${saleTotalPaidUsdEquiv("s")}) AS paid_total_usd
        FROM sales s
        LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = ?
        WHERE s.status = 'refunded'
          AND ${dateRange("s.created_at")}
          AND s.tenant_id = ?
          AND EXISTS (
            SELECT 1 FROM transactions t2
            WHERE t2.source_table = 'sales' AND t2.source_id = s.id
              AND t2.type IN ('SALE', 'REFUND') AND t2.status = 'ACTIVE'
              AND t2.tenant_id = ?
          )
        ORDER BY s.created_at DESC, s.id DESC`,
      )
      .all(
        tenantId,
        tenantId,
        tenantId,
        fromDt,
        toDt,
        tenantId,
        tenantId,
      ) as SaleDetailRow[];
  }

  /**
   * Per-recharge drill-down feeding the Profits page's "Show transactions"
   * list under a RECHARGE_<carrier> By Module row. Returns EVERY recharge
   * for this carrier in range (rule 14 shares notRefunded/dateRange/
   * partnerCoverageRatio with {@link getRechargesByCarrier}), including
   * debt-pending ones `getRechargesByCarrier`'s own WHERE hard-excludes —
   * the service (rule 13) needs those to render the "not counted yet"
   * section and state why. Auto-booked fee expenses
   * (SMS/Line_Usage, `expenses.source_ref_table = 'recharges'`) are attached
   * per row via a correlated subquery, never subtracted from profit here
   * (owner decision — the service/UI show them as a separate note). The fee
   * subqueries gate via {@link activeExpense} (rule 14, PROF-DD-FIX m1) —
   * NOT a hand-pasted `status = 'active'` — so a fee expense reversed via
   * the generic Transactions-viewer void path (which flips
   * `expenses.is_refunded`, not `status`) correctly stops showing here too.
   */
  getRechargeDetail(
    carrier: string,
    fromDt: string,
    toDt: string,
  ): RechargeDetailRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
          r.id AS recharge_id,
          r.created_at AS created_at,
          r.phone_number AS phone_number,
          r.client_name AS client_name,
          r.currency_code AS currency_code,
          r.amount AS amount,
          r.price AS price,
          r.cost AS cost,
          COALESCE(t.profit_usd, 0) AS profit_usd,
          COALESCE(t.profit_lbp, 0) AS profit_lbp,
          CASE WHEN ${hasPartnerObligation("recharges", "r.id")} THEN 1 ELSE 0 END AS has_partner_obligation,
          (${partnerCoverageRatio("recharges", "r.id")}) AS partner_coverage_ratio,
          CASE WHEN ${notDebtPending("t.id")} THEN 0 ELSE 1 END AS debt_pending,
          COALESCE((
            SELECT SUM(e.amount_usd) FROM expenses e
            WHERE e.source_ref_table = 'recharges' AND e.source_ref_id = r.id
              AND ${activeExpense("e")} AND e.tenant_id = ?
          ), 0) AS fee_expense_usd,
          COALESCE((
            SELECT SUM(e.amount_lbp) FROM expenses e
            WHERE e.source_ref_table = 'recharges' AND e.source_ref_id = r.id
              AND ${activeExpense("e")} AND e.tenant_id = ?
          ), 0) AS fee_expense_lbp,
          (
            SELECT GROUP_CONCAT(e.description, ', ') FROM expenses e
            WHERE e.source_ref_table = 'recharges' AND e.source_ref_id = r.id
              AND ${activeExpense("e")} AND e.tenant_id = ?
          ) AS fee_expense_description
        FROM recharges r
        JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
        WHERE r.carrier = ?
          AND t.status = 'ACTIVE'
          AND ${notRefunded("r")}
          AND ${dateRange("r.created_at")}
          AND r.tenant_id = ? AND t.tenant_id = ?
        ORDER BY r.created_at DESC, r.id DESC`,
      )
      .all(
        tenantId,
        tenantId,
        tenantId,
        carrier,
        fromDt,
        toDt,
        tenantId,
        tenantId,
      ) as RechargeDetailRow[];
  }

  // ---------------------------------------------------------------------------
  // By date (getByDate)
  // ---------------------------------------------------------------------------

  /**
   * Daily profit breakdown for a date range (for charts). Returns one row per
   * calendar day in [from, to], with every category LEFT-JOINed by day.
   */
  getByDate(
    from: string,
    to: string,
    fromDt: string,
    toDt: string,
  ): ProfitByDateRow[] {
    const tenantId = getCurrentTenantId();
    const hasAllocations = this._hasSettlementAllocationsTable();
    // REV lane (2026-09-24, owner decision (a), OWNER_NOTES_2026-09-21.md
    // §6.9) — the SAME schema-drift gate getSalesRevCost uses, now shared by
    // daily_sales below so both queries degrade together on a fixture
    // missing discount_usd/total_amount_usd/refunded_quantity.
    const hasSaleNetCols = this._hasSaleDiscountAndRefundQuantityColumns();
    /**
     * REV lane (2026-09-24) — PA-4.23(a) parity: daily_sales now nets
     * discount + refunded quantity over a per-sale, per-day aggregate, its
     * inner body shared with getSalesRevCost's `sale_agg` CTE and
     * saleRevenueUsdCaseBranch's net-columns subquery via {@link saleAggBody}
     * (rule 14 — REV-V1, closing the gap that used to make
     * saleRevenueUsdCaseBranch the odd one out). Structured as a derived
     * subquery (`daily_sale_agg`, grouped by `s.id`) feeding an outer
     * `GROUP BY d`, the SAME two-level shape `daily_commissions`'s own
     * `daily_commissions_combined` subquery already uses in this method —
     * NOT a second top-level CTE, so the `daily_sales AS (` boundary this
     * file's static SQL-unit guard (sqlQueryUnits.ts) requires stays literal
     * in the outer template below; only this body varies. Degrades to the
     * byte-for-byte pre-fix gross query (unchanged param count: dateRange's
     * 2 + si.tenant_id/s.tenant_id) when `hasSaleNetCols` is false — same
     * fixture-compatibility contract as getSalesRevCost.
     */
    const dailySalesBody = hasSaleNetCols
      ? `SELECT
            d,
            COALESCE(SUM(${netSaleRevenueExpr()} * weight), 0) AS revenue_usd,
            COALESCE(SUM(remaining_cost * weight), 0) AS cost_usd
          FROM (
            ${saleAggBody(
              "s",
              "si",
              "DATE(s.created_at, 'localtime') AS d,",
              `${dateRange("s.created_at")} AND si.tenant_id = ? AND s.tenant_id = ?`,
            )}
          ) daily_sale_agg
          GROUP BY d`
      : `SELECT
            DATE(s.created_at, 'localtime') AS d,
            COALESCE(SUM(si.sold_price_usd * si.quantity * (${saleRecognitionWeight("s")})), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity * (${saleRecognitionWeight("s")})), 0) AS cost_usd
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND ${dateRange("s.created_at")}
            AND si.tenant_id = ? AND s.tenant_id = ?
          GROUP BY DATE(s.created_at, 'localtime')`;
    // Rule 14 — same fix as getExchangeTotals (owner ticket #27, 2026-09-23):
    // the daily_exchange CTE below used to sum raw amount_in, wrongly
    // treating an LBP-denominated leg as dollars.
    const dailyExchangeUsdRevenue = exchangeUsdRevenue(
      "exchange_transactions",
      this._hasExchangeCurrencyColumns(),
    );

    /**
     * LIRA-158 Phase 3 — restores per-DATE attribution for
     * `commission_model = 1` rows, mirroring {@link getFinancialSettledByProvider}'s
     * allocation arm (see that method's doc comment for the full rationale:
     * why the base `daily_commissions` arm below is left unchanged, why this
     * is dated by `sca.created_at` (D7 settlement day, not the fs row's
     * transaction day), why `notRefunded` is a gate, and why voiding needs
     * no extra predicate). Built as a separate string
     * (rather than nested inline) so the outer `daily_commissions AS (...)`
     * CTE body keeps a single, unbroken pair of backticks — a nested
     * template literal here would introduce a second, unbalanced backtick
     * inside this method's `.prepare(\`...\`)` call.
     *
     * D17 (LIRA-158 follow-up, owner decision 2026-08-31) — this arm now
     * ALSO carries {@link allocationNotDebtPending} and
     * {@link cashlessCommissionBatch}, the SAME two gates added to
     * {@link getFinancialSettledByProvider}'s allocation arm and for the
     * SAME reason: a CASHLESS settlement's commission is contingent on the
     * client repaying the underlying transfer (see that method's doc
     * comment for the full D17 rationale); a BILLS-ONLY settlement's real
     * money is recognised elsewhere (`getSupplierCommissionTotals`'s own
     * bills-only bucket) and must not double-count here.
     *
     * Proportional recognition (owner decision 2026-09-05) — same change as
     * {@link getFinancialSettledByProvider}'s allocation arm: the partner
     * axis is no longer `notPartnerPending`'s binary gate, it is
     * {@link partnerCoverageRatio} weighting `profit_usd`/`profit_lbp`
     * (and, in the base arm below and every other per-day CTE in this
     * method, `revenue`/`cost`/`profit` likewise). `getByDate` exposes no
     * per-day count column at all, so there is nothing to convert to a
     * `ratio > 0` tally here.
     *
     * PA-0.1 (OWNER_NOTES_2026-09-21.md §6.2) — the base `daily_commissions`
     * arm's WHERE (below) is gated by {@link fsProviderRowRecognized} (which
     * itself calls {@link fsStampRecognized} for commission providers — see
     * LO-V2's own doc comment on that fragment), not a bare
     * `fs.is_settled = 1`: a model-1 row's stamp is attributed to its
     * transaction day from creation, not from settlement (this allocation
     * arm, dated by `sca.created_at`, is unaffected — it books the
     * separate settlement commission, already correctly dated).
     */
    const dailyCommissionsAllocationArm = hasAllocations
      ? `
          UNION ALL
          SELECT
            DATE(sca.created_at, 'localtime') AS d,
            COALESCE(SUM(sca.commission_usd * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_usd,
            COALESCE(SUM(sca.commission_lbp * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_lbp,
            0 AS revenue_usd,
            0 AS revenue_lbp
          FROM settlement_commission_allocations sca
          JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
          WHERE sca.tenant_id = ?
            AND ${notRefunded("fs")}
            AND ${allocationNotDebtPending("sca")}
            AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
            AND ${dateRange("sca.created_at")}
          GROUP BY DATE(sca.created_at, 'localtime')`
      : "";

    const params: (string | number)[] = [];
    params.push(from, to); // dates CTE
    params.push(fromDt, toDt, tenantId, tenantId); // daily_sales (si, s)
    params.push(fromDt, toDt, tenantId, tenantId); // daily_sales_profit (t, s)
    params.push(fromDt, toDt, tenantId, tenantId); // daily_commissions arm 1 (fs, t)
    if (hasAllocations) {
      params.push(tenantId, fromDt, toDt); // daily_commissions arm 2 (sca, fs) — LIRA-158 Phase 3
    }
    params.push(fromDt, toDt, tenantId, tenantId); // daily_recharges (r, t)
    params.push(fromDt, toDt, tenantId, tenantId); // daily_custom (cs, t)
    params.push(fromDt, toDt, tenantId, tenantId); // daily_maint (m, t)
    params.push(fromDt, toDt, tenantId, tenantId); // daily_loto (lt, t)
    params.push(fromDt, toDt, tenantId); // daily_expenses
    params.push(fromDt, toDt, tenantId); // daily_exchange
    params.push(fromDt, toDt, tenantId); // daily_pmfee (fs)
    // PA-2.2 (OWNER_NOTES_2026-09-21.md §6.4) — the same three extra sources
    // PA-2.1 added to getByModule, plus PA-2.3's top-up/buyback query.
    params.push(fromDt, toDt, tenantId); // daily_kept_change
    params.push(fromDt, toDt, tenantId); // daily_discounts
    params.push(fromDt, toDt, tenantId); // daily_bills_commission
    params.push(fromDt, toDt, tenantId, tenantId); // daily_topup_buyback (r, t)

    return this.db
      .prepare(
        `WITH dates AS (
          SELECT DATE(?) AS d
          UNION ALL
          SELECT DATE(d, '+1 day') FROM dates WHERE d < DATE(?)
        ),
        daily_sales AS (
          -- Revenue + cost grouped by the SALE date. Owner decision
          -- 2026-09-05 (Task 3): weighted by saleRecognitionWeight instead of
          -- gated by the old binary salePaidOrPartnerSettled (see
          -- getSalesRevCost's own doc comment for the full rationale). REV
          -- lane (2026-09-24, PA-4.23 a parity): also net of discount and
          -- refunded quantity now, via the SAME netSaleRevenueExpr() formula
          -- getSalesRevCost uses (rule 14) — see dailySalesBody's own doc
          -- comment above this method's prepare() call for the two-level
          -- shape and the schema-drift degrade. No phantom-row risk: this
          -- method's outer query always emits one row per calendar day
          -- regardless (see havingAnyContribution's own doc comment).
          ${dailySalesBody}
        ),
        daily_sales_profit AS (
          -- Profit from the unified ledger (SALE + REFUND), grouped by the SALE
          -- date (s.created_at — a REFUND row's source_id points at the original
          -- sale) so a refund nets the sale at its ORIGINAL date, matching
          -- daily_sales revenue/cost and getSalesProfit (no cross-window divergence).
          -- Weighted by saleRecognitionWeight (Task 3) — same rationale as
          -- daily_sales above.
          SELECT
            DATE(s.created_at, 'localtime') AS d,
            COALESCE(SUM(t.profit_usd * (${saleRecognitionWeight("s")})), 0) AS profit_usd,
            -- PA-3.1: kept change stamped in LBP (transactions.profit_lbp =
            -- kept_change_lbp, SalesRepository.ts) used to be dropped here.
            COALESCE(SUM(t.profit_lbp * (${saleRecognitionWeight("s")})), 0) AS profit_lbp
          FROM transactions t
          JOIN sales s ON s.id = t.source_id
          WHERE t.status = 'ACTIVE'
            AND t.source_table = 'sales'
            AND t.type IN ('SALE', 'REFUND')
            AND s.status IN ('completed', 'refunded')
            AND ${dateRange("s.created_at")}
            AND t.tenant_id = ? AND s.tenant_id = ?
          GROUP BY DATE(s.created_at, 'localtime')
        ),
        daily_commissions AS (
          SELECT
            d,
            COALESCE(SUM(profit_usd), 0) AS profit_usd,
            COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
            COALESCE(SUM(revenue_usd), 0) AS revenue_usd,
            COALESCE(SUM(revenue_lbp), 0) AS revenue_lbp
          FROM (
            SELECT
              DATE(fs.created_at, 'localtime') AS d,
              -- PA-1.4: EXACT currency match — see getFinancialSettledByProvider's
              -- own comment for the full rationale (a third currency used to
              -- be lumped into the USD bucket via '!= LBP'). Applies to
              -- revenue_usd/revenue_lbp only (fs.amount/fs.price are
              -- single-currency-denominated).
              -- LO-V1/PA-3.1: profit_usd/profit_lbp sum BOTH the own-currency
              -- margin AND the off-currency kept change for a row in the
              -- KNOWN currency set — t.profit_usd/t.profit_lbp are a
              -- dual-currency stamp on ONE row (own margin in the row's
              -- native currency, kept change in the OTHER — see
              -- otherCurrencyKeptChangeUsd/Lbp's own doc comment). The old
              -- fs.currency-gated (own-only) CASE dropped the off-currency
              -- component entirely (probe: a USD OMT row's LBP kept change
              -- never reached this CTE's profit_lbp).
              -- LO-R4-residual (round 4, rule 14): expressed through the SAME
              -- shared otherCurrencyKeptChangeUsd/Lbp fragments daily_recharges
              -- (below) already uses, instead of a THIRD hand-rolled encoding
              -- of the identical own+other-currency fold via
              -- fs.currency IN ('USD', 'LBP') — own currency's exact-match
              -- term + the other-currency fragment sum to the SAME total for
              -- every case (own, kept-change, and a dropped third currency
              -- like EUR, which matches neither term and is correctly
              -- excluded, preserving PA-1.4's "dropped, not given a bucket"
              -- policy), just spelled with the one shared building block.
              COALESCE(SUM(((CASE WHEN fs.currency = 'USD' THEN t.profit_usd ELSE 0 END) + (${otherCurrencyKeptChangeUsd("fs.currency")})) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS profit_usd,
              COALESCE(SUM(((CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE 0 END) + (${otherCurrencyKeptChangeLbp("fs.currency")})) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS profit_lbp,
              COALESCE(SUM(CASE WHEN fs.currency = 'USD' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_usd,
              COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_lbp
            FROM financial_services fs
            JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
            -- LO-V2/PA-2.8: see fsProviderRowRecognized's own doc comment —
            -- mobile providers recognise unconditionally, commission
            -- providers need fsStampRecognized, anything outside BOTH known
            -- lists is excluded (matches the Overview).
            WHERE ${fsProviderRowRecognized("fs", this._hasCommissionModelColumn())}
              AND t.status = 'ACTIVE'
              AND ${notRefunded("fs")}
            AND ${notDebtPending("t.id")}
              AND ${dateRange("fs.created_at")}
              AND fs.tenant_id = ? AND t.tenant_id = ?
            GROUP BY DATE(fs.created_at, 'localtime')
            ${dailyCommissionsAllocationArm}
          ) daily_commissions_combined
          GROUP BY d
        ),
        daily_recharges AS (
          SELECT
            DATE(r.created_at, 'localtime') AS d,
            -- LO-V10 (round 2, rule 14 consistency): EXACT 'USD' match, not
            -- '!= LBP' — see getRechargesByCarrier's identical fix.
            COALESCE(SUM(CASE WHEN r.currency_code = 'USD' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code = 'USD' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_lbp,
            -- LO-V1/PA-3.1: sums BOTH own margin and off-currency kept
            -- change for a row in the KNOWN currency set — a USD recharge's
            -- LBP kept change (or vice versa) used to be dropped by the old
            -- currency-gated (own-only) CASE.
            -- LO-R4 (round 3, rule 14): expressed through the SAME shared
            -- otherCurrencyKeptChangeUsd/Lbp fragments getRechargesByCurrency
            -- now uses (its own identical fix above), instead of the
            -- IN ('USD', 'LBP') fold this CTE hand-rolled separately — own
            -- currency's exact-match term + the other-currency fragment sum
            -- to the SAME total for every case (own, kept-change, and a
            -- dropped third currency), just spelled with the one shared
            -- building block instead of a third encoding of the same rule.
            COALESCE(SUM(((CASE WHEN r.currency_code = 'USD' THEN t.profit_usd ELSE 0 END) + (${otherCurrencyKeptChangeUsd("r.currency_code")})) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit_usd,
            COALESCE(SUM(((CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE 0 END) + (${otherCurrencyKeptChangeLbp("r.currency_code")})) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit_lbp
          FROM recharges r
          JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
          WHERE t.status = 'ACTIVE'
            AND ${notRefunded("r")}
          AND ${notDebtPending("t.id")}
            AND ${dateRange("r.created_at")}
            AND r.tenant_id = ? AND t.tenant_id = ?
          GROUP BY DATE(r.created_at, 'localtime')
        ),
        daily_custom AS (
          SELECT
            DATE(cs.created_at, 'localtime') AS d,
            COALESCE(SUM(cs.price_usd * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS revenue_usd,
            COALESCE(SUM(cs.price_lbp * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS revenue_lbp,
            COALESCE(SUM(cs.cost_usd * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS cost_usd,
            COALESCE(SUM(cs.cost_lbp * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS cost_lbp,
            COALESCE(SUM(t.profit_usd * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("custom_services", "cs.id")})), 0) AS profit_lbp
          FROM custom_services cs
          JOIN transactions t ON t.source_table = 'custom_services' AND t.source_id = cs.id AND t.type = 'CUSTOM_SERVICE'
          WHERE cs.status = 'completed'
            AND t.status = 'ACTIVE'
            AND ${notRefunded("cs")}
          AND ${notDebtPending("t.id")}
            AND ${dateRange("cs.created_at")}
            AND cs.tenant_id = ? AND t.tenant_id = ?
          GROUP BY DATE(cs.created_at, 'localtime')
        ),
        daily_maint AS (
          SELECT
            DATE(m.created_at, 'localtime') AS d,
            COALESCE(SUM(m.final_amount_usd), 0) AS revenue_usd,
            COALESCE(SUM(m.final_amount_lbp), 0) AS revenue_lbp,
            COALESCE(SUM(${maintenanceCostUsd("m")}), 0) AS cost_usd,
            COALESCE(SUM(m.cost_lbp), 0) AS cost_lbp,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
          FROM maintenance m
          JOIN transactions t ON t.source_table = 'maintenance' AND t.source_id = m.id AND t.type = 'MAINTENANCE'
          WHERE ${maintenanceCompleted("m")}
            AND t.status = 'ACTIVE'
            AND ${notRefunded("m")}
          AND ${notDebtPending("t.id")}
            AND ${dateRange("m.created_at")}
            AND m.tenant_id = ? AND t.tenant_id = ?
          GROUP BY DATE(m.created_at, 'localtime')
        ),
        daily_loto AS (
          SELECT
            DATE(lt.created_at, 'localtime') AS d,
            COALESCE(SUM(lt.sale_amount * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS revenue_lbp,
            COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS profit_lbp,
            -- LO-V1/PA-3.1: a loto ticket is always LBP-native, so ANY
            -- t.profit_usd on its row is USD-side kept change by
            -- construction (see getLotoTotals' identical kept_change_usd).
            COALESCE(SUM(t.profit_usd * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS profit_usd
          FROM loto_tickets lt
          JOIN transactions t ON t.source_table = 'loto_tickets' AND t.source_id = lt.id AND t.type = 'LOTO'
          WHERE t.status = 'ACTIVE'
            AND ${notRefunded("lt")}
          AND ${notDebtPending("t.id")}
            AND ${dateRange("lt.created_at")}
            AND lt.tenant_id = ? AND t.tenant_id = ?
          GROUP BY DATE(lt.created_at, 'localtime')
        ),
        daily_expenses AS (
          SELECT
            DATE(expense_date, 'localtime') AS d,
            COALESCE(SUM(amount_usd), 0) AS expenses_usd,
            COALESCE(SUM(amount_lbp), 0) AS expenses_lbp
          FROM expenses
          WHERE ${activeExpense()}
            AND ${dateRange("expense_date")}
            AND tenant_id = ?
          GROUP BY DATE(expense_date, 'localtime')
        ),
        daily_exchange AS (
          SELECT
            DATE(created_at, 'localtime') AS d,
            COALESCE(SUM((${dailyExchangeUsdRevenue}) * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS revenue_usd,
            COALESCE(SUM((${EXCHANGE_LEG_PROFIT}) * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS profit_usd
          FROM exchange_transactions
          WHERE ${notRefunded("exchange_transactions")}
            AND ${dateRange("created_at")}
            AND tenant_id = ?
          GROUP BY DATE(created_at, 'localtime')
        ),
        daily_pmfee AS (
          -- Payment-method fees from financial_services (notRefunded, dated by
          -- fs.created_at) — same retroactive-removal semantics as commissions,
          -- so a cross-period void/refund never overstates the original period.
          -- LO-V10 (round 2, rule 14 consistency): EXACT 'USD' match, not
          -- '!= LBP' — a third-currency fee (e.g. a Binance USDT row) used
          -- to be lumped into profit_usd; it now contributes to neither,
          -- matching PA-1.4's own "dropped, not given a bucket" policy.
          SELECT
            DATE(fs.created_at, 'localtime') AS d,
            COALESCE(SUM(CASE WHEN fs.currency = 'USD' THEN fs.payment_method_fee ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN fs.payment_method_fee ELSE 0 END), 0) AS profit_lbp
          FROM financial_services fs
          WHERE COALESCE(fs.payment_method_fee, 0) <> 0
            AND ${notRefunded("fs")}
            AND ${dateRange("fs.created_at")}
            AND fs.tenant_id = ?
          GROUP BY DATE(fs.created_at, 'localtime')
        ),
        -- PA-2.2 (OWNER_NOTES_2026-09-21.md §6.4) — the same three sources
        -- PA-2.1 added to getByModule (see that block's own comments there
        -- for the full rationale; not repeated per-CTE here, rule 14), plus
        -- PA-2.3's top-up/buyback query.
        daily_kept_change AS (
          -- LO-V5 (round 2, rule 14): now calls the SAME keptChangeSource
          -- fragment getDebtRepaymentProfit uses, instead of a pasted copy
          -- of its predicate (T3 KC-2).
          SELECT
            DATE(t.created_at, 'localtime') AS d,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
          FROM transactions t
          WHERE t.status = 'ACTIVE'
            AND ${keptChangeSource("t")}
            AND ${dateRange("t.created_at")}
            AND t.tenant_id = ?
          GROUP BY DATE(t.created_at, 'localtime')
        ),
        daily_discounts AS (
          -- LO-V5: now calls counterpartyDiscountSource, the SAME fragment
          -- getCounterpartyDiscountTotals uses (CQ-10/D1).
          SELECT
            DATE(t.created_at, 'localtime') AS d,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
          FROM transactions t
          WHERE t.status = 'ACTIVE'
            AND ${counterpartyDiscountSource("t")}
            AND ${dateRange("t.created_at")}
            AND t.tenant_id = ?
          GROUP BY DATE(t.created_at, 'localtime')
        ),
        daily_bills_commission AS (
          -- LO-V5: now calls supplierSettlementSource, the SAME fragment
          -- getSupplierCommissionTotals's bills-only/degraded branches use.
          -- (degraded schema: the whole stamp, which on that schema is
          -- always bills-only by construction — see that method's own doc
          -- comment). The CASHLESS half is already counted by
          -- dailyCommissionsAllocationArm above (dated by sca.created_at) —
          -- this CTE excludes it via NOT cashlessCommissionBatch to avoid
          -- double-counting, same as getByModule's own split.
          SELECT
            DATE(t.created_at, 'localtime') AS d,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
          FROM transactions t
          WHERE t.status = 'ACTIVE'
            AND ${supplierSettlementSource("t")}
            ${hasAllocations ? `AND NOT (${cashlessCommissionBatch("t.source_id")})` : ""}
            AND ${dateRange("t.created_at")}
            AND t.tenant_id = ?
          GROUP BY DATE(t.created_at, 'localtime')
        ),
        daily_topup_buyback AS (
          -- LO-V5: now calls topupBuybackSource, the SAME fragment
          -- getTopupBuybackProfit uses (PA-2.3).
          SELECT
            DATE(r.created_at, 'localtime') AS d,
            COALESCE(SUM(t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit_lbp
          FROM recharges r
          JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id
            AND ${topupBuybackSource("t")}
          WHERE t.status = 'ACTIVE'
            AND ${notRefunded("r")}
            AND ${notDebtPending("t.id")}
            AND ${dateRange("r.created_at")}
            AND r.tenant_id = ? AND t.tenant_id = ?
          GROUP BY DATE(r.created_at, 'localtime')
        )
        SELECT
          dates.d AS date,
          COALESCE(ds.revenue_usd, 0) + COALESCE(dc.revenue_usd, 0) + COALESCE(dr.revenue_usd, 0) + COALESCE(dcm.revenue_usd, 0) + COALESCE(dm.revenue_usd, 0) + COALESCE(dex.revenue_usd, 0) AS revenue_usd,
          COALESCE(dc.revenue_lbp, 0) + COALESCE(dr.revenue_lbp, 0) + COALESCE(dcm.revenue_lbp, 0) + COALESCE(dm.revenue_lbp, 0) + COALESCE(dl.revenue_lbp, 0) AS revenue_lbp,
          COALESCE(ds.cost_usd, 0) + COALESCE(dr.cost_usd, 0) + COALESCE(dcm.cost_usd, 0) + COALESCE(dm.cost_usd, 0) + COALESCE(dex.revenue_usd, 0) - COALESCE(dex.profit_usd, 0) AS cost_usd,
          COALESCE(dr.cost_lbp, 0) + COALESCE(dcm.cost_lbp, 0) + COALESCE(dm.cost_lbp, 0) AS cost_lbp,
          COALESCE(dsp.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) + COALESCE(dex.profit_usd, 0) + COALESCE(dpf.profit_usd, 0) + COALESCE(dkc.profit_usd, 0) + COALESCE(ddisc.profit_usd, 0) + COALESCE(dbc.profit_usd, 0) + COALESCE(dtb.profit_usd, 0) + COALESCE(dl.profit_usd, 0) AS profit_usd,
          -- PA-3.1: dsp.profit_lbp (a sale's LBP kept change) was missing
          -- from this column entirely. PA-2.2: dkc/ddisc/dbc/dtb are the
          -- four new sources above. LO-V1 (round 2): dl.profit_usd is loto's
          -- USD-side kept change (dc/dr already fold their own off-currency
          -- kept change unconditionally now — see each CTE's own comment).
          COALESCE(dsp.profit_lbp, 0) + COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) + COALESCE(dm.profit_lbp, 0) + COALESCE(dl.profit_lbp, 0) + COALESCE(dpf.profit_lbp, 0) + COALESCE(dkc.profit_lbp, 0) + COALESCE(ddisc.profit_lbp, 0) + COALESCE(dbc.profit_lbp, 0) + COALESCE(dtb.profit_lbp, 0) AS profit_lbp,
          COALESCE(de.expenses_usd, 0) AS expenses_usd,
          COALESCE(de.expenses_lbp, 0) AS expenses_lbp,
          COALESCE(dsp.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) + COALESCE(dex.profit_usd, 0) + COALESCE(dpf.profit_usd, 0) + COALESCE(dkc.profit_usd, 0) + COALESCE(ddisc.profit_usd, 0) + COALESCE(dbc.profit_usd, 0) + COALESCE(dtb.profit_usd, 0) + COALESCE(dl.profit_usd, 0) - COALESCE(de.expenses_usd, 0) AS net_profit_usd,
          COALESCE(dsp.profit_lbp, 0) + COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) + COALESCE(dm.profit_lbp, 0) + COALESCE(dl.profit_lbp, 0) + COALESCE(dpf.profit_lbp, 0) + COALESCE(dkc.profit_lbp, 0) + COALESCE(ddisc.profit_lbp, 0) + COALESCE(dbc.profit_lbp, 0) + COALESCE(dtb.profit_lbp, 0) - COALESCE(de.expenses_lbp, 0) AS net_profit_lbp
        FROM dates
        LEFT JOIN daily_sales ds ON ds.d = dates.d
        LEFT JOIN daily_sales_profit dsp ON dsp.d = dates.d
        LEFT JOIN daily_commissions dc ON dc.d = dates.d
        LEFT JOIN daily_recharges dr ON dr.d = dates.d
        LEFT JOIN daily_custom dcm ON dcm.d = dates.d
        LEFT JOIN daily_maint dm ON dm.d = dates.d
        LEFT JOIN daily_loto dl ON dl.d = dates.d
        LEFT JOIN daily_expenses de ON de.d = dates.d
        LEFT JOIN daily_exchange dex ON dex.d = dates.d
        LEFT JOIN daily_pmfee dpf ON dpf.d = dates.d
        LEFT JOIN daily_kept_change dkc ON dkc.d = dates.d
        LEFT JOIN daily_discounts ddisc ON ddisc.d = dates.d
        LEFT JOIN daily_bills_commission dbc ON dbc.d = dates.d
        LEFT JOIN daily_topup_buyback dtb ON dtb.d = dates.d
        ORDER BY dates.d DESC`,
      )
      .all(...params) as ProfitByDateRow[];
  }

  // ---------------------------------------------------------------------------
  // By payment method (getByPaymentMethod)
  // ---------------------------------------------------------------------------

  /**
   * Real customer-facing payment methods (excludes internal/system flows).
   *
   * PA-1.4 (currency bucketing): `total_usd`/`total_lbp` key on an EXACT
   * `= 'USD'` / `= 'LBP'` match, never `!= 'LBP'` — the old `!= 'LBP'` form
   * lumped any other currency (EUR, USDT, ...) straight into the USD column.
   * A non-USD/non-LBP leg is dropped from both totals rather than given its
   * own column (same choice `TransactionRepository`'s
   * `CUSTOMER_CASH_CURRENCIES` already makes for the LIRA-064 cash-flow
   * report — see `isInternalLegJs`) — this is a per-payment-method TENDER
   * breakdown, and the shop's two tender currencies are USD/LBP.
   *
   * PA-3.5 (void/refund excluded): a payment leg only counts as cash intake
   * while its transaction is still the live record of a real sale/flow —
   * voided legs, refunded legs, and their own reversal rows must not read as
   * new takings. `t.id IS NULL` (no linked transaction at all — a leg from
   * before `transaction_id` was mandatory, or intentionally unlinked) is
   * left untouched by the gate below; every linked leg must additionally be
   * ACTIVE, not itself a REFUND row, `t.reverses_id IS NULL` (see the
   * "reversal rows" paragraph below — this is a DIFFERENT check from "was I
   * refunded"), not a DRAWER_TOPUP/DRAWER_TRANSFER (the
   * shop's own cash-in/inter-drawer move, never customer tender — D1 audit:
   * "owner cash-in is posted as CASH"), and not the ORIGINAL of an ACTIVE
   * refund. That last check can't be a column read: `refundTransaction`
   * deliberately leaves the original row `status = 'ACTIVE'` (so the
   * SALE/module + REFUND profit nets to zero — see `TransactionWithUser
   * .reversed_by_id`'s doc comment), so the only way to know a transaction
   * was refunded is the {@link notReversedByRefund} fragment below (same
   * correlated-subquery shape as `TransactionRepository`'s own
   * `reversed_by_id` computed column — see that fragment's doc comment for
   * why this file keeps its own copy instead of importing one).
   *
   * PA-3.5 round 2 (LPAY-1 — reversal ROWS, not just refunded originals): a
   * VOID (as opposed to a refund) never writes a REFUND-typed row at all.
   * `TransactionRepository.voidTransaction` writes its reversal with the
   * ORIGINAL transaction's type (e.g. `EXPENSE`, `FINANCIAL_SERVICE`),
   * `status = 'ACTIVE'`, and `reverses_id` set to the voided original,
   * then `_reversePayments` posts the NEGATED legs onto THAT reversal row.
   * For a voided CASH expense/payout that means the reversal row carries a
   * POSITIVE CASH leg on an ACTIVE, non-REFUND, non-DRAWER_TOPUP/TRANSFER
   * row — every gate above passes it, and it read as brand-new cash intake
   * (confirmed by probe: a voided $40 CASH expense plus its ACTIVE $40
   * reversal returned `{method:'CASH', total_usd:40}` before this fix).
   * `notReversedByRefund` cannot catch this shape (it asks "was a REFUND
   * later filed against me", not "am I myself a reversal"), so this needs
   * its own, simpler gate: `t.reverses_id IS NULL` excludes ANY row that is
   * itself a reversal (void or refund alike — a REFUND row is already
   * excluded by `t.type != 'REFUND'` above, so this is deliberately
   * redundant for that case and load-bearing only for the void-reversal
   * case, which keeps the original type).
   *
   * PA-4.15 (count distinct transactions, not legs): `COUNT(DISTINCT
   * COALESCE(p.transaction_id, -p.id))` — a single transaction can post more
   * than one leg of the same method (a split-tender leg plus e.g. a
   * kept-change leg), which inflated the "Count" column when it summed rows
   * instead of transactions. The negated `p.id` fallback keeps an orphaned
   * (transaction_id IS NULL) leg counted as its own unit rather than
   * silently merged away — `COUNT(DISTINCT x)` ignores NULLs outright, and a
   * bare `COALESCE(p.transaction_id, p.id)` could theoretically collide a
   * payment's own id with an unrelated transaction's id in the same method
   * group; negating rules that out (transaction ids are always positive).
   *
   * PA-4.15 (count distinct units, not legs — updated round 4): the "unit"
   * being counted is now a transaction (`'txn:' || transaction_id`), a
   * session basket (`'session:' || session_id`), or a fully-orphaned leg
   * (`'orphan:' || payment.id`) — see the CTEs below — so a pooled
   * session-basket leg collapses to ONE count the same way a multi-leg
   * transaction already did.
   *
   * Owner decision 1 (2026-09-24): "the tab means what actually stayed in
   * the drawer, by tender" — `total_usd`/`total_lbp` are now the SIGNED net
   * of every leg sharing the same (unit, method) — the old `p.amount > 0`
   * filter (sum positives only, silently dropping any OUT/change leg) is
   * GONE. A $100-note $80 sale (CASH +100 tender, CASH −20 change, same
   * transaction) nets to CASH 80, not 100. A unit's net for a method is only
   * counted when positive (a return-only unit nets ≤ 0 and contributes
   * nothing) — EXCEPT a partial item refund (see below), which is added
   * UNFLOORED so it can subtract.
   *
   * LPAY-X1 (round 5, OWNER_NOTES_2026-09-21.md §6.8 — rule 17 test:
   * `ProfitRepository.paymentMethodRows.test.ts`'s "LPAY-X1" describe block):
   * the floor above is applied at the UNIT level, NOT per currency.
   * `SalesRepository.processSale` posts cross-currency change as a SEPARATE
   * CASH leg in the OTHER currency (paid USD, change LBP, or vice versa —
   * see that method's own "Change given" leg comment), so a unit's
   * `net_usd` and `net_lbp` are not independent quantities. Flooring each
   * one on its own sign (`WHEN net_usd > 0 THEN net_usd ELSE 0`, separately
   * for `net_lbp`) silently dropped a genuinely-given change leg whenever it
   * fell in the OTHER currency from the tender: measured (a USD sale with
   * LBP change) inflated `total_lbp` by the full change amount instead of
   * subtracting it. The fix: a unit contributes to a method's totals only
   * when it is net-positive in AT LEAST ONE currency (`net_usd > 0 OR
   * net_lbp > 0`); once it qualifies, BOTH `net_usd` and `net_lbp` are added
   * SIGNED — including a negative one. A unit negative in BOTH currencies
   * (a pure return) still contributes nothing, unchanged. The SAME rule is
   * applied to `debt_repayment_usd`/`debt_repayment_lbp` below (a
   * debt-repayment unit is gated on the SAME `net_usd > 0 OR net_lbp > 0`
   * test, then both currencies are added signed) — the old per-currency gate
   * had the identical bug there (a USD debt repayment with LBP change lost
   * the LBP change entirely).
   *
   * Owner judgment needed (flagged, not resolved here — out of this ticket's
   * scope): a RECEIVE-style unit that pays out a USD payout leg alongside an
   * LBP fee leg on the SAME unit would, under this same rule, have its
   * negative USD leg subtract from `total_usd` once the unit qualifies via
   * the positive LBP fee. That is drawer-true (it really is what left the
   * till), but it is not yet decided whether "cash intake by method" should
   * read a payout's own currency that way, or whether a payout-shaped unit
   * needs its own carve-out (the way a partial refund already has one).
   *
   * LPAY-V-1 (round-1 review, OWNER_NOTES_2026-09-21.md §6.9 status table):
   * `ExchangeRepository` posts a non-partner exchange's IN leg (`CASH
   * +fromCurrency`) and OUT leg(s) (`CASH -toCurrency`, or split payout legs
   * in other methods) onto ONE transaction, so an EXCHANGE unit used to land
   * in `linked_legs` like any sale and get netted by this same rule — a
   * $100 USD→LBP exchange showed `CASH total_lbp -8,950,000` (the LBP leg
   * alone, since it is negative-only and the USD leg qualifies the unit);
   * `total_usd` and `total_lbp` only track USD/LBP columns, so a third-
   * currency leg (EUR, USDT) is invisible to `qualifies` entirely — an
   * EUR→USD exchange (`CASH EUR +100` untracked, `CASH USD -100`) vanished
   * with NO row at all, while USD→EUR showed a phantom `+$100` (the IN leg
   * counted, the EUR OUT leg untracked). None of that is "what stayed in the
   * drawer from a customer's tender" (owner decision 1) — an exchange is a
   * currency conversion, not a sale/service/debt payment. Same-shaped
   * SAFE default as `DRAWER_TOPUP`/`DRAWER_TRANSFER` two lines below
   * (neither is customer intake either): `TRANSACTION_TYPES.EXCHANGE` is
   * now excluded from `linked_legs` by `t.type NOT IN (...)`, dropping the
   * whole unit — both currencies, third-currency legs included — off this
   * tab. **Not an owner-confirmed decision** — same open-question class as
   * the RECEIVE-payout paragraph above; the alternative (keep EXCHANGE
   * visible, with a symmetric no-floor carve-out so a third-currency leg
   * doesn't vanish either) is undecided. See
   * `ProfitRepository.paymentMethodRows.test.ts`'s "LPAY-V-1 (round-1
   * review) — EXCHANGE units are excluded" block for the failing-first
   * proof (USD→LBP, LBP→USD, EUR→USD, USD→EUR shapes).
   *
   * LPAY-X4 (round 5, OWNER_NOTES_2026-09-21.md §6.8 — rule 17 test: the
   * "LPAY-X4" describe block in the same test file): the final `HAVING`
   * clause was `total_usd > 0 OR total_lbp > 0 OR debt_repayment_usd > 0 OR
   * debt_repayment_lbp > 0`, so a period whose ONLY activity for a method
   * was a partial refund (a negative-only `total_usd`/`total_lbp`, added
   * unfloored per LPAY-V9 above) failed every `> 0` branch and the method
   * silently vanished from the report instead of showing its negative
   * total. Every comparison is now `<> 0` — a unit-level-floored total can
   * be genuinely negative post-LPAY-X1 too (the cross-currency debt-
   * repayment case above), so `<> 0` is the correct test in both cases, not
   * a partial-refund-only patch.
   *
   * Refund period placement (documented, not changed by this ticket): a
   * WHOLE-transaction refund/void and a PARTIAL item refund land in
   * DIFFERENT periods by construction, not by choice inside this query. A
   * whole reversal's original transaction keeps its OWN `created_at`, but
   * `notReversedByRefund`/`reverses_id IS NULL` drop the original's unit
   * from `linked_legs` entirely once it has an ACTIVE refund/void against
   * it — so the ORIGINAL sale's period loses that intake, regardless of
   * which period the reversal itself falls in. A partial item refund
   * (`SalesRepository.refundSaleItem`) is the opposite: it is its own NEW
   * transaction row with its OWN `created_at` and never sets `reverses_id`,
   * so it is admitted as its own unit and its negative net lands in
   * WHATEVER period the refund itself happened in — which can be a later
   * period than the original sale (LPAY-X4's test above deliberately puts
   * the refund alone in a window with no matching original). This asymmetry
   * is inherent to how each reversal shape is recorded, not a bug in this
   * query.
   *
   * Owner decision 1 / LPAY-V9 (partial item refunds subtracted):
   * `SalesRepository.refundSaleItem` writes its own `REFUND`-typed
   * transaction with `reverses_id` left NULL (unlike a whole-transaction
   * refund/void, which always sets `reverses_id`) and its own pro-rated
   * NEGATIVE mirror legs. `t.reverses_id IS NULL` — already required below —
   * is therefore sufficient on its own to admit a partial refund's unit
   * while a whole-transaction refund (reverses_id SET) is excluded exactly
   * as before; the old separate `t.type != 'REFUND'` gate is GONE (it used
   * to reject every REFUND row, partial or whole, unconditionally). A
   * partial refund's own net for a method is added to `total_usd`/
   * `total_lbp` UNFLOORED (`is_partial_refund = 1` skips the `net > 0`
   * floor) so its negative value genuinely subtracts from that method's
   * grand total, rather than flooring to a no-op zero the way an ordinary
   * return-only unit does.
   *
   * LPAY-V1 (session-basket orphan legs): `SessionPaymentService
   * .recordBasketPayment` → `insertSessionLeg` posts a session basket's
   * pooled cash leg(s) with `transaction_id IS NULL, session_id` set — the
   * OLD `t.id IS NULL` branch let these through with NO reversal check at
   * all, so a VOIDED/refunded basket's cash still counted and its OUT legs
   * (change, payouts) were silently dropped (no netting existed yet). Now a
   * dedicated `session_legs` CTE nets IN vs OUT per session (same signed-net
   * mechanism as a transaction) and gates on
   * `sessionBasketNotReversedSql` — the SAME two checks
   * `_assertSessionBasketReversible` makes before allowing a
   * void/refund to proceed (rule 14: reused, not re-derived — see that
   * function's doc comment in `TransactionRepository.ts`).
   *
   * LPAY-V2 (provider-stock legs excluded by DRAWER): a provider-stock leg
   * (TELECOM_CREDIT_BUYBACK's credit leg, `method`/`drawer_name` both the
   * bare provider code "MTC"/"Alfa"; TELECOM_SELF_CHARGE's credit leg,
   * `method: "SELF_CHARGE"`) has no single method marker in common — only
   * the DRAWER does. `p.drawer_name NOT IN
   * (TransactionRepository.PROVIDER_STOCK_DRAWERS)` excludes it in every
   * branch (rule 14 — the SAME drawer set the LIRA-064 report already
   * excludes by).
   *
   * Owner decision 2 (customer wallet payments now shown): `OMT`/`WHISH`/
   * `BINANCE` were removed from `PAYMENT_REPORT_PROVIDER_MARKERS` (see that
   * constant's own doc comment) — a customer paying via their OMT/Whish
   * Wallet or Binance now shows under that method, separated from the
   * provider's own internal legs by DRAWER/METHOD-MARKER (`INTERNAL_LEG
   * _METHODS`'s `OMT_APP`/`WHISH_APP`/`RESERVE`/`TRANSFER` entries, plus the
   * new drawer-based provider-stock exclusion above), never by a blanket
   * method-code ban.
   *
   * Owner decision 3 (debt repayment split into its own column):
   * `debt_repayment_usd`/`debt_repayment_lbp` replace the old all-or-nothing
   * `is_debt_repayment_only` flag — a unit whose transaction type is
   * `DEBT_REPAYMENT` contributes to these columns instead of
   * `total_usd`/`total_lbp`, so a method that took BOTH new-sales and
   * debt-repayment money in the same period shows both, instead of one
   * hiding the other. `count` is unaffected — a debt-repayment unit still
   * counts as one transaction for that method.
   *
   * `count` (LPAY-V9 interaction): a partial refund's own unit never
   * increments `count` (`is_partial_refund = 0` required) — it is a
   * reduction of an EARLIER unit's total, not a new transaction of its own.
   *
   * `count` (PAY-C, owner decision (c), 2026-09-24, OWNER_NOTES_2026-09-21.md
   * §6.9): counts a unit under a method only when that method itself
   * RECEIVED money in the unit — its own (unit, method) net is positive in
   * at least one currency (`un.net_usd > 0 OR un.net_lbp > 0`). A $100 OMT
   * sale with $20 CASH change increments ONLY OMT's `count` — CASH's only
   * leg in that unit is the change going back out, so it never counted as a
   * CASH "transaction". This SUPERSEDES the LPAY-V-2 round-1-review
   * behavior (which counted a unit under every method it merely touched,
   * unconditionally on the unit-level floor alone); the totals above
   * (`total_usd`/`total_lbp`/`debt_repayment_*`) are UNCHANGED — CASH still
   * shows its real -20 drawer outflow — only `count` gained this extra
   * per-method condition. Cross-currency same-method legs are unaffected: a
   * CASH USD tender with CASH LBP change still counts once for CASH (its
   * own net_usd is positive), and a genuine split tender (two methods each
   * with their own positive leg) still counts under both.
   */
  getPaymentMethodRows(fromDt: string, toDt: string): PaymentMethodRow[] {
    const tenantId = getCurrentTenantId();
    const internalMethods = internalPaymentMethodsSql();
    const providerStockDrawers = providerStockDrawersSql();
    return this.db
      .prepare(
        `WITH linked_legs AS (
          SELECT
            'txn:' || p.transaction_id AS unit_id,
            p.method AS method,
            p.currency_code AS currency_code,
            p.amount AS amount,
            CASE WHEN t.type = 'DEBT_REPAYMENT' THEN 1 ELSE 0 END AS is_debt_repayment,
            CASE WHEN t.type = 'REFUND' THEN 1 ELSE 0 END AS is_partial_refund
          FROM payments p
          JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = ?
          WHERE ${dateRange("p.created_at")}
            AND p.method NOT IN (${internalMethods})
            AND p.drawer_name NOT IN (${providerStockDrawers})
            AND p.tenant_id = ?
            AND t.status = 'ACTIVE'
            -- Whole-transaction void/refund reversal rows always set
            -- reverses_id; a partial item refund (SalesRepository
            -- .refundSaleItem) never does, so this single check both admits
            -- the partial refund's own unit and excludes every whole-
            -- transaction reversal, void or refund alike.
            AND t.reverses_id IS NULL
            AND t.type NOT IN (?, ?, ?)
            AND ${notReversedByRefund("t")}
        ),
        session_legs AS (
          SELECT
            'session:' || p.session_id AS unit_id,
            p.method AS method,
            p.currency_code AS currency_code,
            p.amount AS amount,
            0 AS is_debt_repayment,
            0 AS is_partial_refund
          FROM payments p
          WHERE ${dateRange("p.created_at")}
            AND p.transaction_id IS NULL
            AND p.session_id IS NOT NULL
            AND p.method NOT IN (${internalMethods})
            AND p.drawer_name NOT IN (${providerStockDrawers})
            AND p.tenant_id = ?
            AND ${sessionBasketNotReversedSql("p.session_id", "p.tenant_id")}
        ),
        orphan_legs AS (
          SELECT
            'orphan:' || p.id AS unit_id,
            p.method AS method,
            p.currency_code AS currency_code,
            p.amount AS amount,
            0 AS is_debt_repayment,
            0 AS is_partial_refund
          FROM payments p
          WHERE ${dateRange("p.created_at")}
            AND p.transaction_id IS NULL
            AND p.session_id IS NULL
            AND p.method NOT IN (${internalMethods})
            AND p.drawer_name NOT IN (${providerStockDrawers})
            AND p.tenant_id = ?
        ),
        all_legs AS (
          SELECT * FROM linked_legs
          UNION ALL
          SELECT * FROM session_legs
          UNION ALL
          SELECT * FROM orphan_legs
        ),
        unit_net AS (
          SELECT
            unit_id,
            method,
            MAX(is_debt_repayment) AS is_debt_repayment,
            MAX(is_partial_refund) AS is_partial_refund,
            SUM(CASE WHEN currency_code = 'USD' THEN amount ELSE 0 END) AS net_usd,
            SUM(CASE WHEN currency_code = 'LBP' THEN amount ELSE 0 END) AS net_lbp
          FROM all_legs
          GROUP BY unit_id, method
        ),
        -- LPAY-V2 (OWNER_NOTES_2026-09-21.md §6.9 round-1 review): the floor
        -- ("did this unit net positive, so its OUT legs subtract instead of
        -- flooring to 0") used to be decided per (unit_id, method) -- i.e. on
        -- unit_net directly -- which only sees ONE method's legs at a time.
        -- SalesRepository.processSale always posts change_given_usd/_lbp
        -- as a CASH leg REGARDLESS of the tender method
        -- (SalesRepository.ts change-given comment), so an OMT/WHISH/BINANCE
        -- -tendered sale with cash change split into two (unit_id, method)
        -- groups: the tender's group (positive, qualifies on its own) and
        -- CASH's group (negative alone, floored away -- the change leaving
        -- the drawer was silently dropped, overstating CASH by the change
        -- amount). This CTE re-derives "qualifies" at the UNIT level,
        -- summing every method's net for that unit (rule 14 -- also closes
        -- LPAY-V5: this is the ONE place the qualification predicate is
        -- computed; every column below just references qualifies = 1).
        unit_qualifies AS (
          SELECT
            unit_id,
            CASE WHEN SUM(net_usd) > 0 OR SUM(net_lbp) > 0 THEN 1 ELSE 0 END AS qualifies
          FROM unit_net
          GROUP BY unit_id
        )
        SELECT
          un.method AS method,
          COALESCE(SUM(
            CASE
              WHEN un.is_debt_repayment = 1 THEN 0
              WHEN un.is_partial_refund = 1 THEN un.net_usd
              WHEN uq.qualifies = 1 THEN un.net_usd
              ELSE 0
            END
          ), 0) AS total_usd,
          COALESCE(SUM(
            CASE
              WHEN un.is_debt_repayment = 1 THEN 0
              WHEN un.is_partial_refund = 1 THEN un.net_lbp
              WHEN uq.qualifies = 1 THEN un.net_lbp
              ELSE 0
            END
          ), 0) AS total_lbp,
          COALESCE(SUM(CASE WHEN un.is_debt_repayment = 1 AND uq.qualifies = 1 THEN un.net_usd ELSE 0 END), 0) AS debt_repayment_usd,
          COALESCE(SUM(CASE WHEN un.is_debt_repayment = 1 AND uq.qualifies = 1 THEN un.net_lbp ELSE 0 END), 0) AS debt_repayment_lbp,
          COUNT(DISTINCT CASE WHEN un.is_partial_refund = 0 AND uq.qualifies = 1 AND (un.net_usd > 0 OR un.net_lbp > 0) THEN un.unit_id END) AS count,
          0 AS pending_commission_usd,
          1 AS is_settled
        FROM unit_net un
        JOIN unit_qualifies uq ON uq.unit_id = un.unit_id
        GROUP BY un.method
        HAVING total_usd <> 0 OR total_lbp <> 0 OR debt_repayment_usd <> 0 OR debt_repayment_lbp <> 0`,
      )
      .all(
        tenantId,
        fromDt,
        toDt,
        tenantId,
        TRANSACTION_TYPES.DRAWER_TOPUP,
        TRANSACTION_TYPES.DRAWER_TRANSFER,
        TRANSACTION_TYPES.EXCHANGE,
        fromDt,
        toDt,
        tenantId,
        fromDt,
        toDt,
        tenantId,
      ) as PaymentMethodRow[];
  }

  /**
   * Realized (settled) financial-service commission totals by currency —
   * feeds ProfitService.getByPaymentMethod's "Commission (Settled)" row.
   *
   * LIRA-108: realized means real on EVERY axis, so beyond `is_settled = 1`
   * this carries the same counterparty gates as its per-currency sibling
   * `getFinancialSettledByCurrency`: `notDebtPending` (DBT-1 — a
   * CUSTOMER_ACCOUNT-charged service defers until the client repays), via
   * the same transactions JOIN shape (`t.status = 'ACTIVE'`). A
   * settled-but-fully-debt-pending row is withheld here AND from the
   * pending row (which keys on is_settled = 0) — it surfaces in
   * getDeferredProfit until settlement/repayment, matching the per-currency
   * pair.
   *
   * Proportional recognition (owner decision 2026-09-05): the partner axis
   * (PFT-6) is no longer a binary `notPartnerPending` gate — `total_usd`/
   * `total_lbp` are weighted by {@link partnerCoverageRatio} (a for-partner
   * row's commission share recognises as the partner's settlement coverage
   * arrives, not all-or-nothing), and `count` counts a row the moment ANY
   * money has arrived (`ratio > 0`), never fractionally.
   *
   * LIRA-158 (COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2a): this now counts
   * LEGACY (`commission_model = 0`) rows only, via `embeddedCommission`. It
   * used to be true that this row "has always counted every commission > 0
   * row regardless of provider" — that is now FALSE for AT_SETTLEMENT rows
   * (`commission_model = 1`): their `fs.commission` column is a stale
   * creation-time estimate that is never corrected, and their real,
   * operator-entered commission is recognised instead at settlement time on
   * the SUPPLIER_SETTLEMENT transaction (settlement-day, D7 — see
   * {@link getSupplierCommissionTotals}). `commission > 0` is KEPT
   * alongside the new gate — with model-1 rows excluded by
   * `embeddedCommission`, it goes back to being a plain "this legacy row
   * actually earned a commission" filter instead of doubling as a model
   * discriminator. The `provider IN (COMMISSION_PROVIDERS)` filter is still
   * deliberately NOT adopted from the sibling — narrowing by provider
   * remains a separate owner-facing semantics question, not part of either
   * the LIRA-108 gate closure or this fix.
   *
   * LPAY-6 / LPAY-R3-3 (round-2 then round-3 review, OWNER_NOTES_2026-09-21.md
   * §6.5 PA-3.5 review): this bucketed on `fs.currency != 'LBP'`, not
   * PA-1.4's `= 'USD'` convention — a EUR/USDT financial-service commission
   * lumped into `total_usd` here, same leftover PA-1.4 never reached
   * (`getFinancialSettledByCurrency` makes the identical choice, deliberately,
   * per its own comment, and is UNCHANGED by this fix).
   *
   * `FinancialRepository.getMonthlyPL` (a different report, a different
   * owning lane) also calls this exact repository method, and so does another
   * `ProfitService` call site outside this tab (see "getPendingCommissionTotals
   * is owned by lane LO" in ProfitService.ts) — narrowing the bucketing
   * UNCONDITIONALLY would change those screens' numbers too without that
   * lane's review, and would invalidate the currency-bucketing assertions
   * pinned across `LIRA158.*`, `ProfitRepository.commissionGates`,
   * `ProfitRepository.partnerProportional.byProviderAndDate` and
   * `ProfitRepository.tenantIsolation`, none of which this lane owns.
   *
   * Fix: an additive `strictUsdBucketing` parameter (default `false` — the
   * OLD `!= 'LBP'` behavior, byte-for-byte, for every existing caller).
   * `ProfitService.getByPaymentMethod` — this lane's own method — is the
   * ONLY caller that passes `true`, via {@link usdBucketPredicate}. See
   * `ProfitRepository.byPaymentCommissionCurrency.test.ts` (LPAY-R3-3).
   */
  getRealizedCommissionTotals(
    fromDt: string,
    toDt: string,
    strictUsdBucketing = false,
  ): CommissionTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN ${usdBucketPredicate("fs.currency", strictUsdBucketing)} THEN fs.commission * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS total_usd,
          COALESCE(SUM(CASE WHEN fs.currency  = 'LBP' THEN fs.commission * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS total_lbp,
          SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.is_settled = 1
          AND fs.commission > 0
          AND ${embeddedCommission("fs", this._hasCommissionModelColumn())}
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?`,
      )
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as CommissionTotalsRow;
  }

  /**
   * Pending (unsettled) financial-service commission totals by currency.
   *
   * LIRA-108 (deliberate): NO notPartnerPending/notDebtPending gates here —
   * this is the PRE-recognition bucket keyed purely on `is_settled = 0`,
   * mirroring getFinancialPendingByCurrency. A supplier-UNsettled row
   * genuinely awaits settlement regardless of counterparty state; a
   * supplier-SETTLED but partner-/debt-pending row is excluded from realized
   * by the gates and from here by `is_settled = 0`, and lives in
   * getDeferredProfit instead. Adding the gates here would double-hide it.
   *
   * LIRA-158 (Phase 2a): `total_usd`/`total_lbp`/`count` restricted to
   * LEGACY (`commission_model = 0`) rows via `embeddedCommission` — an
   * AT_SETTLEMENT row's `commission` column is an unreliable creation-time
   * estimate, never the true pending figure (it is 0 forever for
   * WHISH/BILL, and never corrected for OMT/WHISH SEND/RECEIVE).
   *
   * LIRA-158 (Phase 2b/D15): `awaiting_settlement_count` is the model-1
   * counterpart — a COUNT, never a dollar figure, since a model-1 row's
   * pending commission is genuinely unknowable until settlement (a WHISH
   * or BILL row's `commission` column is 0 even while genuinely pending —
   * §1.1 of the plan — so it can never satisfy `commission > 0` and must
   * NOT be gated by that predicate the way the legacy figure is).
   *
   * LPAY-6 / LPAY-R3-3: same `currency != 'LBP'` bucketing as {@link
   * getRealizedCommissionTotals} — see that method's doc comment for the
   * fix (an additive `strictUsdBucketing` parameter, default `false`,
   * unchanged for every caller but `ProfitService.getByPaymentMethod`).
   * `count`/`awaiting_settlement_count` stay currency-agnostic either way —
   * same precedent as `getPaymentMethodRows`'s `count` (PA-1.4 payment
   * part): a non-USD/LBP commission still counts as one pending row, it
   * just has no dollar column of its own.
   *
   * The outer `WHERE` therefore only carries `is_settled = 0` plus the
   * counterparty-agnostic gates (`notRefunded`, `dateRange`, `tenant_id`) —
   * `commission > 0` and the model split both moved INTO the individual
   * `CASE` expressions below, so a single pass over the is_settled = 0 rows
   * produces both the legacy dollar figure and the new-model count without
   * either excluding rows the other needs.
   */
  getPendingCommissionTotals(
    fromDt: string,
    toDt: string,
    strictUsdBucketing = false,
  ): PendingCommissionTotalsRow {
    const supported = this._hasCommissionModelColumn();
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN ${usdBucketPredicate("currency", strictUsdBucketing)} AND commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN commission ELSE 0 END), 0) AS total_usd,
          COALESCE(SUM(CASE WHEN currency  = 'LBP' AND commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN commission ELSE 0 END), 0) AS total_lbp,
          COALESCE(SUM(CASE WHEN commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN 1 ELSE 0 END), 0) AS count,
          COALESCE(SUM(CASE WHEN ${atSettlementCommission("financial_services", supported)} THEN 1 ELSE 0 END), 0) AS awaiting_settlement_count
        FROM financial_services
        WHERE is_settled = 0
          AND ${notRefunded("financial_services")}
          AND ${dateRange("created_at")}
          AND tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as PendingCommissionTotalsRow;
  }

  /**
   * Per-provider pending commission detail (for the pending-row label).
   *
   * LIRA-158 (Phase 2a/2b/D15): same split as {@link getPendingCommissionTotals}
   * — see that method's doc comment for the full rationale. Must stay
   * predicate-identical to it (both the legacy `embeddedCommission` gate AND
   * the new `atSettlementCommission` gate) or the per-provider breakdown
   * diverges from the totals row it's meant to explain.
   *
   * A provider whose ONLY pending rows are model-1 (e.g. a WHISH/BILL
   * provider, whose `commission` column is 0 even while genuinely pending)
   * still surfaces here with `total_usd: 0` and a nonzero
   * `awaiting_settlement_count` — the outer `WHERE` only filters on
   * `is_settled = 0` (not `commission > 0`), so `GROUP BY provider` sees
   * every pending row of every model, not just the ones with a nonzero
   * legacy estimate.
   *
   * LPAY-R3-3: same additive `strictUsdBucketing` parameter as {@link
   * getRealizedCommissionTotals} / {@link getPendingCommissionTotals} —
   * default `false` preserves the old `!= 'LBP'` label total byte-for-byte
   * for every caller but `ProfitService.getByPaymentMethod`.
   *
   * LPAY-V7 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3):
   * `total_lbp` — the `currency = 'LBP'` counterpart of `total_usd`, using
   * the SAME `commission > 0 AND embeddedCommission(...)` gate. Previously
   * absent entirely, so a legacy model-0 provider whose pending commission
   * is denominated in LBP surfaced as "$0.00" in
   * `ProfitService.getByPaymentMethod`'s per-provider label even though it
   * genuinely had a pending LBP figure.
   */
  getPendingCommissionByProvider(
    fromDt: string,
    toDt: string,
    strictUsdBucketing = false,
  ): PendingCommissionByProviderRow[] {
    const supported = this._hasCommissionModelColumn();
    return this.db
      .prepare(
        `SELECT provider,
           COALESCE(SUM(CASE WHEN ${usdBucketPredicate("currency", strictUsdBucketing)} AND commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN commission ELSE 0 END), 0) AS total_usd,
           COALESCE(SUM(CASE WHEN currency = 'LBP' AND commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN commission ELSE 0 END), 0) AS total_lbp,
           COALESCE(SUM(CASE WHEN commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN 1 ELSE 0 END), 0) AS count,
           COALESCE(SUM(CASE WHEN ${atSettlementCommission("financial_services", supported)} THEN 1 ELSE 0 END), 0) AS awaiting_settlement_count
         FROM financial_services
         WHERE is_settled = 0
           AND ${notRefunded("financial_services")}
           AND ${dateRange("created_at")}
           AND tenant_id = ?
         GROUP BY provider`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
      ) as PendingCommissionByProviderRow[];
  }

  // ---------------------------------------------------------------------------
  // By user (getByUser)
  // ---------------------------------------------------------------------------

  /**
   * Profit + realized revenue grouped by cashier. Revenue is gated per type:
   * FINANCIAL_SERVICE → only is_settled=1; SALE → only fully-paid; else amount.
   * Profit comes from transactions.profit_usd with the same realized gates.
   *
   * PROPORTIONAL CONVERSION (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md
   * Step 2) — the combined `NOT (txnNotPartnerPending(t) AND
   * notDebtPending(t.id))` gate is split apart: client debt (DBT-1) stays a
   * BINARY gate (`WHEN NOT notDebtPending(t.id) THEN 0`, unchanged — client
   * debt is explicitly out of scope for this conversion, owner decision
   * 2026-09-05), while partner coverage (PFT-6) becomes continuous for every
   * branch this method can convert on its own. The plain `financial_services`
   * is_settled branch and the generic `ELSE` had NO partner-awareness of
   * their own (they relied entirely on the now-removed outer
   * `txnNotPartnerPending` gate), so each is multiplied here directly by
   * `txnPartnerCoverageRatio(t)` (defaults to 1.0 for a non-partner row, a
   * no-op, exactly reproducing today's unconditional pass-through).
   * `transaction_count` (`COUNT(*)`, no CASE at all) was never gated by
   * either predicate to begin with — nothing to convert, left untouched.
   * `revenue_lbp` USED TO be a flat `SUM(t.amount_lbp)` for the same
   * reason — see PA-1.2/PA-1.7 below for why it no longer is.
   *
   * PA-1.2 / PA-1.7 (OWNER_NOTES_2026-09-21.md §6.3) — the `financial_services`
   * branch of `revenue_usd` re-derived its number from the joined `fs` row
   * ({@link fsRevenue}, keyed off `fs.price`/`fs.amount`) with NO check of
   * `fs.currency`, so an LBP-denominated transfer added its raw LBP amount
   * straight into `revenue_usd` (a 5,000,000 LBP transfer read "+$5,000,000").
   * Fixed by gating that arm on the shared strict USD bucket
   * (`usdBucketPredicate(fs.currency, true)`, LCC-X3 Round 3 — an EARLIER
   * version of this fix used `fs.currency != 'LBP'`, which still lumped a
   * non-USD/non-LBP currency like EUR into the USD column; see
   * {@link usdBucketPredicate}'s own doc comment). `revenue_lbp` was a flat,
   * UNGATED `SUM(t.amount_lbp)` — none of `revenue_usd`'s recognition gates
   * (debt-pending, `fsStampRecognized`, `isVoidReversalRow`, the refund sign
   * flip, `saleRecognitionWeight`) applied to it, and the UI never rendered
   * it at all (PA-1.7). It is now built as revenue_usd's exact structural
   * mirror: the FS branch gates on `fs.currency = 'LBP'` instead (an exact
   * match was always correct for the LBP side; only the USD side lumped
   * other currencies in) and reads the SAME `fsRevenue(fs)` (already
   * denominated in `fs.currency`'s units — there is no separate LBP source
   * column), the SALE branch contributes 0 (the `sales` table has no
   * `final_amount_lbp` — sale revenue is always USD-denominated in this
   * schema; LBP TENDERED for a sale is a payment-method fact, not a
   * revenue-currency fact), and the ELSE branch reads `t.amount_lbp`
   * (already currency-correct at write time for every other module —
   * `FinancialServiceRepository.createTransaction` zeroes whichever of
   * `amount_usd`/`amount_lbp` doesn't match the row's own currency) instead
   * of `t.amount_usd`.
   *
   * PA-1.3 (OWNER_NOTES_2026-09-21.md §6.3) — `pending_profit_usd`'s
   * `SUM(fs2.commission)` had no currency filter, so an LBP-denominated
   * unsettled legacy commission was added into a column the UI renders with
   * a hard-coded `$`. Split into `pending_profit_usd` (the same strict
   * `usdBucketPredicate(fs2.currency, true)`, LCC-X3) and
   * `pending_profit_lbp` (`fs2.currency = 'LBP'`), same USD-bucket
   * convention as PA-1.2.
   *
   * PA-2.5 (OWNER_NOTES_2026-09-21.md §6.4) — a CASHLESS supplier-settlement
   * commission used to land on the SETTLING transaction's own group (whoever
   * clicked "settle") via `supplierSettlementProfitArm`. That arm now
   * contributes 0 for the cashless case, and
   * {@link reattributedSettlementCommission} adds the SAME total back, once
   * per output row, keyed to each allocation's OWN originating
   * FINANCIAL_SERVICE transaction's `user_id` instead — see that function's
   * own doc comment for the full mechanism and why a plain `SUM` cannot be
   * used for a second, independently-grouped data source.
   *
   * PA-2.6 (OWNER_NOTES_2026-09-21.md §6.4) — three profit sources this
   * method left out entirely: payment-method fees (now added inline inside
   * the existing FS-branch subquery — same `fs` row already joined, gated by
   * `notRefunded(fs)` only, matching `getByDate`'s `daily_pmfee` CTE's own
   * "recognised immediately, retroactively removed on refund" semantics, NOT
   * `fsStampRecognized` — a PM fee is real money kept at the counter whether
   * or not the underlying transfer has settled) and kept change on
   * DEBT_REPAYMENT/KEPT_CHANGE rows (added via
   * {@link keptChangeProfitForKey}, the same "once per output row" shape as
   * PA-2.5's reattribution — these are a DIFFERENT `transactions` row the
   * per-row CASE never iterates, deliberately NOT folded into
   * {@link PROFIT_TXN_TYPES} since that shared constant also feeds
   * `getDeferredProfit`, owned by a different lane). Counterparty
   * (debt/supplier/partner-ledger) discounts are DELIBERATELY NOT added — a
   * discount's "who earned this" is genuinely three-way ambiguous
   * (client/supplier/partner ledger, not a single cashier) — the UI captions
   * this as excluded rather than guessing.
   *
   * LCC-V3 (Round 2 adversarial review) — exchange profit was ALSO left out
   * here originally, captioned "not attributable to a single cashier". That
   * caption was false for getByUser specifically: `ExchangeRepository
   * .createTransaction` stamps a real `user_id` (`createdBy`) on every
   * exchange row's unified transaction — it is simply never one of
   * {@link PROFIT_TXN_TYPES}, the SAME "different source row" shape
   * {@link keptChangeProfitForKey} already handles above. Added via
   * {@link exchangeProfitForUser}, the same "once per output row" mechanism.
   * `getByClient` is the one that genuinely cannot attribute it (no
   * `client_id` on an exchange row) — see that method's own doc comment,
   * unchanged.
   *
   * PA-2.11 (OWNER_NOTES_2026-09-21.md §6.4) — a REFUND row used to be dated
   * by ITS OWN `created_at` (when the refund was clicked), while the
   * Overview nets a refund against the ORIGINAL sale's period
   * (`getSalesProfit`'s own doc comment). The WHERE clause now dates by
   * `COALESCE(orig.created_at, t.created_at)` — `orig` is the SAME
   * {@link refundOriginalJoin} join already used for user attribution, just
   * also applied to the date filter (that join resolves `orig` by
   * `reverses_id` OR, for a `refundSaleItem` item refund with no
   * `reverses_id`, by a uniqueness-guaranteed `source_id` fallback — see its
   * own doc comment for the full mechanism, including the round-2
   * fan-out fix).
   *
   * PA-4.19 (OWNER_NOTES_2026-09-21.md §6.6, "Avg Profit/Txn" half only —
   * the Pending-tab copy line is a different lane) — `transaction_count`
   * (`COUNT(*)` over every `PROFIT_TXN_TYPES` row) counts a SALE and its
   * REFUND as TWO transactions even though their profit nets to the SAME
   * total a single sale would have produced, counts a SUPPLIER_SETTLEMENT
   * batch (not a "per-transaction" event), and counts an unsettled legacy FS
   * row that contributes $0 recognised profit — all of which drag "Avg
   * Profit/Txn" down without representing a real, distinct profit-bearing
   * event. `recognized_transaction_count` is a SEPARATE new column (existing
   * `transaction_count` is unchanged — it still feeds the plain "Transactions"
   * column elsewhere) that excludes REFUND and SUPPLIER_SETTLEMENT rows and
   * an unrecognized FS row, so the UI's average divides by the count of
   * events that actually contributed to `profit_usd`/`profit_lbp`.
   *
   * SALE branch (`saleRecognitionWeight`) — CONVERTED at merge (Task 3,
   * 2026-09-05): the cross-lane dependency Lane A/D each flagged and
   * deliberately left alone is now resolved. The three call sites below
   * (revenue_usd, profit_usd, profit_lbp) used to embed a boolean gate —
   * `WHEN salePaidOrPartnerSettled(s2) THEN <value> ELSE 0` — where a
   * `WHEN` position has no numeric value to multiply; each is now `<value>
   * * saleRecognitionWeight(s2)`, gate and weighting in the SAME edit (a
   * loosened gate without a weighted value would overstate a
   * partially-covered for-partner sale's revenue/profit at its FULL amount —
   * strictly worse than the old all-or-nothing exclusion, and the exact trap
   * Lane A stopped short of). `saleRecognitionWeight` is 1.0 fully
   * customer-paid, the partner's covered fraction for a for-partner sale
   * (was: all-or-nothing), 0 for a genuinely pending non-partner sale
   * (DBT-1, unchanged, out of scope). No row-membership change: this was
   * already a value-level CASE inside a `SUM`, never a `WHERE`-level
   * exclusion, so a user/client whose only activity is an uncovered
   * for-partner sale already produced a $0 row before this conversion (via
   * `transaction_count`, which is unconditional — see below) — nothing new
   * to guard against Task 2's phantom-row concern here.
   *
   * SUPPLIER_SETTLEMENT branch (`supplierSettlementProfitArm`) — genuinely
   * different shape, no follow-up needed: it returns a COMPLETE `WHEN ...
   * THEN (...)` clause (the whole branch, not a bare boolean), so Lane A can
   * freely reweight its OWN internal commission SUM without this call site's
   * syntax changing at all. Also: the SUPPLIER_SETTLEMENT/REFUND transaction
   * row itself is NEVER partner-pending (no `partner_ledger` row is ever
   * keyed to `reference_table = 'supplier_ledger'` — see PROFIT_TXN_TYPES's
   * own doc comment), so removing the outer `txnNotPartnerPending` gate has
   * zero effect on this branch's reachability either way.
   *
   * PA-0.1 (OWNER_NOTES_2026-09-21.md §6.2) — the three `financial_services`
   * CASE arms (revenue_usd, profit_usd, profit_lbp) are gated by
   * {@link fsStampRecognized}, not a bare `fs.is_settled = 1`: a model-1
   * row's stamp never carries deferred supplier commission (see that
   * function's own doc comment), so it is attributed to its user from
   * creation, not from settlement. A model-0 (legacy) row is unaffected —
   * it still needs `is_settled = 1`, which the predicate preserves.
   *
   * L0-1 (Round 2, same section) — the `revenue_usd` arm's `financial_services`
   * branch additionally gates on {@link isVoidReversalRow}: it re-derives its
   * number from the joined `fs` row ({@link fsRevenue}) rather than from
   * `t.amount_usd`, so a void's reversal row (same fs row, `reverses_id` set,
   * NOT a REFUND) would otherwise recompute the SAME positive revenue a
   * second time instead of the 0 its negated `amount_usd` implies — a voided
   * model-1 OMT/WHISH transfer showed its full principal as revenue before
   * this gate. `profit_usd`/`profit_lbp` need no equivalent gate — they read
   * `t.profit_usd`/`t.profit_lbp` directly, which the void already
   * zeroes/negates correctly on its own.
   */
  getByUser(fromDt: string, toDt: string): ProfitByUserRow[] {
    const tenantId = getCurrentTenantId();
    const hasAllocations = this._hasSettlementAllocationsTable();
    const hasExchangeTable = this._hasExchangeTransactionsTable();
    // REV lane (2026-09-24, PA-4.23 a parity) — see
    // saleRevenueUsdCaseBranch's own doc comment.
    const hasNetSaleCols = this._hasSaleDiscountAndRefundQuantityColumns();
    const saleRevenueUsdCaseBranchSql = saleRevenueUsdCaseBranch(hasNetSaleCols);

    const USER_KEY = "COALESCE(orig.user_id, t.user_id)";
    // LCC-V1 (Round 2): getByUser has at most ONE NULL/no-actor output group
    // (there is only one COALESCE(orig.user_id, t.user_id) = NULL bucket),
    // so a NULL-safe `IS` comparison against the single USER_KEY is correct
    // — see reattributedSettlementCommission's own doc comment for why
    // getByClient's multiple walk-in groups need a different match shape.
    const userReattMatchMain = `ft.user_id IS ${USER_KEY}`;
    // LCC-M1 (round 4): a kept-change REFUND's OWN user_id is the refunder,
    // not the original DEBT_REPAYMENT/KEPT_CHANGE creator — see
    // keptChangeAttributedUserId's own doc comment.
    const userKeptMatchMain = `${keptChangeAttributedUserId("kc")} IS ${USER_KEY}`;
    // LCC-V2: the orphan-row branch below has no `t`/`orig` in scope — it
    // matches against its own derived key table `k` instead.
    const userReattMatchOrphan = "ft.user_id IS k.user_id";
    const userKeptMatchOrphan = `${keptChangeAttributedUserId("kc")} IS k.user_id`;

    // LCC-V2 (Round 2, PA-2.5/PA-2.6 "NOT CLOSED") — three sources of "this
    // user has real money to report even though they have NO
    // PROFIT_TXN_TYPES row in the window at all": the cashless
    // settlement-commission originator (reattributedSettlementCommission),
    // a kept-change row (keptChangeProfitForKey), and (LCC-V3) an EXCHANGE
    // row (never one of PROFIT_TXN_TYPES to begin with). The main SELECT
    // below only emits a row per GROUP BY key found among PROFIT_TXN_TYPES
    // transactions, so a user whose ONLY window activity is one of these
    // three sources previously got NO row at all — the scalar was computed
    // correctly but had nowhere to land (measured: a transfer created
    // before the window, settled inside it, gave Σ profit 0 instead of the
    // expected commission). Each source degrades to omitting its own UNION
    // branch when its table doesn't exist (§5) — matches every other
    // schema-drift degradation in this file.
    const orphanUserKeySources: string[] = [];
    if (hasAllocations) {
      orphanUserKeySources.push(`SELECT DISTINCT ft2.user_id AS user_id
        FROM settlement_commission_allocations sca2
        JOIN financial_services fs2 ON ${currentSettlementAllocation("fs2", "sca2")}
        JOIN transactions ft2 ON ft2.source_table = 'financial_services'
          AND ft2.source_id = fs2.id AND ft2.type = 'FINANCIAL_SERVICE'
        WHERE ${allocationRecognitionGates("sca2", "fs2", "ft2")}`);
    }
    // LCC-M1 (round 4): the orphan-key source must offer the SAME attributed
    // key userKeptMatchOrphan will actually match against below, or a
    // kept-change REFUND whose refunder has no PROFIT_TXN_TYPES row of their
    // own would surface a phantom orphan key for the refunder (who now
    // correctly matches nothing) instead of the original creator.
    orphanUserKeySources.push(`SELECT DISTINCT ${keptChangeAttributedUserId("kc2")} AS user_id
        FROM transactions kc2
        WHERE ${keptChangeRecognitionGates("kc2")}`);
    if (hasExchangeTable) {
      orphanUserKeySources.push(`SELECT DISTINCT et2.user_id AS user_id
        FROM exchange_transactions ext2
        JOIN transactions et2 ON et2.source_table = 'exchange_transactions'
          AND et2.source_id = ext2.id AND et2.type = 'EXCHANGE'
        WHERE ${exchangeRecognitionGates("ext2", "et2")}`);
    }
    const orphanUserKeysSql = orphanUserKeySources.join("\n        UNION\n");

    const params: (string | number)[] = [
      tenantId, // revenue_usd CASE — financial_services fs subquery
      tenantId, // revenue_usd CASE — sales s2 subquery (saleRevenueUsdCaseBranch: s2.tenant_id)
    ];
    if (hasNetSaleCols) {
      params.push(tenantId); // revenue_usd CASE — sales s2 subquery (saleRevenueUsdCaseBranch net variant: si2.tenant_id)
    }
    params.push(
      tenantId, // revenue_lbp CASE — financial_services fs subquery (PA-1.2/1.7)
    );
    params.push(
      tenantId, // profit_usd CASE — sales s2 subquery
      tenantId, // profit_usd CASE — financial_services fs subquery (fsStampRecognized branch; LCC-X5 moved PM fee out — see below)
      tenantId, // profit_usd — LCC-X5 standalone PM-fee SUM's fs.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // profit_usd — reattributedSettlementCommission dateRange(sca.created_at)
        tenantId, // profit_usd — reattributedSettlementCommission sca.tenant_id
        tenantId, // profit_usd — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // profit_usd — keptChangeProfitForKey dateRange(kc.created_at)
      tenantId, // profit_usd — keptChangeProfitForKey kc.tenant_id
    );
    if (hasExchangeTable) {
      params.push(
        fromDt,
        toDt, // profit_usd — exchangeProfitForUser (LCC-V3) dateRange(ext.created_at)
        tenantId, // profit_usd — exchangeProfitForUser ext.tenant_id
        tenantId, // profit_usd — exchangeProfitForUser et.tenant_id
      );
    }
    params.push(
      tenantId, // profit_lbp CASE — financial_services fs subquery (fsStampRecognized branch)
      tenantId, // profit_lbp CASE — sales s2 subquery
      tenantId, // profit_lbp — LCC-X5 standalone PM-fee SUM's fs.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // profit_lbp — reattributedSettlementCommission dateRange(sca.created_at)
        tenantId, // profit_lbp — reattributedSettlementCommission sca.tenant_id
        tenantId, // profit_lbp — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // profit_lbp — keptChangeProfitForKey dateRange(kc.created_at)
      tenantId, // profit_lbp — keptChangeProfitForKey kc.tenant_id
      tenantId, // recognized_transaction_count — financial_services fs subquery
    );
    params.push(
      fromDt,
      toDt, // recognized_transaction_count — LCC-X4 keptChangeRecognizedCount dateRange
      tenantId, // recognized_transaction_count — keptChangeRecognizedCount kc.tenant_id
    );
    if (hasExchangeTable) {
      params.push(
        fromDt,
        toDt, // recognized_transaction_count — LCC-X4 exchangeRecognizedCount dateRange
        tenantId, // exchangeRecognizedCount ext.tenant_id
        tenantId, // exchangeRecognizedCount et.tenant_id
      );
    }
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // recognized_transaction_count — LCC-X4 reattributedSettlementRecognizedCount dateRange
        tenantId, // reattributedSettlementRecognizedCount sca.tenant_id
        tenantId, // reattributedSettlementRecognizedCount ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // pending_profit_usd — dateRange(fs2.created_at)
      tenantId, // pending_profit_usd — fs2.tenant_id
      tenantId, // pending_profit_usd — t2.tenant_id
      fromDt,
      toDt, // pending_profit_lbp — dateRange(fs2.created_at)
      tenantId, // pending_profit_lbp — fs2.tenant_id
      tenantId, // pending_profit_lbp — t2.tenant_id
      tenantId, // LEFT JOIN transactions orig
      tenantId, // LEFT JOIN users u
      fromDt,
      toDt, // WHERE dateRange(COALESCE(orig.created_at, t.created_at)) — PA-2.11
      tenantId, // WHERE t.tenant_id
    );

    // ---- LCC-V2 orphan-row branch's own params, in the SAME order its SQL
    // text below reads them.
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan profit_usd — reattributedSettlementCommission dateRange
        tenantId, // orphan profit_usd — reattributedSettlementCommission sca.tenant_id
        tenantId, // orphan profit_usd — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // orphan profit_usd — keptChangeProfitForKey dateRange
      tenantId, // orphan profit_usd — keptChangeProfitForKey kc.tenant_id
    );
    if (hasExchangeTable) {
      params.push(
        fromDt,
        toDt, // orphan profit_usd — exchangeProfitForUser dateRange
        tenantId, // orphan profit_usd — exchangeProfitForUser ext.tenant_id
        tenantId, // orphan profit_usd — exchangeProfitForUser et.tenant_id
      );
    }
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan profit_lbp — reattributedSettlementCommission dateRange
        tenantId, // orphan profit_lbp — reattributedSettlementCommission sca.tenant_id
        tenantId, // orphan profit_lbp — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // orphan profit_lbp — keptChangeProfitForKey dateRange
      tenantId, // orphan profit_lbp — keptChangeProfitForKey kc.tenant_id
    );
    // LCC-X4: orphan recognized_transaction_count — the SAME 3 COUNT twins
    // as the main branch's own, keyed off the orphan match conditions.
    params.push(
      fromDt,
      toDt, // orphan recognized_transaction_count — keptChangeRecognizedCount dateRange
      tenantId, // keptChangeRecognizedCount kc.tenant_id
    );
    if (hasExchangeTable) {
      params.push(
        fromDt,
        toDt, // orphan recognized_transaction_count — exchangeRecognizedCount dateRange
        tenantId, // exchangeRecognizedCount ext.tenant_id
        tenantId, // exchangeRecognizedCount et.tenant_id
      );
    }
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan recognized_transaction_count — reattributedSettlementRecognizedCount dateRange
        tenantId, // reattributedSettlementRecognizedCount sca.tenant_id
        tenantId, // reattributedSettlementRecognizedCount ft.tenant_id
      );
    }
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan key union — allocation-originator dateRange(sca2.created_at)
        tenantId, // orphan key union — sca2.tenant_id
        tenantId, // orphan key union — ft2.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // orphan key union — kept-change dateRange(kc2.created_at)
      tenantId, // orphan key union — kc2.tenant_id
    );
    if (hasExchangeTable) {
      params.push(
        fromDt,
        toDt, // orphan key union — exchange dateRange(ext2.created_at)
        tenantId, // orphan key union — ext2.tenant_id
        tenantId, // orphan key union — et2.tenant_id
      );
    }
    params.push(
      tenantId, // orphan LEFT JOIN users u2
      tenantId, // orphan NOT EXISTS LEFT JOIN transactions orig3
      fromDt,
      toDt, // orphan NOT EXISTS dateRange(COALESCE(orig3.created_at, t3.created_at))
      tenantId, // orphan NOT EXISTS t3.tenant_id
    );

    return this.db
      .prepare(
        `SELECT * FROM (
        SELECT
          -- A REFUND is attributed to the ORIGINAL seller (orig.user_id via
          -- reverses_id), not whoever clicked refund — so the seller's profit
          -- for a reversed sale nets to 0 and the refunder is unaffected.
          COALESCE(orig.user_id, t.user_id) AS user_id,
          COALESCE(u.username, 'Unknown') AS username,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): client debt stays a binary gate
            -- (DBT-1 stands, untouched). Partner coverage is no longer
            -- gated here — the SALE/SUPPLIER_SETTLEMENT branches below carry
            -- their own ratio internally (Lane A); every other branch is
            -- scaled directly by txnPartnerCoverageRatio(t) — see this
            -- method's own doc comment for the full rationale.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              -- Original FINANCIAL_SERVICE and its REFUND both gated by
              -- is_settled; the REFUND negates so a settled FS refund nets to 0
              -- and an UNSETTLED FS refund contributes 0 (was: refund fell to
              -- the ungated ELSE and drove per-user/client revenue negative).
              -- Scaled by txnPartnerCoverageRatio(t): this branch has no
              -- partner check of its own, unlike the SALE branch below.
              -- PA-0.1: gated by fsStampRecognized, not a bare is_settled
              -- check — a model-1 row's stamp is recognised from creation.
              -- L0-1 (Round 2): a void's reversal row (isVoidReversalRow)
              -- must contribute 0 here — it is NOT a REFUND (whose own
              -- t.type = 'REFUND' check below already negates), but
              -- re-deriving fsRevenue(fs) from the SAME unchanged fs row a
              -- second time for the reversal would otherwise double the
              -- voided principal into revenue (see isVoidReversalRow's doc
              -- comment and this file's own guard test).
              -- PA-1.2/LCC-X3: additionally gated on the shared strict USD
              -- bucket (usdBucketPredicate(fs.currency, true), rule 14) — an
              -- LBP-denominated transfer belongs in revenue_lbp, not here,
              -- and a non-USD/non-LBP currency (e.g. EUR) is now dropped
              -- instead of lumped into USD.
              SELECT CASE
                WHEN ${isVoidReversalRow("t")} THEN 0
                WHEN ${usdBucketPredicate("fs.currency", true)} AND ${fsStampRecognized("fs", this._hasCommissionModelColumn())}
                  THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0) * ${txnPartnerCoverageRatio("t")}
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3 (2026-09-05): weighted by saleRecognitionWeight instead
              -- of gated by the old binary salePaidOrPartnerSettled — see this
              -- method's own doc comment for the full rationale. REV lane
              -- (2026-09-24, PA-4.23 a parity): also net of discount and
              -- refunded quantity now — the SALE row carries the sale's
              -- ENTIRE net figure, the REFUND row 0 — see
              -- saleRevenueUsdCaseBranch's own doc comment.
              ${saleRevenueUsdCaseBranchSql}
            )
            -- LCC-V4 (Round 2): a SUPPLIER_SETTLEMENT/REFUND row contributes
            -- 0 revenue — its amount_usd/amount_lbp is the NET amount
            -- settled with the supplier (SupplierRepository's own "net $X"
            -- summary), not this cashier's takings; without this branch it
            -- fell to the generic ELSE and inflated Revenue by every supplier
            -- payout. Its profit contribution is unaffected — that lives in
            -- the profit_usd/profit_lbp CASE below, untouched by this fix.
            WHEN t.source_table = 'supplier_ledger' THEN 0
            ELSE t.amount_usd * ${txnPartnerCoverageRatio("t")}
          END) AS revenue_usd,
          -- PA-1.2/PA-1.7: revenue_lbp rebuilt as revenue_usd's structural
          -- mirror (was: flat, ungated SUM(t.amount_lbp), never displayed) —
          -- see this method's own doc comment for the full rationale.
          SUM(CASE
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE
                WHEN ${isVoidReversalRow("t")} THEN 0
                WHEN fs.currency = 'LBP' AND ${fsStampRecognized("fs", this._hasCommissionModelColumn())}
                  THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0) * ${txnPartnerCoverageRatio("t")}
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            -- sales carry no final_amount_lbp — sale revenue is always USD.
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN 0
            -- LCC-V4: see the revenue_usd CASE above — identical branch.
            WHEN t.source_table = 'supplier_ledger' THEN 0
            ELSE t.amount_lbp * ${txnPartnerCoverageRatio("t")}
          END) AS revenue_lbp,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see the revenue_usd CASE above.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: a SUPPLIER_SETTLEMENT/REFUND row is classified bills-only
            -- (stamp, unchanged) vs cashless (0 here as of PA-2.5 — see
            -- supplierSettlementProfitArm's own doc comment; re-attributed
            -- below via reattributedSettlementCommission instead).
            -- Never partner-pending for the settlement row itself (no
            -- partner_ledger row is ever keyed to 'supplier_ledger' — see
            -- PROFIT_TXN_TYPES's SUPPLIER_SETTLEMENT doc comment); the
            -- underlying fs row's OWN coverage is Lane A's concern inside
            -- supplierSettlementProfitArm, not this call site's.
            ${supplierSettlementProfitArm(hasAllocations, "usd")}
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3: see the revenue_usd CASE above.
              SELECT t.profit_usd * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            WHEN t.source_table = 'financial_services' THEN (
              -- FS + its REFUND both gated by is_settled (t.profit_usd already
              -- carries the sign: +commission on the original, -commission on
              -- the refund). Fixes: refunding an UNSETTLED commission used to
              -- fall to the ungated ELSE and post a phantom -commission here.
              -- Scaled by txnPartnerCoverageRatio(t) — see revenue_usd above.
              -- PA-0.1: gated by fsStampRecognized — see getByUser's
              -- revenue_usd CASE. LCC-X5: the payment-method fee moved OUT of
              -- this branch — a debt-pending transfer's fee must still count
              -- (the OUTER WHEN NOT notDebtPending above would otherwise zero
              -- it out too) — see the standalone SUM addend below instead.
              SELECT
                CASE WHEN ${fsStampRecognized("fs", this._hasCommissionModelColumn())} THEN t.profit_usd * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE t.profit_usd * ${txnPartnerCoverageRatio("t")}
          END)
            -- LCC-X5 (Round 3, PA-2.6) — payment-method fee, UNCONDITIONAL on
            -- debt-pending status: real money kept at the counter the instant
            -- it's charged, matching pmFeeRecognized's own doc comment ("real
            -- money kept at the counter... regardless of whether the
            -- underlying transfer's OWN stamp has settled") and the
            -- Overview's own getPmFeeByCurrency, which applies no
            -- notDebtPending gate either. Was previously nested INSIDE the
            -- notDebtPending-gated FS branch above, so a debt-pending
            -- transfer's fee was silently dropped.
            + SUM(CASE WHEN t.source_table = 'financial_services' THEN (
                SELECT ${pmFeeRecognized("fs", "usd")}
                FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
              ) ELSE 0 END)
            -- PA-2.5: cashless settlement commission, re-attributed to each
            -- allocation's own originating FS transaction's user.
            + ${reattributedSettlementCommission(userReattMatchMain, "usd", hasAllocations)}
            -- PA-2.6: kept change on DEBT_REPAYMENT/KEPT_CHANGE rows.
            + ${keptChangeProfitForKey(userKeptMatchMain, "usd")}
            -- LCC-V3 (Round 2): exchange profit — see this method's own doc
            -- comment for why the by-CASHIER attribution is valid (unlike
            -- by-CLIENT, which stays excluded).
            + ${exchangeProfitForUser(USER_KEY, hasExchangeTable)}
          AS profit_usd,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see the revenue_usd CASE above.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: see the profit_usd arm above — identical branch, LBP currency.
            ${supplierSettlementProfitArm(hasAllocations, "lbp")}
            WHEN t.source_table = 'financial_services' THEN (
              -- PA-0.1: gated by fsStampRecognized — see getByUser's
              -- revenue_usd CASE. LCC-X5: PM fee moved to its own standalone
              -- addend below — see the profit_usd arm's identical comment.
              SELECT
                CASE WHEN ${fsStampRecognized("fs", this._hasCommissionModelColumn())} THEN t.profit_lbp * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3: see the revenue_usd CASE above.
              SELECT t.profit_lbp * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.profit_lbp * ${txnPartnerCoverageRatio("t")}
          END)
            -- LCC-X5: LBP side of the same standalone, unconditional PM-fee
            -- addend — see the profit_usd arm's own comment above.
            + SUM(CASE WHEN t.source_table = 'financial_services' THEN (
                SELECT ${pmFeeRecognized("fs", "lbp")}
                FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
              ) ELSE 0 END)
            + ${reattributedSettlementCommission(userReattMatchMain, "lbp", hasAllocations)}
            + ${keptChangeProfitForKey(userKeptMatchMain, "lbp")}
          AS profit_lbp,
          COUNT(*) AS transaction_count,
          -- PA-4.19 ("Avg Profit/Txn" half): excludes REFUND/SUPPLIER_SETTLEMENT
          -- rows and an unrecognized FS row — see this method's own doc
          -- comment for the full rationale.
          -- LCC-V6 (Round 2, MINOR, left as-is — owner decision needed): the
          -- review also flagged that a SALE later fully refunded still
          -- counts 1 here (its own row is not type REFUND, so the exclusion
          -- above doesn't catch it), diluting the average toward 0 for a
          -- net-zero event. The review's own fix text marks this
          -- "Optionally exclude… (notReversedByRefund)" — NOT implemented
          -- here because it would change this file's own pre-existing
          -- PA-4.19 test's asserted denominator (a refunded RECHARGE
          -- currently counts 1 there, deliberately) without an owner
          -- ruling on which behavior is correct; flagged in the batch
          -- report instead of guessed at.
          SUM(CASE
            WHEN t.type IN ('REFUND', 'SUPPLIER_SETTLEMENT') THEN 0
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE WHEN ${fsStampRecognized("fs", this._hasCommissionModelColumn())} THEN 1 ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE 1
          END)
            -- LCC-X4 (Round 3, PA-4.19) — the denominator must grow by
            -- exactly the SAME extra sources the numerator (profit_usd/
            -- profit_lbp above) already includes via reattributedSettlement
            -- Commission/keptChangeProfitForKey/exchangeProfitForUser, or
            -- "Avg Profit/Txn" is inflated for any cashier whose profit comes
            -- partly from one of these (measured: 1 sale + 50 exchanges read
            -- as a $252 average instead of ≈$5). Each COUNT twin uses the
            -- SAME match condition/gates as its SUM counterpart above.
            + ${keptChangeRecognizedCount(userKeptMatchMain)}
            + ${exchangeRecognizedCount(USER_KEY, hasExchangeTable)}
            + ${reattributedSettlementRecognizedCount(userReattMatchMain, hasAllocations)}
          AS recognized_transaction_count,
          -- LIRA-158 (Phase 2a): embeddedCommission restricts this pending
          -- figure to LEGACY (commission_model = 0) rows — see
          -- getPendingCommissionTotals's doc comment for the rationale.
          -- PA-1.3/LCC-X3: split by the shared strict USD bucket
          -- (usdBucketPredicate(fs2.currency, true)) — was a single ungated
          -- SUM rendered with a hard-coded $ regardless of currency, then
          -- (Round 2) a not-equal-LBP bucket that still lumped EUR into USD.
          -- LCC-M2 (round 4, rule 14): both currencies now share ONE
          -- extracted fragment (pendingLegacyCommissionForKey) instead of
          -- four hand-pasted copies across getByUser/getByClient — see its
          -- own doc comment for the full gate set and bind-param contract.
          ${pendingLegacyCommissionForKey(
            "t2.user_id = COALESCE(orig.user_id, t.user_id)",
            "usd",
            this._hasCommissionModelColumn(),
          )} AS pending_profit_usd,
          ${pendingLegacyCommissionForKey(
            "t2.user_id = COALESCE(orig.user_id, t.user_id)",
            "lbp",
            this._hasCommissionModelColumn(),
          )} AS pending_profit_lbp
        FROM transactions t
        ${refundOriginalJoin("t", "orig")}
        LEFT JOIN users u ON u.id = COALESCE(orig.user_id, t.user_id) AND u.tenant_id = ?
        -- LCC-X1/X2/X7 (Round 3): profitTxnRowMembership already applies
        -- refundOriginalIsProfitEvent — a REFUND whose ORIGINAL is NOT itself
        -- a "real module" PROFIT_TXN_TYPES row (kept-change DEBT_REPAYMENT/
        -- KEPT_CHANGE, or EXCHANGE) is excluded here, since it already nets
        -- to zero through keptChangeProfitForKey/exchangeProfitForUser above
        -- and admitting it here would double-count it — and dates a REFUND
        -- by its ORIGINAL transaction's created_at (PA-2.11), matching the
        -- Overview's own period attribution. See either fragment's own doc
        -- comment for the full mechanism and the measured probe.
        WHERE ${profitTxnRowMembership("t", "orig")}
        GROUP BY COALESCE(orig.user_id, t.user_id)

        UNION ALL

        -- LCC-V2 (Round 2) — "orphan" rows: a user with money to report from
        -- reattribution/kept-change/exchange but NO row in the main SELECT
        -- above (no PROFIT_TXN_TYPES activity of their own in the window).
        SELECT
          k.user_id AS user_id,
          COALESCE(u2.username, 'Unknown') AS username,
          0 AS revenue_usd,
          0 AS revenue_lbp,
          ${reattributedSettlementCommission(userReattMatchOrphan, "usd", hasAllocations)}
            + ${keptChangeProfitForKey(userKeptMatchOrphan, "usd")}
            + ${exchangeProfitForUser("k.user_id", hasExchangeTable)}
          AS profit_usd,
          ${reattributedSettlementCommission(userReattMatchOrphan, "lbp", hasAllocations)}
            + ${keptChangeProfitForKey(userKeptMatchOrphan, "lbp")}
          AS profit_lbp,
          0 AS transaction_count,
          -- LCC-X4 (Round 3): an orphan row's profit_usd/profit_lbp are
          -- ENTIRELY these three sources, so its denominator must be too —
          -- was hard-coded 0, which just hid the average behind "—" instead
          -- of inflating it, but is still the same missing-denominator bug.
          ${keptChangeRecognizedCount(userKeptMatchOrphan)}
            + ${exchangeRecognizedCount("k.user_id", hasExchangeTable)}
            + ${reattributedSettlementRecognizedCount(userReattMatchOrphan, hasAllocations)}
          AS recognized_transaction_count,
          0 AS pending_profit_usd,
          0 AS pending_profit_lbp
        FROM (
          ${orphanUserKeysSql}
        ) k
        LEFT JOIN users u2 ON u2.id = k.user_id AND u2.tenant_id = ?
        WHERE NOT EXISTS (
          -- The SAME row-membership test (profitTxnRowMembership, rule 14 —
          -- shared with the main SELECT's own WHERE above, not re-derived)
          -- — a key already surfaced by the main branch must NOT also get an
          -- orphan row, or its reattribution/kept-change money would be
          -- added a second time. Applying the SAME refundOriginalIsProfitEvent
          -- restriction here matters too: otherwise a user whose ONLY row
          -- was an excluded REFUND (kept-change/exchange original) would
          -- wrongly look "already covered" and lose its orphan row too.
          SELECT 1 FROM transactions t3
          ${refundOriginalJoin("t3", "orig3")}
          WHERE ${profitTxnRowMembership("t3", "orig3")}
            AND COALESCE(orig3.user_id, t3.user_id) IS k.user_id
        )
      ) ORDER BY profit_usd DESC`,
      )
      .all(...params) as ProfitByUserRow[];
  }

  // ---------------------------------------------------------------------------
  // By client (getByClient)
  // ---------------------------------------------------------------------------

  /**
   * Top clients by realized profit (same realized gates as getByUser).
   *
   * PROPORTIONAL CONVERSION (2026-09-05, PARTNER_PROPORTIONAL_RECOGNITION.md
   * Step 2) — identical conversion to {@link getByUser}'s own doc comment:
   * client debt (DBT-1) stays binary, partner coverage (PFT-6) becomes
   * continuous via `txnPartnerCoverageRatio(t)` for every branch that has no
   * partner-awareness of its own. The SUPPLIER_SETTLEMENT branch carries its
   * own ratio internally (Lane A) with no call-site change needed. The SALE
   * branch (Task 3, 2026-09-05) is now weighted by `saleRecognitionWeight`
   * the same way `getByUser`'s own SALE branch is — see that method's doc
   * comment for the full rationale, not repeated here (rule 14: one
   * explanation, not two copies drifting apart).
   *
   * PA-0.1 (OWNER_NOTES_2026-09-21.md §6.2) — the three `financial_services`
   * CASE arms are gated by {@link fsStampRecognized}, identical conversion
   * to `getByUser`'s own — see that method's doc comment for the full
   * rationale, not repeated here (rule 14).
   *
   * L0-1 (Round 2, same section) — the `revenue_usd` arm's `financial_services`
   * branch is also gated by {@link isVoidReversalRow}, identical to
   * `getByUser`'s own — see that method's doc comment for the full
   * rationale, not repeated here (rule 14).
   *
   * PA-1.2 / PA-1.7 (OWNER_NOTES_2026-09-21.md §6.3) — identical fix to
   * `getByUser`'s own: `revenue_usd`'s `financial_services` branch gates on
   * the shared strict USD bucket (`usdBucketPredicate(fs.currency, true)`,
   * LCC-X3 Round 3 — an EARLIER version of this fix used `fs.currency !=
   * 'LBP'`, which lumped EUR into USD too; see {@link usdBucketPredicate}'s
   * own doc comment), and `revenue_lbp` is rebuilt as `revenue_usd`'s exact
   * structural mirror (was: a flat, ungated `SUM(t.amount_lbp)`, never
   * rendered by the UI) instead of a second hand-copied text — see
   * `getByUser`'s own doc comment for the full rationale.
   *
   * PA-1.3 (OWNER_NOTES_2026-09-21.md §6.3) — `pending_profit_usd`'s
   * `SUM(fs2.commission)` had no currency filter; split into
   * `pending_profit_usd` (the same strict `usdBucketPredicate(fs2.currency,
   * true)`, LCC-X3) and `pending_profit_lbp` (`fs2.currency = 'LBP'`), same
   * USD-bucket convention as PA-1.2 and identical shape to `getByUser`'s own
   * split.
   *
   * PA-2.5 / PA-2.6 (OWNER_NOTES_2026-09-21.md §6.4) — a cashless
   * supplier-settlement commission is re-attributed to each allocation's own
   * originating FINANCIAL_SERVICE transaction's `client_id`
   * ({@link reattributedSettlementCommission}), payment-method fees are
   * added inline inside the existing FS-branch subquery via
   * {@link pmFeeRecognized} (gated by `notRefunded(fs)` only, matching
   * `getByDate`'s `daily_pmfee` CTE), and kept change on
   * DEBT_REPAYMENT/KEPT_CHANGE rows is added via
   * {@link keptChangeProfitForKey} — see `getByUser`'s own doc comment for
   * the shared mechanism, not repeated here. Exchange profit and
   * counterparty (debt/supplier/partner-ledger) discounts are DELIBERATELY
   * NOT added for the reason documented there: exchange rows carry no
   * `client_id`, and a discount's "who earned this" is genuinely three-way
   * ambiguous — the UI captions both as excluded.
   *
   * LCC-V1 (Round 2 adversarial review) — unlike `getByUser` (one NULL/
   * no-actor output group), `getByClient` has MANY distinct walk-in groups
   * (one per distinct name, plus the unnamed one), all sharing `client_id
   * IS NULL`. `reattributedSettlementCommission`/`keptChangeProfitForKey`
   * used to match walk-ins with a bare `ft.client_id IS t.client_id`
   * (NULL IS NULL, true for every walk-in row regardless of name), so ONE
   * client-less cashless allocation's commission landed on EVERY walk-in
   * group at once (measured: Σ $12 became $36 across three walk-in groups).
   * Both fragments now take a caller-built `matchCondition`: linked clients
   * match on `client_id`; walk-in groups match on the SAME name key the
   * `GROUP BY` below uses ({@link reattributedSettlementCommission}'s own
   * doc comment has the full LCC-V1 writeup).
   *
   * LCC-V2 (Round 2, PA-2.5/PA-2.6 "NOT CLOSED") — a client with NO
   * `PROFIT_TXN_TYPES` row in the window (the normal shape for By Client: a
   * transfer created on day N, settled on day N+k) got NO output row at all,
   * so the reattributed commission / kept change was silently lost — see
   * `getByUser`'s own doc comment for the full UNION-ALL "orphan row" fix,
   * identical mechanism here, keyed on `(client_id, client_name)` instead of
   * `user_id`.
   *
   * LCC-V8 (Round 2, MINOR) — `TransactionRepository.refundTransaction`
   * copies a REFUND row's `client_id` from the original but NOT its
   * `client_name`. A walk-in sale (`client_id` NULL, `client_name` 'Ali')
   * refunded in full therefore split into TWO walk-in groups — 'Ali' (the
   * original, +profit) and the unnamed one (the REFUND, −profit) — instead
   * of netting to zero in ONE group. The walk-in name key is now
   * `COALESCE(t.client_name, orig.client_name, '')` (the SAME `orig` LEFT
   * JOIN PA-2.11 already added for date attribution), so a REFUND row falls
   * back to its original's name and rejoins the SAME group.
   *
   * PA-2.11 (OWNER_NOTES_2026-09-21.md §6.4) — a REFUND row used to be dated
   * by ITS OWN `created_at`; the WHERE clause now dates by
   * `COALESCE(orig.created_at, t.created_at)` via {@link refundOriginalJoin},
   * matching the Overview's own period attribution (`getSalesProfit`'s doc
   * comment) and `getByUser`'s identical fix. No equivalent change to CLIENT
   * attribution is needed here — unlike a REFUND row's `user_id` (always the
   * refunder), its `client_id` is copied straight from the original
   * transaction at refund-insert time, for BOTH refund shapes this join now
   * resolves: a whole-sale/module REFUND via `TransactionRepository
   * .refundTransaction`, and a `refundSaleItem` item REFUND, which stamps
   * `client_id: originalTxn.client_id` itself (`SalesRepository
   * .refundSaleItem`) — so `t.client_id` already names the right client
   * without an `orig` fallback, in either case.
   *
   * PA-3.9 (OWNER_NOTES_2026-09-21.md §6.5, hypothesis confirmed) — this
   * method used to GROUP BY `t.client_id, COALESCE(t.client_name,
   * c.full_name), COALESCE(t.client_phone, c.phone_number)`: a linked client
   * (`client_id` set) whose name snapshot on `transactions` drifted from a
   * rename split into multiple output rows, each carrying only a fraction of
   * that client's activity — while the `pending_profit_*` correlated
   * subqueries below match on `client_id` ALONE for exactly this reason
   * (`(t.client_id IS NOT NULL AND t2.client_id = t.client_id) OR ...`), so
   * the full pending total was duplicated onto every split row instead of
   * being divided. Fixed by grouping a linked client purely by `client_id`
   * (a walk-in/name-only row, `client_id IS NULL`, still groups by name — it
   * has no other stable key) via two mutually-exclusive `CASE` expressions,
   * and reading the DISPLAY name/phone from the canonical, rename-proof
   * source for a linked client (`c.full_name`/`c.phone_number`, constant
   * across every row in that group since they all share one `client_id`)
   * instead of an arbitrary snapshot — `MAX(t.client_name)`/
   * `MAX(t.client_phone)` remains the fallback for the walk-in case, where
   * every row in the group already shares the identical name by construction
   * of the grouping key itself.
   *
   * PA-4.19 (OWNER_NOTES_2026-09-21.md §6.6, "Avg Profit/Txn" half — the
   * By-Client tab has no such column today, but the underlying count is
   * shared plumbing) — `recognized_transaction_count` added as the SAME
   * REFUND/SUPPLIER_SETTLEMENT/unrecognized-FS-excluding count as
   * `getByUser`'s own (see that method's doc comment); kept in lockstep so a
   * future column has the correct denominator ready. `transaction_count`
   * itself is UNCHANGED.
   *
   * PARAM-COUNT INVARIANT (LCC-X8, Round 3 doc correction — this paragraph
   * previously narrated a transient session history instead of describing
   * the code): {@link supplierSettlementProfitArm} embeds ZERO `?`
   * placeholders in either branch, so the `params` array below pushes no
   * bind value for it — a future edit to that arm that adds a `?` must add a
   * matching push here too, or `better-sqlite3` throws a bind-arity
   * `RangeError` (`.all(...params)` receiving too few/many values) rather
   * than a wrong-but-silent number. The LCC-V1/LCC-V2/LCC-V8/LCC-X1..X6
   * fixes above are each proven by their own item-level failing-first test
   * (see the Round-2/Round-3 test files for each item's specific RED run).
   */
  getByClient(
    fromDt: string,
    toDt: string,
    limit: number,
  ): ProfitByClientRow[] {
    const tenantId = getCurrentTenantId();
    const hasAllocations = this._hasSettlementAllocationsTable();
    // REV lane (2026-09-24, PA-4.23 a parity) — see
    // saleRevenueUsdCaseBranch's own doc comment.
    const hasNetSaleCols = this._hasSaleDiscountAndRefundQuantityColumns();
    const saleRevenueUsdCaseBranchSql = saleRevenueUsdCaseBranch(hasNetSaleCols);

    // LCC-V8 (Round 2): the walk-in group's NAME key falls back to the
    // ORIGINAL transaction's client_name via `orig` (already joined for
    // PA-2.11) — a REFUND row never carries its own client_name
    // (`TransactionRepository.refundTransaction` copies `client_id` only),
    // so without this fallback a refunded walk-in sale split into two
    // groups instead of netting to zero in one.
    const CLIENT_NAME_KEY = "COALESCE(t.client_name, orig.client_name, '')";
    // LCC-V1 (Round 2): getByClient has MANY walk-in groups (one per
    // distinct name, plus the unnamed one), all sharing `client_id IS
    // NULL` — a bare `ft.client_id IS t.client_id` (NULL IS NULL) matched
    // ALL of them at once. A linked client matches on `client_id`; a
    // walk-in group matches on the SAME name key the GROUP BY below uses —
    // see reattributedSettlementCommission's own doc comment for the full
    // writeup.
    // Round-2 fix-of-a-fix: the walk-in (second) branch MUST also require
    // the SOURCE row (ft/kc) itself has a NULL client_id — otherwise a
    // LINKED client's source row (ft.client_id = 5, ft.client_name left
    // NULL, the normal shape) satisfies `COALESCE(ft.client_name,'') = ''`
    // against ANY unnamed walk-in output group, reattributing that client's
    // money to "Walk-in" too (measured while proving this file's own
    // LCC-V1 guard test: a linked client's $12 leaked onto the walk-in row
    // as well, Σ $12 became Σ $24 before this extra guard).
    const clientReattMatchMain = `((t.client_id IS NOT NULL AND ft.client_id = t.client_id) OR (t.client_id IS NULL AND ft.client_id IS NULL AND COALESCE(ft.client_name, '') = ${CLIENT_NAME_KEY}))`;
    // LCC-walkin-keptchange-name (open_LCC.txt LCC:verify:r1, round-1
    // follow-up) — the review's MINOR hypothesis was "a walk-in KEPT_CHANGE
    // row's REFUND doesn't carry `client_name`, so it falls out of its named
    // group". Investigated tonight by reading source, NOT by a live run
    // (NO-EXECUTION tonight); this is a static/schema fact, not a runtime
    // behaviour, so it does not need a test run to settle: the scenario is
    // UNREACHABLE, for two independent reasons, so `kc.client_name` below is
    // deliberately NOT given a `reverses_id` fallback (unlike
    // {@link keptChangeAttributedUserId}'s `user_id` one) — that would be
    // dead code.
    //  (a) The only {@link keptChangeSource} branch that can EVER be a
    //      walk-in (`client_id` NULL) is the `type = 'KEPT_CHANGE'` one —
    //      `SessionCheckoutService.checkout()`'s `resolveSessionClientForCheckout`
    //      returns `undefined` for a named walk-in with no phone and no
    //      existing client match. But `KEPT_CHANGE` is a member of
    //      `NON_REVERSIBLE_TRANSACTION_TYPES` (transactionTypes.ts), and
    //      `TransactionRepository`'s generic void/refund path throws before
    //      creating a REFUND of any type in that set — so a KEPT_CHANGE
    //      original's REFUND never exists to mismatch.
    //  (b) The only {@link keptChangeSource} branch that CAN be refunded
    //      (`source_table = 'debt_ledger'`, `type IN ('DEBT_REPAYMENT',
    //      'REFUND')`) always has a real `client_id` — `debt_ledger.client_id`
    //      is `NOT NULL` (electron-app/create_db.sql, and every fixture in
    //      this file's own test suite) — a debt is always extended to a
    //      registered client, never a walk-in. It always matches via the
    //      `client_id IS NOT NULL` branch below regardless of `client_name`.
    //
    // A DIFFERENT, real bug was found in the same investigation: a named
    // walk-in's KEPT_CHANGE row is ALREADY always unnamed on ITS OWN
    // creation, no refund involved — `SessionCheckoutService.checkout()`'s
    // `KEPT_CHANGE` `createTransaction` call passes `client_id` but never
    // `client_name`, unlike every other item type in the same basket
    // (which gets `sessionCustomerName` injected into its own `formData`
    // first). That is a write-path gap in `SessionCheckoutService.ts` — not
    // in this lane's ownership tonight (reporting-only; that file is not in
    // this round's owned-files list) and not fixable from this SQL layer
    // (there is no sibling row here to fall back to, only a name that was
    // never written). Flagged for the owner / the session-checkout lane,
    // not fixed here.
    const clientKeptMatchMain = `((t.client_id IS NOT NULL AND kc.client_id = t.client_id) OR (t.client_id IS NULL AND kc.client_id IS NULL AND COALESCE(kc.client_name, '') = ${CLIENT_NAME_KEY}))`;
    // LCC-V2: the orphan-row branch below has no `t`/`orig` in scope — it
    // matches against its own derived key table `k` instead.
    const clientReattMatchOrphan =
      "((k.client_id_key IS NOT NULL AND ft.client_id = k.client_id_key) OR (k.client_id_key IS NULL AND ft.client_id IS NULL AND COALESCE(ft.client_name, '') = k.client_name_key))";
    // See clientKeptMatchMain's own doc comment (LCC-walkin-keptchange-name)
    // for why this deliberately has no reverses_id name fallback either.
    const clientKeptMatchOrphan =
      "((k.client_id_key IS NOT NULL AND kc.client_id = k.client_id_key) OR (k.client_id_key IS NULL AND kc.client_id IS NULL AND COALESCE(kc.client_name, '') = k.client_name_key))";

    // LCC-V2 (Round 2, PA-2.5/PA-2.6 "NOT CLOSED") — two sources of "this
    // client has real money to report even though they have NO
    // PROFIT_TXN_TYPES row in the window" — see getByUser's own doc comment
    // for the full mechanism. No exchange source here (deliberately, per
    // this method's own doc comment — exchange rows carry no client_id).
    const orphanClientKeySources: string[] = [];
    if (hasAllocations) {
      orphanClientKeySources.push(`SELECT DISTINCT
          CASE WHEN ft2.client_id IS NOT NULL THEN ft2.client_id END AS client_id_key,
          CASE WHEN ft2.client_id IS NULL THEN COALESCE(ft2.client_name, '') END AS client_name_key
        FROM settlement_commission_allocations sca2
        JOIN financial_services fs2 ON ${currentSettlementAllocation("fs2", "sca2")}
        JOIN transactions ft2 ON ft2.source_table = 'financial_services'
          AND ft2.source_id = fs2.id AND ft2.type = 'FINANCIAL_SERVICE'
        WHERE ${allocationRecognitionGates("sca2", "fs2", "ft2")}`);
    }
    orphanClientKeySources.push(`SELECT DISTINCT
          CASE WHEN kc2.client_id IS NOT NULL THEN kc2.client_id END AS client_id_key,
          CASE WHEN kc2.client_id IS NULL THEN COALESCE(kc2.client_name, '') END AS client_name_key
        FROM transactions kc2
        WHERE ${keptChangeRecognitionGates("kc2")}`);
    const orphanClientKeysSql = orphanClientKeySources.join(
      "\n        UNION\n",
    );

    const params: (string | number)[] = [
      tenantId, // revenue_usd CASE — financial_services fs subquery
      tenantId, // revenue_usd CASE — sales s2 subquery (saleRevenueUsdCaseBranch: s2.tenant_id)
    ];
    if (hasNetSaleCols) {
      params.push(tenantId); // revenue_usd CASE — sales s2 subquery (saleRevenueUsdCaseBranch net variant: si2.tenant_id)
    }
    params.push(
      tenantId, // revenue_lbp CASE — financial_services fs subquery (PA-1.2/1.7)
      tenantId, // profit_usd CASE — sales s2 subquery
      tenantId, // profit_usd CASE — financial_services fs subquery (fsStampRecognized branch; LCC-X5 moved PM fee out — see below)
      tenantId, // profit_usd — LCC-X5 standalone PM-fee SUM's fs.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // profit_usd — reattributedSettlementCommission dateRange(sca.created_at)
        tenantId, // profit_usd — reattributedSettlementCommission sca.tenant_id
        tenantId, // profit_usd — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // profit_usd — keptChangeProfitForKey dateRange(kc.created_at)
      tenantId, // profit_usd — keptChangeProfitForKey kc.tenant_id
    );
    params.push(
      tenantId, // profit_lbp CASE — financial_services fs subquery (fsStampRecognized branch)
      tenantId, // profit_lbp CASE — sales s2 subquery
      tenantId, // profit_lbp — LCC-X5 standalone PM-fee SUM's fs.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // profit_lbp — reattributedSettlementCommission dateRange(sca.created_at)
        tenantId, // profit_lbp — reattributedSettlementCommission sca.tenant_id
        tenantId, // profit_lbp — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // profit_lbp — keptChangeProfitForKey dateRange(kc.created_at)
      tenantId, // profit_lbp — keptChangeProfitForKey kc.tenant_id
      tenantId, // recognized_transaction_count — financial_services fs subquery
    );
    params.push(
      fromDt,
      toDt, // recognized_transaction_count — LCC-X4 keptChangeRecognizedCount dateRange
      tenantId, // recognized_transaction_count — keptChangeRecognizedCount kc.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // recognized_transaction_count — LCC-X4 reattributedSettlementRecognizedCount dateRange
        tenantId, // reattributedSettlementRecognizedCount sca.tenant_id
        tenantId, // reattributedSettlementRecognizedCount ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // pending_profit_usd — dateRange(fs2.created_at)
      tenantId, // pending_profit_usd — fs2.tenant_id
      tenantId, // pending_profit_usd — t2.tenant_id
      fromDt,
      toDt, // pending_profit_lbp — dateRange(fs2.created_at)
      tenantId, // pending_profit_lbp — fs2.tenant_id
      tenantId, // pending_profit_lbp — t2.tenant_id
      tenantId, // LEFT JOIN clients c
      tenantId, // LEFT JOIN transactions orig (PA-2.11)
      fromDt,
      toDt, // WHERE dateRange(COALESCE(orig.created_at, t.created_at)) — PA-2.11
      tenantId, // WHERE t.tenant_id
    );

    // ---- LCC-V2 orphan-row branch's own params, in the SAME order its SQL
    // text below reads them.
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan profit_usd — reattributedSettlementCommission dateRange
        tenantId, // orphan profit_usd — reattributedSettlementCommission sca.tenant_id
        tenantId, // orphan profit_usd — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // orphan profit_usd — keptChangeProfitForKey dateRange
      tenantId, // orphan profit_usd — keptChangeProfitForKey kc.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan profit_lbp — reattributedSettlementCommission dateRange
        tenantId, // orphan profit_lbp — reattributedSettlementCommission sca.tenant_id
        tenantId, // orphan profit_lbp — reattributedSettlementCommission ft.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // orphan profit_lbp — keptChangeProfitForKey dateRange
      tenantId, // orphan profit_lbp — keptChangeProfitForKey kc.tenant_id
    );
    // LCC-X4: orphan recognized_transaction_count — the SAME 2 COUNT twins
    // (no exchange source here — see this method's own doc comment) as the
    // main branch's own, keyed off the orphan match conditions.
    params.push(
      fromDt,
      toDt, // orphan recognized_transaction_count — keptChangeRecognizedCount dateRange
      tenantId, // keptChangeRecognizedCount kc.tenant_id
    );
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan recognized_transaction_count — reattributedSettlementRecognizedCount dateRange
        tenantId, // reattributedSettlementRecognizedCount sca.tenant_id
        tenantId, // reattributedSettlementRecognizedCount ft.tenant_id
      );
    }
    if (hasAllocations) {
      params.push(
        fromDt,
        toDt, // orphan key union — allocation-originator dateRange(sca2.created_at)
        tenantId, // orphan key union — sca2.tenant_id
        tenantId, // orphan key union — ft2.tenant_id
      );
    }
    params.push(
      fromDt,
      toDt, // orphan key union — kept-change dateRange(kc2.created_at)
      tenantId, // orphan key union — kc2.tenant_id
      tenantId, // orphan LEFT JOIN clients c2
      tenantId, // orphan NOT EXISTS LEFT JOIN transactions orig3
      fromDt,
      toDt, // orphan NOT EXISTS dateRange(COALESCE(orig3.created_at, t3.created_at))
      tenantId, // orphan NOT EXISTS t3.tenant_id
      limit,
    );

    return this.db
      .prepare(
        `SELECT * FROM (
        SELECT
          t.client_id,
          -- PA-3.9: a linked client's DISPLAY name/phone come from the
          -- canonical clients row (constant across the whole group), not an
          -- arbitrary per-transaction snapshot — see this method's own doc
          -- comment. LCC-V8: the walk-in fallback now also reads a REFUND
          -- row's ORIGINAL client_name via orig.
          COALESCE(c.full_name, MAX(COALESCE(t.client_name, orig.client_name)), 'Walk-in') AS client_name,
          COALESCE(c.phone_number, MAX(t.client_phone)) AS client_phone,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see getByUser's doc comment.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              -- Original FINANCIAL_SERVICE and its REFUND both gated by
              -- is_settled; the REFUND negates so a settled FS refund nets to 0
              -- and an UNSETTLED FS refund contributes 0 (was: refund fell to
              -- the ungated ELSE and drove per-user/client revenue negative).
              -- Scaled by txnPartnerCoverageRatio(t) — see getByUser.
              -- PA-0.1: gated by fsStampRecognized — see getByUser.
              -- L0-1 (Round 2): isVoidReversalRow gate — see getByUser's own
              -- revenue_usd CASE for the full rationale.
              -- PA-1.2/LCC-X3: gated on the shared strict USD bucket
              -- (usdBucketPredicate(fs.currency, true)) — an LBP-denominated
              -- transfer belongs in revenue_lbp, not here, and a non-USD/
              -- non-LBP currency is now dropped instead of lumped into USD.
              SELECT CASE
                WHEN ${isVoidReversalRow("t")} THEN 0
                WHEN ${usdBucketPredicate("fs.currency", true)} AND ${fsStampRecognized("fs", this._hasCommissionModelColumn())}
                  THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0) * ${txnPartnerCoverageRatio("t")}
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3 (2026-09-05): weighted by saleRecognitionWeight instead
              -- of gated by the old binary salePaidOrPartnerSettled — see
              -- getByUser's own doc comment for the full rationale. REV lane
              -- (2026-09-24, PA-4.23 a parity): also net of discount and
              -- refunded quantity now — see saleRevenueUsdCaseBranch's own
              -- doc comment (getByUser's identical revenue_usd branch above).
              ${saleRevenueUsdCaseBranchSql}
            )
            -- LCC-V4 (Round 2): see getByUser's identical revenue_usd branch.
            WHEN t.source_table = 'supplier_ledger' THEN 0
            ELSE t.amount_usd * ${txnPartnerCoverageRatio("t")}
          END) AS revenue_usd,
          -- PA-1.2/PA-1.7: revenue_lbp rebuilt as revenue_usd's exact
          -- structural mirror (was: flat, ungated SUM(t.amount_lbp), never
          -- displayed) — see this method's own doc comment.
          SUM(CASE
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE
                WHEN ${isVoidReversalRow("t")} THEN 0
                WHEN fs.currency = 'LBP' AND ${fsStampRecognized("fs", this._hasCommissionModelColumn())}
                  THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0) * ${txnPartnerCoverageRatio("t")}
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            -- sales carry no final_amount_lbp — sale revenue is always USD.
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN 0
            -- LCC-V4: see the revenue_usd CASE above — identical branch.
            WHEN t.source_table = 'supplier_ledger' THEN 0
            ELSE t.amount_lbp * ${txnPartnerCoverageRatio("t")}
          END) AS revenue_lbp,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see getByUser's doc comment.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: a SUPPLIER_SETTLEMENT/REFUND row is classified bills-only
            -- (stamp, unchanged) vs cashless (0 here as of PA-2.5 — see
            -- supplierSettlementProfitArm's own doc comment; re-attributed
            -- below via reattributedSettlementCommission instead).
            -- Never partner-pending for the settlement row itself; the
            -- underlying fs row's coverage is Lane A's concern internally.
            ${supplierSettlementProfitArm(hasAllocations, "usd")}
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3: see the revenue_usd CASE above.
              SELECT t.profit_usd * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            WHEN t.source_table = 'financial_services' THEN (
              -- FS + its REFUND both gated by is_settled (t.profit_usd already
              -- carries the sign: +commission on the original, -commission on
              -- the refund). Fixes: refunding an UNSETTLED commission used to
              -- fall to the ungated ELSE and post a phantom -commission here.
              -- Scaled by txnPartnerCoverageRatio(t) — see revenue_usd above.
              -- PA-0.1: gated by fsStampRecognized — see getByUser's
              -- revenue_usd CASE. LCC-X5: the payment-method fee moved OUT of
              -- this branch — a debt-pending transfer's fee must still count
              -- — see the standalone SUM addend below instead.
              SELECT
                CASE WHEN ${fsStampRecognized("fs", this._hasCommissionModelColumn())} THEN t.profit_usd * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE t.profit_usd * ${txnPartnerCoverageRatio("t")}
          END)
            -- LCC-X5 (Round 3, PA-2.6) — payment-method fee, UNCONDITIONAL on
            -- debt-pending status — see getByUser's identical addend's own
            -- doc comment for the full rationale.
            + SUM(CASE WHEN t.source_table = 'financial_services' THEN (
                SELECT ${pmFeeRecognized("fs", "usd")}
                FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
              ) ELSE 0 END)
            -- PA-2.5: cashless settlement commission, re-attributed to each
            -- allocation's own originating FS transaction's client.
            + ${reattributedSettlementCommission(clientReattMatchMain, "usd", hasAllocations)}
            -- PA-2.6: kept change on DEBT_REPAYMENT/KEPT_CHANGE rows.
            + ${keptChangeProfitForKey(clientKeptMatchMain, "usd")}
          AS profit_usd,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see getByUser's doc comment.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: see the profit_usd arm above — identical branch, LBP currency.
            ${supplierSettlementProfitArm(hasAllocations, "lbp")}
            WHEN t.source_table = 'financial_services' THEN (
              -- PA-0.1: gated by fsStampRecognized — see getByUser's
              -- revenue_usd CASE. LCC-X5: PM fee moved to its own standalone
              -- addend below — see the profit_usd arm's own comment above.
              SELECT
                CASE WHEN ${fsStampRecognized("fs", this._hasCommissionModelColumn())} THEN t.profit_lbp * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3: see the revenue_usd CASE above.
              SELECT t.profit_lbp * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.profit_lbp * ${txnPartnerCoverageRatio("t")}
          END)
            -- LCC-X5: LBP side of the same standalone, unconditional PM-fee
            -- addend — see the profit_usd arm's own comment above.
            + SUM(CASE WHEN t.source_table = 'financial_services' THEN (
                SELECT ${pmFeeRecognized("fs", "lbp")}
                FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
              ) ELSE 0 END)
            + ${reattributedSettlementCommission(clientReattMatchMain, "lbp", hasAllocations)}
            + ${keptChangeProfitForKey(clientKeptMatchMain, "lbp")}
          AS profit_lbp,
          COUNT(*) AS transaction_count,
          -- PA-4.19: see getByUser's own recognized_transaction_count column
          -- for the full rationale — identical shape here.
          SUM(CASE
            WHEN t.type IN ('REFUND', 'SUPPLIER_SETTLEMENT') THEN 0
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE WHEN ${fsStampRecognized("fs", this._hasCommissionModelColumn())} THEN 1 ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE 1
          END)
            -- LCC-X4 (Round 3, PA-4.19): the denominator must grow by the
            -- SAME extra sources the numerator above already includes — see
            -- getByUser's identical addend's own doc comment. No exchange
            -- term here (exchange rows carry no client_id — see this
            -- method's own doc comment).
            + ${keptChangeRecognizedCount(clientKeptMatchMain)}
            + ${reattributedSettlementRecognizedCount(clientReattMatchMain, hasAllocations)}
          AS recognized_transaction_count,
          -- LIRA-158 (Phase 2a): embeddedCommission restricts this pending
          -- figure to LEGACY (commission_model = 0) rows — see
          -- getPendingCommissionTotals's doc comment for the rationale.
          -- PA-1.3/LCC-X3: split by the shared strict USD bucket
          -- (usdBucketPredicate(fs2.currency, true)) — was a single ungated
          -- SUM rendered with a hard-coded $ regardless of currency, then
          -- (Round 2) a not-equal-LBP bucket that still lumped EUR into USD.
          -- LCC-X6 (Round 3, PA-3.9 symptom class): the walk-in branch of the
          -- WHERE now matches t2.client_id IS NULL AND
          -- COALESCE(t2.client_name,'') = CLIENT_NAME_KEY instead of a bare
          -- t2.client_name = t.client_name equality — three bugs fixed at
          -- once: (a) an unnamed walk-in group (empty string) never matched
          -- via plain equality (NULL/blank compares false), so it always
          -- read 0 pending; (b) a LINKED client's pending duplicated onto a
          -- same-named walk-in row because nothing required
          -- t2.client_id IS NULL; (c) it now reads CLIENT_NAME_KEY
          -- (COALESCE(t.client_name, orig.client_name, '')) instead of a
          -- bare t.client_name, which can be a REFUND row's own NULL after
          -- LCC-V8's orig fallback.
          -- LCC-M2 (round 4, rule 14): both currencies now share ONE
          -- extracted fragment (pendingLegacyCommissionForKey) instead of
          -- four hand-pasted copies across getByUser/getByClient — see its
          -- own doc comment for the full gate set and bind-param contract.
          ${pendingLegacyCommissionForKey(
            `(t.client_id IS NOT NULL AND t2.client_id = t.client_id)
              OR (t.client_id IS NULL AND t2.client_id IS NULL AND COALESCE(t2.client_name, '') = ${CLIENT_NAME_KEY})`,
            "usd",
            this._hasCommissionModelColumn(),
          )} AS pending_profit_usd,
          ${pendingLegacyCommissionForKey(
            `(t.client_id IS NOT NULL AND t2.client_id = t.client_id)
              OR (t.client_id IS NULL AND t2.client_id IS NULL AND COALESCE(t2.client_name, '') = ${CLIENT_NAME_KEY})`,
            "lbp",
            this._hasCommissionModelColumn(),
          )} AS pending_profit_lbp
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id AND c.tenant_id = ?
        ${refundOriginalJoin("t", "orig")}
        -- LCC-X1/X7 (Round 3): profitTxnRowMembership already applies
        -- refundOriginalIsProfitEvent — a REFUND whose ORIGINAL is a
        -- kept-change DEBT_REPAYMENT/KEPT_CHANGE row is excluded here, since
        -- it already nets to zero through keptChangeProfitForKey above and
        -- admitting it here would double-count it — and dates a REFUND by
        -- its ORIGINAL transaction's created_at (PA-2.11), matching the
        -- Overview's own period attribution. See either fragment's own doc
        -- comment (getByUser's identical fix) for the full mechanism.
        WHERE ${profitTxnRowMembership("t", "orig")}
        -- PA-3.9: group a linked client purely by client_id (rename-proof);
        -- a walk-in/name-only row (client_id IS NULL) still groups by name,
        -- its only stable key — see this method's own doc comment. LCC-V8:
        -- the walk-in name key now falls back to orig.client_name too.
        GROUP BY CASE WHEN t.client_id IS NOT NULL THEN t.client_id END,
                 CASE WHEN t.client_id IS NULL THEN ${CLIENT_NAME_KEY} END

        UNION ALL

        -- LCC-V2 (Round 2) — "orphan" rows: a client with money to report
        -- from reattribution/kept-change but NO row in the main SELECT
        -- above (no PROFIT_TXN_TYPES activity of their own in the window) —
        -- see getByUser's own doc comment for the full mechanism.
        SELECT
          k.client_id_key AS client_id,
          COALESCE(c2.full_name, k.client_name_key, 'Walk-in') AS client_name,
          c2.phone_number AS client_phone,
          0 AS revenue_usd,
          0 AS revenue_lbp,
          ${reattributedSettlementCommission(clientReattMatchOrphan, "usd", hasAllocations)}
            + ${keptChangeProfitForKey(clientKeptMatchOrphan, "usd")}
          AS profit_usd,
          ${reattributedSettlementCommission(clientReattMatchOrphan, "lbp", hasAllocations)}
            + ${keptChangeProfitForKey(clientKeptMatchOrphan, "lbp")}
          AS profit_lbp,
          0 AS transaction_count,
          -- LCC-X4 (Round 3): an orphan row's profit is entirely these two
          -- sources, so its denominator must be too — see getByUser's
          -- identical orphan-row fix.
          ${keptChangeRecognizedCount(clientKeptMatchOrphan)}
            + ${reattributedSettlementRecognizedCount(clientReattMatchOrphan, hasAllocations)}
          AS recognized_transaction_count,
          0 AS pending_profit_usd,
          0 AS pending_profit_lbp
        FROM (
          ${orphanClientKeysSql}
        ) k
        LEFT JOIN clients c2 ON c2.id = k.client_id_key AND c2.tenant_id = ?
        WHERE NOT EXISTS (
          -- The SAME row-membership test (profitTxnRowMembership, rule 14 —
          -- shared with the main SELECT's own WHERE above) — a key already
          -- surfaced by the main branch must NOT also get an orphan row, or
          -- its money would be added twice; this also applies
          -- refundOriginalIsProfitEvent, matching the main SELECT — see
          -- getByUser's identical orphan fix.
          SELECT 1 FROM transactions t3
          ${refundOriginalJoin("t3", "orig3")}
          WHERE ${profitTxnRowMembership("t3", "orig3")}
            AND (
              (t3.client_id IS NOT NULL AND t3.client_id = k.client_id_key)
              OR (t3.client_id IS NULL AND k.client_id_key IS NULL
                  AND COALESCE(t3.client_name, orig3.client_name, '') = k.client_name_key)
            )
        )
      ) ORDER BY profit_usd DESC
        LIMIT ?`,
      )
      .all(...params) as ProfitByClientRow[];
  }

  // ---------------------------------------------------------------------------
  // Pending profit (getPendingProfit)
  // ---------------------------------------------------------------------------

  /**
   * Completed-but-not-fully-paid sales with their potential (deferred)
   * profit.
   *
   * PA-3.8 (OWNER_NOTES_2026-09-21.md §6.5, owner decision): NO date-range
   * filter — "Pending means as of now". This is a receivables view (money
   * still owed), not a period report; a sale from 40 days ago that is still
   * unpaid is still owed today regardless of the Pending tab's from/to
   * pickers (those still scope `getUnsettledCommissions`'s supplier-
   * settlement queue below, a genuinely different, period-bound concept).
   * Takes no arguments as a result — every prior caller passed the tab's
   * shared date range, which no longer applies here.
   *
   * PA-3.3 (discount) — `potential_profit_usd` subtracts `s.discount_usd`
   * from the summed item margins, mirroring
   * `SalesRepository.createTransaction`'s `saleProfitUsd -= sale.discount`
   * at creation time (the REALIZED stamp already nets the discount out —
   * this pending figure was silently overstating every discounted sale by
   * the discount amount).
   *
   * PA-3.2 (round 2, LP-1/LP-2) — for-partner sales are EXCLUDED from this
   * query outright (`AND NOT saleHasPartnerObligation("s")`, the same named
   * EXISTS fragment `saleRecognitionWeight` calls internally — rule 14, not
   * a second hand-written EXISTS). Round 1 tried weighting
   * `potential_profit_usd` by `(1 - saleRecognitionWeight("s"))` instead:
   * that zeroed the PROFIT figure for a fully-settled partner sale but left
   * the ROW itself — and its full `outstanding_usd` — in the list forever,
   * so `totals.count`/`total_outstanding_usd` (plain `rows.reduce` sums in
   * `ProfitService.getPendingProfit`) kept a phantom entry no amount of
   * partner settlement could ever clear. It also double-counted against
   * `getDeferredProfit`'s own `partnerRow` bucket, which already carries the
   * SAME uncovered share for every for-partner `SALE` row via
   * `txnPartnerCoverageRatio` (that function is owned by lane LO and is not
   * edited here). A for-partner sale's pending share now lives in exactly
   * ONE place — the Deferred card — at every coverage level (0%, partial, or
   * 100%), not just at the two ends weighting reproduced correctly. A plain
   * customer-debt sale (no partner obligation at all) is completely
   * unaffected: `saleHasPartnerObligation` is false for it, so the new
   * clause never excludes it.
   *
   * PA-3.8 — no date-range filter; see the top of this doc comment.
   */
  getPendingSaleProfit(): PendingSaleProfitRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
          s.id AS sale_id,
          s.created_at,
          COALESCE(c.full_name, 'Unknown') AS client_name,
          COALESCE(c.phone_number, '') AS client_phone,
          s.final_amount_usd AS total_amount_usd,
          s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1) AS paid_usd,
          s.final_amount_usd - (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) AS outstanding_usd,
          (
            COALESCE((
              SELECT SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity)
              FROM sale_items si
              WHERE si.sale_id = s.id AND si.is_refunded = 0 AND si.tenant_id = ?
            ), 0) - COALESCE(s.discount_usd, 0)
          ) AS potential_profit_usd,
          COALESCE((
            SELECT GROUP_CONCAT(si.quantity || 'x ' || COALESCE(p.name, 'Item'), ', ')
            FROM sale_items si
            LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = ?
            WHERE si.sale_id = s.id AND si.is_refunded = 0 AND si.tenant_id = ?
          ), '') AS items_summary
        FROM sales s
        LEFT JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id AND t.type = 'SALE' AND t.tenant_id = ?
        LEFT JOIN clients c ON c.id = t.client_id AND c.tenant_id = ?
        WHERE s.status = 'completed'
          AND ${saleNotFullyPaid("s")}
          AND NOT ${saleHasPartnerObligation("s")}
          AND s.tenant_id = ?
        ORDER BY s.created_at DESC`,
      )
      .all(
        tenantId, // potential_profit_usd — si subquery
        tenantId, // items_summary — products p join
        tenantId, // items_summary — si predicate
        tenantId, // LEFT JOIN transactions t
        tenantId, // LEFT JOIN clients c
        tenantId, // WHERE s.tenant_id
      ) as PendingSaleProfitRow[];
  }

  /**
   * Unsettled financial-service commissions (RECEIVE rows not yet settled).
   *
   * LIRA-158 (Phase 2a): restricted to LEGACY (`commission_model = 0`) rows
   * via {@link embeddedCommission} — same rationale as
   * {@link getPendingCommissionTotals}. An AT_SETTLEMENT row's `commission`
   * column is a stale creation-time estimate, not the real pending figure,
   * so it stays out of this list entirely; D15
   * ({@link atSettlementCommission}'s own doc comment) — a model-1 row's real
   * commission is unknowable until settlement (force-zeroed for a plain
   * SEND/RECEIVE, never populated at all for WHISH/BILL), so summing it
   * would fabricate a number, not report one.
   *
   * PA-3.7 / LP-3 (OWNER_NOTES_2026-09-21.md §6.5, round 2): the
   * post-cutover "N model-1 rows awaiting settlement" count a fully
   * AT_SETTLEMENT shop needs (so the Pending tab's "Pending OMT/WHISH
   * Commissions" section doesn't stay permanently hidden behind an
   * always-empty legacy list) used to be computed HERE too, as a second
   * query over the exact same is_settled=0 / {@link notRefunded} /
   * {@link dateRange} / tenant window {@link getPendingCommissionTotals}
   * already scans for its own `awaiting_settlement_count` column — two
   * independent queries answering one question, free to drift apart
   * (rule 14). `ProfitService.getPendingProfit` now reads that count
   * straight from `getPendingCommissionTotals(fromDt, toDt)
   * .awaiting_settlement_count` (owned by lane LO, read-only here) instead,
   * so this method went back to its original plain row-list shape — there is
   * now exactly ONE query in this file capable of answering "how many model-1
   * rows are awaiting settlement", and it cannot disagree with itself.
   */
  getUnsettledCommissions(
    fromDt: string,
    toDt: string,
  ): UnsettledCommissionRow[] {
    const supported = this._hasCommissionModelColumn();
    return this.db
      .prepare(
        `SELECT
          id, provider, omt_service_type, amount, currency, commission, omt_fee, created_at
        FROM financial_services
        WHERE is_settled = 0
          AND ${notRefunded("financial_services")}
          AND ${dateRange("created_at")}
          AND ${embeddedCommission("financial_services", supported)}
          AND commission > 0
          AND tenant_id = ?
        ORDER BY created_at DESC`,
      )
      .all(fromDt, toDt, getCurrentTenantId()) as UnsettledCommissionRow[];
  }
}

// =============================================================================
// Singleton
// =============================================================================

let profitRepositoryInstance: ProfitRepository | null = null;

export function getProfitRepository(): ProfitRepository {
  if (!profitRepositoryInstance) {
    profitRepositoryInstance = new ProfitRepository();
  }
  return profitRepositoryInstance;
}

export function resetProfitRepository(): void {
  profitRepositoryInstance = null;
}
