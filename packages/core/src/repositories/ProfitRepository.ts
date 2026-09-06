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
}

export interface FinCurrencyRow {
  currency: string;
  revenue: number;
  commission: number;
  count: number;
}

export interface MobileCurrencyRow {
  currency: string;
  revenue: number;
  cost: number;
  profit: number;
  count: number;
}

export interface RechargeCurrencyRow {
  currency_code: string;
  revenue: number;
  cost: number;
  profit: number;
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
}

export interface LotoTotalsRow {
  revenue_lbp: number;
  profit_lbp: number;
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
  profit_usd: number;
  profit_lbp: number;
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
  count: number;
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
  total_usd: number;
  total_lbp: number;
  count: number;
  pending_commission_usd: number;
  is_settled: number;
  is_debt_repayment_only: number;
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
  pending_profit_usd: number;
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
  pending_profit_usd: number;
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
}

// =============================================================================
// Rule 14 — named domain-rule SQL fragments (defined ONCE, reused everywhere)
// =============================================================================

/**
 * SALE fully-paid gate: total paid (USD + LBP converted at the sale's snapshot
 * rate) covers the final amount within a $0.05 tolerance. `alias` is the table
 * alias used for the `sales` row in the surrounding query.
 */
export function saleFullyPaid(alias: string): string {
  return `(${alias}.paid_usd + COALESCE(${alias}.paid_lbp, 0) / COALESCE(NULLIF(${alias}.exchange_rate_snapshot, 0), 1)) >= ${alias}.final_amount_usd - 0.05`;
}

/** Negation of {@link saleFullyPaid} — sale still owes money (pending). */
function saleNotFullyPaid(alias: string): string {
  return `(${alias}.paid_usd + COALESCE(${alias}.paid_lbp, 0) / COALESCE(NULLIF(${alias}.exchange_rate_snapshot, 0), 1)) < ${alias}.final_amount_usd - 0.05`;
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
 * the yes/no). See `docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md`
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
export function cashlessCommissionBatch(settlementLedgerIdExpr: string): string {
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
 * {@link salePaidOrPartnerSettled} (the pre-existing binary gate) and
 * {@link saleRecognitionWeight} (its proportional counterpart, immediately
 * below) so the two never hand-copy this EXISTS check (rule 14) — extracted
 * here as the ONE place answering "is this a partner sale at all."
 */
function saleHasPartnerObligation(alias: string): string {
  return `EXISTS (
    SELECT 1 FROM partner_ledger plf
    WHERE plf.reference_table = 'sales' AND plf.reference_id = ${alias}.id
      AND plf.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
  )`;
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
 * decision 2026-09-05, docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md,
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
 * Callers: ProfitRepository.getExpenseTotals + getProfitByDate's
 * `daily_expenses`, ClosingRepository.getDailyStatsSnapshot,
 * FinancialRepository.getMonthlyPL.
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
 * `FinancialRepository.getMonthlyPL` can bind the SAME predicate text via
 * `monthBounds()` (`utils/localDate.ts`, the JS twin of this SQL fragment) —
 * the monthly Dashboard tile and the Profits page then bound their windows
 * identically (rule 14) instead of a second hand-written
 * `strftime('%Y-%m', …)` form drifting from this one.
 */
export function dateRange(col: string): string {
  return `datetime(${col}, 'localtime') >= ? AND datetime(${col}, 'localtime') <= ?`;
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
export function atSettlementCommission(alias: string, supported: boolean): string {
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
export function currentSettlementAllocation(fsAlias: string, scaAlias: string): string {
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
 * `getSupplierCommissionTotals`'s `billsOnly` bucket byte-for-byte. A
 * CASHLESS batch (true) re-sources ONLY this settlement's OWN allocations
 * (`sca.settlement_ledger_id = t.source_id` — the one settlement this
 * specific transaction row belongs to, never every settlement tenant-wide)
 * gated by {@link allocationNotDebtPending} (the new D17 gate) and
 * {@link notRefunded} (an fs row refunded WITHOUT voiding the settlement
 * still needs excluding), and weighted by {@link partnerCoverageRatio}
 * (owner decision 2026-09-05, proportional recognition — supplier-settled
 * != partner-settled, matching every other allocation-sourced query in this
 * file, but recognised continuously as the partner pays instead of
 * all-or-nothing). Each allocation's own commission is multiplied by its own
 * `partnerCoverageRatio("financial_services", sca.financial_service_id)`
 * INSIDE the `SUM(...)`, rather than gating the row out of the SUM entirely
 * with the old binary {@link notPartnerPending}: at ratio 0 a row
 * contributes 0 (identical to the old gate excluding it), at ratio 1 it
 * contributes its full commission (identical to the old gate including it),
 * and only a partially-covered allocation now differs — this is the ONE site
 * in this file where the monetary SUM and the partner gate live in the SAME
 * function body, so (unlike {@link saleRecognitionWeight}) this conversion
 * is complete in place, no separate caller-side wiring needed.
 *
 * Degrades to `""` (the WHEN is omitted entirely, so the row falls through
 * to the existing `ELSE`) when `settlement_commission_allocations` doesn't
 * exist (§5): a pre-v150 fixture never had a way to write a cashless
 * allocation in the first place, so there is nothing to re-source — matches
 * every other schema-drift degradation in this file. Callers MUST branch
 * their bind-param array on the SAME `hasAllocations` flag used here: this
 * fragment embeds exactly one `?` (`sca.tenant_id`) when `hasAllocations` is
 * true, and none at all when it is false.
 */
export function supplierSettlementProfitArm(
  hasAllocations: boolean,
  currency: "usd" | "lbp",
): string {
  if (!hasAllocations) return "";
  const profitCol = currency === "usd" ? "t.profit_usd" : "t.profit_lbp";
  const commissionCol =
    currency === "usd" ? "sca.commission_usd" : "sca.commission_lbp";
  return `WHEN t.source_table = 'supplier_ledger' AND t.type IN ('SUPPLIER_SETTLEMENT', 'REFUND') THEN (
              CASE WHEN NOT (${cashlessCommissionBatch("t.source_id")}) THEN ${profitCol}
              ELSE COALESCE((
                SELECT SUM(${commissionCol} * ${partnerCoverageRatio("financial_services", "sca.financial_service_id")})
                FROM settlement_commission_allocations sca
                JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
                WHERE sca.settlement_ledger_id = t.source_id
                  AND sca.tenant_id = ?
                  AND ${notRefunded("fs")}
                  AND ${allocationNotDebtPending("sca")}
              ), 0)
              END
            )`;
}

/** Exchange leg profit (v30+): leg1 + leg2, NULL-safe. */
const EXCHANGE_LEG_PROFIT =
  "COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0)";

/** Providers that represent OMT/WHISH-style commission financial services. */
const COMMISSION_PROVIDERS =
  "'OMT', 'WHISH', 'OMT_APP', 'WHISH_APP', 'BINANCE'";

/**
 * Providers that represent cost/price mobile services. Spellings must match the
 * stored `financial_services.provider` values exactly — the schema CHECK
 * constraint allows 'Katsh' (not 'KATCH'), and SQLite's IN is case-sensitive:
 * a 'KATCH' entry here silently matched zero rows, hiding every Katsh sale's
 * profit from the overview. Guarded by ProfitService.transactionBased test (e).
 */
const MOBILE_PROVIDERS = "'iPick', 'Katsh', 'BOB'";

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
 */
const INTERNAL_PAYMENT_METHODS =
  "'OMT', 'WHISH', 'BOB', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE', 'RESERVE', 'COMMISSION', 'LINE_CREDIT'";

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
 */
const PROFIT_TXN_TYPES =
  "'SALE', 'FINANCIAL_SERVICE', 'RECHARGE', 'CUSTOM_SERVICE', 'MAINTENANCE', 'LOTO', 'REFUND', 'TELECOM_CREDIT_BUYBACK', 'SUPPLIER_SETTLEMENT'";

/**
 * Maintenance jobs that count as completed revenue: the device was delivered.
 * The maintenance workflow has NO "completed" status (its states are Received /
 * In_Progress / Ready / Delivered / Delivered_Paid) — the old lowercase
 * equality predicate matched nothing, so maintenance profit was always zero
 * in every profits view (B5). Takes an alias (mirrors `notRefunded(alias)`
 * immediately above) so every caller — including one with a different table
 * alias, or `ClosingRepository.getDailyStatsSnapshot`'s unaliased
 * `FROM maintenance` — reuses this ONE definition (rule 14) instead of
 * hand-rolling a second copy that silently drifts. That exact drift is what
 * left `ClosingRepository`'s own maintenance-profit query gated on the dead
 * `LOWER(status) = 'completed'` predicate forever, so maintenance profit
 * never once appeared in a daily closing snapshot.
 */
export function maintenanceCompleted(alias: string): string {
  return `${alias}.status IN ('Delivered', 'Delivered_Paid')`;
}

/**
 * DBT-2 / PFT-6 (proportional recognition, 2026-09-05 — Step 2 of
 * docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md) — the
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
      this._hasSettlementAllocationsTableCache =
        hasSettlementAllocationsTable(this.db);
    }
    return this._hasSettlementAllocationsTableCache;
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
   */
  getSalesRevCost(fromDt: string, toDt: string): SalesRevCostRow {
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
        `SELECT COALESCE(SUM(t.profit_usd * (${saleRecognitionWeight("s")})), 0) AS profit_usd
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
          AND (
            (t.source_table = 'debt_ledger'
              AND t.type IN ('DEBT_REPAYMENT', 'REFUND'))
            OR t.type = 'KEPT_CHANGE'
          )
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
        FROM transactions
        WHERE status = 'ACTIVE'
          AND type = 'COUNTERPARTY_DISCOUNT'
          AND ${dateRange("created_at")}
          AND tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as {
      profit_usd: number;
      profit_lbp: number;
      count: number;
    };
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
          FROM transactions
          WHERE status = 'ACTIVE'
            AND source_table = 'supplier_ledger'
            AND type IN ('SUPPLIER_SETTLEMENT', 'REFUND')
            AND ${dateRange("created_at")}
            AND tenant_id = ?`,
        )
        .get(fromDt, toDt, tenantId) as SupplierCommissionTotalsRow;
      return degraded;
    }

    const billsOnly = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(profit_usd), 0) AS profit_usd,
          COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
          COALESCE(SUM(CASE WHEN type = 'SUPPLIER_SETTLEMENT'
                             AND (profit_usd != 0 OR profit_lbp != 0)
                            THEN 1 ELSE 0 END), 0) AS count
        FROM transactions
        WHERE status = 'ACTIVE'
          AND source_table = 'supplier_ledger'
          AND type IN ('SUPPLIER_SETTLEMENT', 'REFUND')
          AND NOT (${cashlessCommissionBatch("source_id")})
          AND ${dateRange("created_at")}
          AND tenant_id = ?`,
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
          COALESCE(SUM((CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS commission,
          SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.is_settled = 1
          AND fs.provider IN (${COMMISSION_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency
        ${havingAnyContribution([
          `SUM((${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
          `SUM((CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
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

  /** Pending (unsettled) financial-service commissions grouped by currency. */
  getFinancialPendingByCurrency(
    fromDt: string,
    toDt: string,
  ): FinCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END), 0) AS commission,
          COALESCE(SUM(${fsRevenue("fs")}), 0) AS revenue,
          COUNT(*) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.is_settled = 0
          AND fs.provider IN (${COMMISSION_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency`,
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
          COALESCE(SUM((CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END) * (${partnerCoverageRatio("financial_services", "fs.id")})), 0) AS profit,
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
          `SUM((CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END) * (${partnerCoverageRatio("financial_services", "fs.id")})) != 0`,
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
          COALESCE(SUM((CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END) * (${partnerCoverageRatio("recharges", "r.id")})), 0) AS profit,
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
          `SUM((CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END) * (${partnerCoverageRatio("recharges", "r.id")})) != 0`,
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
          COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(m.cost_lbp), 0) AS cost_lbp,
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp,
          COUNT(*) AS count
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
   * Exchange totals (v30+: leg1 + leg2 profit; revenue = sum of amount_in).
   * Owner decision 2026-09-05: a for-partner exchange recognises
   * proportionally to partner coverage (partnerCoverageRatio); `count` stays
   * a row tally, counted once any coverage exists (never weighted).
   */
  getExchangeTotals(fromDt: string, toDt: string): ExchangeTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM((${EXCHANGE_LEG_PROFIT}) * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS profit_usd,
          COALESCE(SUM(amount_in * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS revenue_usd,
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
          COALESCE(SUM(sca.commission_usd * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_usd,
          COALESCE(SUM(sca.commission_lbp * (${partnerCoverageRatio("financial_services", "sca.financial_service_id")})), 0) AS profit_lbp,
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
          COALESCE(SUM(profit_usd), 0) AS profit_usd,
          COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
          COALESCE(SUM(count), 0) AS count
        FROM (
          SELECT
            fs.provider AS provider,
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN t.profit_usd * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS profit_lbp,
            SUM(CASE WHEN (${partnerCoverageRatio("financial_services", "fs.id")}) > 0 THEN 1 ELSE 0 END) AS count
          FROM financial_services fs
          JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
          WHERE fs.is_settled = 1
            AND t.status = 'ACTIVE'
            AND ${notRefunded("fs")}
            AND ${notDebtPending("t.id")}
            AND ${dateRange("fs.created_at")}
            AND fs.tenant_id = ? AND t.tenant_id = ?
          GROUP BY fs.provider
          ${allocationArm}
        ) combined
        GROUP BY provider
        ${havingAnyContribution(["SUM(revenue_usd) != 0", "SUM(revenue_lbp) != 0", "SUM(profit_usd) != 0", "SUM(profit_lbp) != 0", "SUM(count) != 0"])}`,
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
          COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_lbp,
          COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_lbp,
          COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS profit_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS profit_lbp,
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
          `SUM(CASE WHEN r.currency_code != 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code != 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code != 'LBP' THEN t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
          `SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END) != 0`,
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

    return this.db
      .prepare(
        `WITH dates AS (
          SELECT DATE(?) AS d
          UNION ALL
          SELECT DATE(d, '+1 day') FROM dates WHERE d < DATE(?)
        ),
        daily_sales AS (
          -- Revenue + cost grouped by the SALE date (source tables, unchanged).
          -- Owner decision 2026-09-05 (Task 3): weighted by
          -- saleRecognitionWeight instead of gated by the old binary
          -- salePaidOrPartnerSettled (see getSalesRevCost's own doc comment
          -- for the full rationale). No phantom-row risk: this method's
          -- outer query always emits one row per calendar day regardless
          -- (see havingAnyContribution's own doc comment).
          SELECT
            DATE(s.created_at, 'localtime') AS d,
            COALESCE(SUM(si.sold_price_usd * si.quantity * (${saleRecognitionWeight("s")})), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity * (${saleRecognitionWeight("s")})), 0) AS cost_usd
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND ${dateRange("s.created_at")}
            AND si.tenant_id = ? AND s.tenant_id = ?
          GROUP BY DATE(s.created_at, 'localtime')
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
            COALESCE(SUM(t.profit_usd * (${saleRecognitionWeight("s")})), 0) AS profit_usd
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
              COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN t.profit_usd * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS profit_usd,
              COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS profit_lbp,
              COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_usd,
              COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS revenue_lbp
            FROM financial_services fs
            JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
            WHERE fs.is_settled = 1
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
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS cost_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN t.profit_usd * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp * (${partnerCoverageRatio("recharges", "r.id")}) ELSE 0 END), 0) AS profit_lbp
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
            COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
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
            COALESCE(SUM(t.profit_lbp * (${partnerCoverageRatio("loto_tickets", "lt.id")})), 0) AS profit_lbp
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
            COALESCE(SUM(amount_in * (${partnerCoverageRatio("exchange_transactions", "exchange_transactions.id")})), 0) AS revenue_usd,
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
          SELECT
            DATE(fs.created_at, 'localtime') AS d,
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN fs.payment_method_fee ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN fs.payment_method_fee ELSE 0 END), 0) AS profit_lbp
          FROM financial_services fs
          WHERE COALESCE(fs.payment_method_fee, 0) <> 0
            AND ${notRefunded("fs")}
            AND ${dateRange("fs.created_at")}
            AND fs.tenant_id = ?
          GROUP BY DATE(fs.created_at, 'localtime')
        )
        SELECT
          dates.d AS date,
          COALESCE(ds.revenue_usd, 0) + COALESCE(dc.revenue_usd, 0) + COALESCE(dr.revenue_usd, 0) + COALESCE(dcm.revenue_usd, 0) + COALESCE(dm.revenue_usd, 0) + COALESCE(dex.revenue_usd, 0) AS revenue_usd,
          COALESCE(dc.revenue_lbp, 0) + COALESCE(dr.revenue_lbp, 0) + COALESCE(dcm.revenue_lbp, 0) + COALESCE(dm.revenue_lbp, 0) + COALESCE(dl.revenue_lbp, 0) AS revenue_lbp,
          COALESCE(ds.cost_usd, 0) + COALESCE(dr.cost_usd, 0) + COALESCE(dcm.cost_usd, 0) + COALESCE(dm.cost_usd, 0) + COALESCE(dex.revenue_usd, 0) - COALESCE(dex.profit_usd, 0) AS cost_usd,
          COALESCE(dr.cost_lbp, 0) + COALESCE(dcm.cost_lbp, 0) + COALESCE(dm.cost_lbp, 0) AS cost_lbp,
          COALESCE(dsp.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) + COALESCE(dex.profit_usd, 0) + COALESCE(dpf.profit_usd, 0) AS profit_usd,
          COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) + COALESCE(dm.profit_lbp, 0) + COALESCE(dl.profit_lbp, 0) + COALESCE(dpf.profit_lbp, 0) AS profit_lbp,
          COALESCE(de.expenses_usd, 0) AS expenses_usd,
          COALESCE(de.expenses_lbp, 0) AS expenses_lbp,
          COALESCE(dsp.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) + COALESCE(dex.profit_usd, 0) + COALESCE(dpf.profit_usd, 0) - COALESCE(de.expenses_usd, 0) AS net_profit_usd,
          COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) + COALESCE(dm.profit_lbp, 0) + COALESCE(dl.profit_lbp, 0) + COALESCE(dpf.profit_lbp, 0) - COALESCE(de.expenses_lbp, 0) AS net_profit_lbp
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
        ORDER BY dates.d DESC`,
      )
      .all(...params) as ProfitByDateRow[];
  }

  // ---------------------------------------------------------------------------
  // By payment method (getByPaymentMethod)
  // ---------------------------------------------------------------------------

  /** Real customer-facing payment methods (excludes internal/system flows). */
  getPaymentMethodRows(fromDt: string, toDt: string): PaymentMethodRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
          p.method,
          COALESCE(SUM(CASE WHEN p.currency_code != 'LBP' AND p.amount > 0 THEN p.amount ELSE 0 END), 0) AS total_usd,
          COALESCE(SUM(CASE WHEN p.currency_code = 'LBP'  AND p.amount > 0 THEN p.amount ELSE 0 END), 0) AS total_lbp,
          COUNT(*) AS count,
          0 AS pending_commission_usd,
          1 AS is_settled,
          -- Flag if ALL entries for this method are debt repayments (no profit)
          CASE WHEN SUM(CASE WHEN t.type != 'DEBT_REPAYMENT' THEN 1 ELSE 0 END) = 0 THEN 1 ELSE 0 END AS is_debt_repayment_only
        FROM payments p
        LEFT JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = ?
        WHERE ${dateRange("p.created_at")}
          -- Exclude internal system flows
          AND p.method NOT IN (${INTERNAL_PAYMENT_METHODS})
          AND p.amount > 0
          AND p.tenant_id = ?
        GROUP BY p.method
        HAVING total_usd > 0 OR total_lbp > 0`,
      )
      .all(tenantId, fromDt, toDt, tenantId) as PaymentMethodRow[];
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
   */
  getRealizedCommissionTotals(
    fromDt: string,
    toDt: string,
  ): CommissionTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN fs.commission * (${partnerCoverageRatio("financial_services", "fs.id")}) ELSE 0 END), 0) AS total_usd,
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
  ): PendingCommissionTotalsRow {
    const supported = this._hasCommissionModelColumn();
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN currency != 'LBP' AND commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN commission ELSE 0 END), 0) AS total_usd,
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
   */
  getPendingCommissionByProvider(
    fromDt: string,
    toDt: string,
  ): PendingCommissionByProviderRow[] {
    const supported = this._hasCommissionModelColumn();
    return this.db
      .prepare(
        `SELECT provider,
           COALESCE(SUM(CASE WHEN currency != 'LBP' AND commission > 0 AND ${embeddedCommission("financial_services", supported)} THEN commission ELSE 0 END), 0) AS total_usd,
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
   * `revenue_lbp` (`SUM(t.amount_lbp)`, no CASE at all) and
   * `transaction_count` (`COUNT(*)`, no CASE at all) were never gated by
   * either predicate to begin with — nothing to convert, left untouched.
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
   */
  getByUser(fromDt: string, toDt: string): ProfitByUserRow[] {
    const tenantId = getCurrentTenantId();
    const hasAllocations = this._hasSettlementAllocationsTable();

    const params: (string | number)[] = [
      tenantId, // revenue_usd CASE — financial_services fs subquery
      tenantId, // revenue_usd CASE — sales s2 subquery
    ];
    if (hasAllocations) params.push(tenantId); // profit_usd CASE — D17 supplierSettlementProfitArm sca.tenant_id
    params.push(
      tenantId, // profit_usd CASE — sales s2 subquery
      tenantId, // profit_usd CASE — financial_services fs subquery
    );
    if (hasAllocations) params.push(tenantId); // profit_lbp CASE — D17 supplierSettlementProfitArm sca.tenant_id
    params.push(
      tenantId, // profit_lbp CASE — financial_services fs subquery
      tenantId, // profit_lbp CASE — sales s2 subquery
      fromDt,
      toDt, // pending_profit_usd — dateRange(fs2.created_at)
      tenantId, // pending_profit_usd — fs2.tenant_id
      tenantId, // pending_profit_usd — t2.tenant_id
      tenantId, // LEFT JOIN transactions orig
      tenantId, // LEFT JOIN users u
      fromDt,
      toDt, // WHERE dateRange(t.created_at)
      tenantId, // WHERE t.tenant_id
    );

    return this.db
      .prepare(
        `SELECT
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
              SELECT CASE WHEN fs.is_settled = 1
                THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0) * ${txnPartnerCoverageRatio("t")}
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3 (2026-09-05): weighted by saleRecognitionWeight instead
              -- of gated by the old binary salePaidOrPartnerSettled — see this
              -- method's own doc comment for the full rationale.
              SELECT (CASE WHEN t.type = 'SALE'
                           THEN s2.final_amount_usd
                           ELSE t.amount_usd END) * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.amount_usd * ${txnPartnerCoverageRatio("t")}
          END) AS revenue_usd,
          SUM(t.amount_lbp) AS revenue_lbp,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see the revenue_usd CASE above.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: a SUPPLIER_SETTLEMENT/REFUND row is classified bills-only
            -- (stamp, unchanged) vs cashless (re-sourced from THIS
            -- settlement's own allocations) — see supplierSettlementProfitArm.
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
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_usd * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE t.profit_usd * ${txnPartnerCoverageRatio("t")}
          END) AS profit_usd,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see the revenue_usd CASE above.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: see the profit_usd arm above — identical branch, LBP currency.
            ${supplierSettlementProfitArm(hasAllocations, "lbp")}
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_lbp * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3: see the revenue_usd CASE above.
              SELECT t.profit_lbp * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.profit_lbp * ${txnPartnerCoverageRatio("t")}
          END) AS profit_lbp,
          COUNT(*) AS transaction_count,
          -- LIRA-158 (Phase 2a): embeddedCommission restricts this pending
          -- figure to LEGACY (commission_model = 0) rows — see
          -- getPendingCommissionTotals's doc comment for the rationale.
          COALESCE((
            SELECT SUM(fs2.commission)
            FROM financial_services fs2
            JOIN transactions t2 ON t2.source_table = 'financial_services' AND t2.source_id = fs2.id
              AND t2.type = 'FINANCIAL_SERVICE'
            WHERE t2.user_id = COALESCE(orig.user_id, t.user_id)
              AND fs2.is_settled = 0
              AND fs2.commission > 0
              AND ${embeddedCommission("fs2", this._hasCommissionModelColumn())}
              AND ${notRefunded("fs2")}
              AND ${dateRange("fs2.created_at")}
              AND fs2.tenant_id = ? AND t2.tenant_id = ?
          ), 0) AS pending_profit_usd
        FROM transactions t
        LEFT JOIN transactions orig ON t.type = 'REFUND' AND orig.id = t.reverses_id AND orig.tenant_id = ?
        LEFT JOIN users u ON u.id = COALESCE(orig.user_id, t.user_id) AND u.tenant_id = ?
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?
        GROUP BY COALESCE(orig.user_id, t.user_id)
        ORDER BY profit_usd DESC`,
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
   */
  getByClient(
    fromDt: string,
    toDt: string,
    limit: number,
  ): ProfitByClientRow[] {
    const tenantId = getCurrentTenantId();
    const hasAllocations = this._hasSettlementAllocationsTable();

    const params: (string | number)[] = [
      tenantId, // revenue_usd CASE — financial_services fs subquery
      tenantId, // revenue_usd CASE — sales s2 subquery
    ];
    if (hasAllocations) params.push(tenantId); // profit_usd CASE — D17 supplierSettlementProfitArm sca.tenant_id
    params.push(
      tenantId, // profit_usd CASE — sales s2 subquery
      tenantId, // profit_usd CASE — financial_services fs subquery
    );
    if (hasAllocations) params.push(tenantId); // profit_lbp CASE — D17 supplierSettlementProfitArm sca.tenant_id
    params.push(
      tenantId, // profit_lbp CASE — financial_services fs subquery
      tenantId, // profit_lbp CASE — sales s2 subquery
      fromDt,
      toDt, // pending_profit_usd — dateRange(fs2.created_at)
      tenantId, // pending_profit_usd — fs2.tenant_id
      tenantId, // pending_profit_usd — t2.tenant_id
      tenantId, // LEFT JOIN clients c
      fromDt,
      toDt, // WHERE dateRange(t.created_at)
      tenantId, // WHERE t.tenant_id
      limit,
    );

    return this.db
      .prepare(
        `SELECT
          t.client_id,
          COALESCE(t.client_name, c.full_name, 'Walk-in') AS client_name,
          COALESCE(t.client_phone, c.phone_number) AS client_phone,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see getByUser's doc comment.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              -- Original FINANCIAL_SERVICE and its REFUND both gated by
              -- is_settled; the REFUND negates so a settled FS refund nets to 0
              -- and an UNSETTLED FS refund contributes 0 (was: refund fell to
              -- the ungated ELSE and drove per-user/client revenue negative).
              -- Scaled by txnPartnerCoverageRatio(t) — see getByUser.
              SELECT CASE WHEN fs.is_settled = 1
                THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0) * ${txnPartnerCoverageRatio("t")}
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3 (2026-09-05): weighted by saleRecognitionWeight instead
              -- of gated by the old binary salePaidOrPartnerSettled — see
              -- getByUser's own doc comment for the full rationale.
              SELECT (CASE WHEN t.type = 'SALE'
                           THEN s2.final_amount_usd
                           ELSE t.amount_usd END) * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.amount_usd * ${txnPartnerCoverageRatio("t")}
          END) AS revenue_usd,
          SUM(t.amount_lbp) AS revenue_lbp,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see getByUser's doc comment.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: a SUPPLIER_SETTLEMENT/REFUND row is classified bills-only
            -- (stamp, unchanged) vs cashless (re-sourced from THIS
            -- settlement's own allocations) — see supplierSettlementProfitArm.
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
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_usd * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE t.profit_usd * ${txnPartnerCoverageRatio("t")}
          END) AS profit_usd,
          SUM(CASE
            -- DBT-2 (converted 2026-09-05): see getByUser's doc comment.
            WHEN NOT ${notDebtPending("t.id")} THEN 0
            -- D17: see the profit_usd arm above — identical branch, LBP currency.
            ${supplierSettlementProfitArm(hasAllocations, "lbp")}
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_lbp * ${txnPartnerCoverageRatio("t")} ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              -- Task 3: see the revenue_usd CASE above.
              SELECT t.profit_lbp * ${saleRecognitionWeight("s2")}
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.profit_lbp * ${txnPartnerCoverageRatio("t")}
          END) AS profit_lbp,
          COUNT(*) AS transaction_count,
          -- LIRA-158 (Phase 2a): embeddedCommission restricts this pending
          -- figure to LEGACY (commission_model = 0) rows — see
          -- getPendingCommissionTotals's doc comment for the rationale.
          COALESCE((
            SELECT SUM(fs2.commission)
            FROM financial_services fs2
            JOIN transactions t2 ON t2.source_table = 'financial_services' AND t2.source_id = fs2.id
              AND t2.type = 'FINANCIAL_SERVICE'
            WHERE (
              (t.client_id IS NOT NULL AND t2.client_id = t.client_id)
              OR (t.client_id IS NULL AND t2.client_name = t.client_name)
            )
              AND fs2.is_settled = 0
              AND fs2.commission > 0
              AND ${embeddedCommission("fs2", this._hasCommissionModelColumn())}
              AND ${notRefunded("fs2")}
              AND ${dateRange("fs2.created_at")}
              AND fs2.tenant_id = ? AND t2.tenant_id = ?
          ), 0) AS pending_profit_usd
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id AND c.tenant_id = ?
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?
        GROUP BY t.client_id, COALESCE(t.client_name, c.full_name), COALESCE(t.client_phone, c.phone_number)
        ORDER BY profit_usd DESC
        LIMIT ?`,
      )
      .all(...params) as ProfitByClientRow[];
  }

  // ---------------------------------------------------------------------------
  // Pending profit (getPendingProfit)
  // ---------------------------------------------------------------------------

  /** Completed-but-not-fully-paid sales with their potential (deferred) profit. */
  getPendingSaleProfit(fromDt: string, toDt: string): PendingSaleProfitRow[] {
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
          COALESCE((
            SELECT SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity)
            FROM sale_items si
            WHERE si.sale_id = s.id AND si.is_refunded = 0 AND si.tenant_id = ?
          ), 0) AS potential_profit_usd,
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
          AND ${dateRange("s.created_at")}
          AND s.tenant_id = ?
        ORDER BY s.created_at DESC`,
      )
      .all(
        tenantId, // potential_profit_usd — si subquery
        tenantId, // items_summary — products p join
        tenantId, // items_summary — si predicate
        tenantId, // LEFT JOIN transactions t
        tenantId, // LEFT JOIN clients c
        fromDt,
        toDt, // WHERE dateRange(s.created_at)
        tenantId, // WHERE s.tenant_id
      ) as PendingSaleProfitRow[];
  }

  /**
   * Unsettled financial-service commissions (RECEIVE rows not yet settled).
   *
   * LIRA-158 (Phase 2a): restricted to LEGACY (`commission_model = 0`) rows
   * via `embeddedCommission` — same rationale as
   * {@link getPendingCommissionTotals}. An AT_SETTLEMENT row's `commission`
   * column is a stale creation-time estimate, not the real pending figure.
   */
  getUnsettledCommissions(
    fromDt: string,
    toDt: string,
  ): UnsettledCommissionRow[] {
    return this.db
      .prepare(
        `SELECT
          id, provider, omt_service_type, amount, currency, commission, omt_fee, created_at
        FROM financial_services
        WHERE is_settled = 0
          AND commission > 0
          AND ${embeddedCommission("financial_services", this._hasCommissionModelColumn())}
          AND ${notRefunded("financial_services")}
          AND ${dateRange("created_at")}
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
