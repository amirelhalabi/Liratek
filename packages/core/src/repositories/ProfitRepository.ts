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
function saleFullyPaid(alias: string): string {
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
 * DBT-1 — client-account SERVICE profit is realized only when the client
 * repays (owner decision 2026-07-14, consistent with products + partners). A
 * source transaction is "debt-pending" while its module-debt charge row
 * (Recharge/Service/Custom Service/Loto/Maintenance Debt, keyed by the
 * unified transaction id) is not fully covered by repayment FIFO coverage
 * (v129 covered_usd/covered_lbp; DebtRepository._coverServiceDebtsFIFO).
 * 'Sale Debt' is excluded — sales recognize via sales.paid_usd. Refunded
 * charge rows are skipped (their source is excluded via notRefunded anyway).
 */
function notDebtPending(txnIdExpr: string): string {
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
 * DBT-2 — transaction-level partner-pending scan for the by-user/by-client
 * views (their rows are unified transactions, so the partner scan keys on
 * source_table/source_id instead of a fixed table name). Same semantics as
 * {@link notPartnerPending}.
 */
function txnNotPartnerPending(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM partner_ledger plp
    WHERE plp.reference_table = ${alias}.source_table
      AND plp.reference_id = ${alias}.source_id
      AND plp.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
      AND plp.covered_amount < plp.amount - 0.005
  )`;
}

/**
 * SALE realized gate (PFT-6): fully paid by the customer OR a for-partner
 * sale (has a FOR_% row) whose partner has fully settled it. A for-partner
 * sale carries paid_usd = 0 (no counter cash), so without the OR-arm it
 * would stay pending forever even after the partner paid.
 */
function salePaidOrPartnerSettled(alias: string): string {
  return `(${saleFullyPaid(alias)} OR (EXISTS (
    SELECT 1 FROM partner_ledger plf
    WHERE plf.reference_table = 'sales' AND plf.reference_id = ${alias}.id
      AND plf.transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
  ) AND ${notPartnerPending("sales", `${alias}.id`)}))`;
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
 */
function dateRange(col: string): string {
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
 * gated by {@link allocationNotDebtPending} (the new D17 gate),
 * {@link notPartnerPending} (supplier-settled != partner-settled, matching
 * every other allocation-sourced query in this file), and
 * {@link notRefunded} (an fs row refunded WITHOUT voiding the settlement
 * still needs excluding).
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
function supplierSettlementProfitArm(
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
                SELECT SUM(${commissionCol})
                FROM settlement_commission_allocations sca
                JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
                WHERE sca.settlement_ledger_id = t.source_id
                  AND sca.tenant_id = ?
                  AND ${notRefunded("fs")}
                  AND ${allocationNotDebtPending("sca")}
                  AND ${notPartnerPending("financial_services", "sca.financial_service_id")}
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

  /** Sales revenue + cost from sale_items, gated by the sale being fully paid. */
  getSalesRevCost(fromDt: string, toDt: string): SalesRevCostRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
          COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd,
          COUNT(DISTINCT s.id) AS count
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed'
          AND si.is_refunded = 0
          AND ${salePaidOrPartnerSettled("s")}
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
   * Sales profit from the unified ledger (SALE + REFUND), gated by fully-paid.
   * Dated by the SALE's created_at (not the transaction's) so a REFUND nets
   * against the sale's period — matching getSalesRevCost, which sources
   * revenue/cost from sale_items attributed to the same sale. Using the refund
   * transaction's own date would split a refund into a different period than the
   * revenue it reverses, so profit and (revenue − cost) would not reconcile.
   */
  getSalesProfit(fromDt: string, toDt: string): SalesProfitRow {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(t.profit_usd), 0) AS profit_usd
        FROM transactions t
        JOIN sales s ON s.id = t.source_id
        WHERE t.status = 'ACTIVE'
          AND t.source_table = 'sales'
          AND t.type IN ('SALE', 'REFUND')
          AND s.status IN ('completed', 'refunded')
          AND ${salePaidOrPartnerSettled("s")}
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
   *    all. Gated on {@link allocationNotDebtPending} (D17's new gate),
   *    {@link notPartnerPending} (supplier-settled != partner-settled, the
   *    same second gate every other allocation arm in this file carries),
   *    and {@link notRefunded} (an fs row refunded WITHOUT voiding the
   *    settlement still needs excluding — matching
   *    {@link getFinancialSettledByProvider}'s allocation arm).
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

    const cashless = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(sca.commission_usd), 0) AS profit_usd,
          COALESCE(SUM(sca.commission_lbp), 0) AS profit_lbp,
          COUNT(DISTINCT sca.settlement_ledger_id) AS count
        FROM settlement_commission_allocations sca
        JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
        WHERE sca.tenant_id = ?
          AND ${notRefunded("fs")}
          AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
          AND ${allocationNotDebtPending("sca")}
          AND ${notPartnerPending("financial_services", "sca.financial_service_id")}
          AND ${dateRange("sca.created_at")}`,
      )
      .get(tenantId, fromDt, toDt) as SupplierCommissionTotalsRow;

    return {
      profit_usd: billsOnly.profit_usd + cashless.profit_usd,
      profit_lbp: billsOnly.profit_lbp + cashless.profit_lbp,
      count: billsOnly.count + cashless.count,
    };
  }

  /** Settled financial-service commissions (OMT/WHISH family) grouped by currency. */
  getFinancialSettledByCurrency(
    fromDt: string,
    toDt: string,
  ): FinCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM(${fsRevenue("fs")}), 0) AS revenue,
          COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END), 0) AS commission,
          COUNT(*) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.is_settled = 1
          AND fs.provider IN (${COMMISSION_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notPartnerPending("financial_services", "fs.id")}
          AND ${notDebtPending("t.id")}
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
   * Gated by notPartnerPending so a for-partner iPick/Katsh row defers its
   * whole line (revenue + cost + profit + count) until the partner settles —
   * matching the deferred bucket, the daily trend, and getByUser/getByClient
   * (this was the sole FS aggregation missing the partner gate).
   */
  getMobileServicesByCurrency(
    fromDt: string,
    toDt: string,
  ): MobileCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          fs.currency AS currency,
          COALESCE(SUM(fs.price), 0) AS revenue,
          COALESCE(SUM(fs.cost), 0) AS cost,
          COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END), 0) AS profit,
          COUNT(*) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.provider IN (${MOBILE_PROVIDERS})
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notPartnerPending("financial_services", "fs.id")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("fs.created_at")}
          AND fs.tenant_id = ? AND t.tenant_id = ?
        GROUP BY fs.currency`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as MobileCurrencyRow[];
  }

  /** Recharges (MTC/Alfa) revenue/cost/profit grouped by currency. */
  getRechargesByCurrency(fromDt: string, toDt: string): RechargeCurrencyRow[] {
    return this.db
      .prepare(
        `SELECT
          r.currency_code AS currency_code,
          COALESCE(SUM(r.price), 0) AS revenue,
          COALESCE(SUM(r.cost), 0) AS cost,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE t.profit_usd END), 0) AS profit,
          COUNT(*) AS count
        FROM recharges r
        JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("r")}
          AND ${notPartnerPending("recharges", "r.id")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("r.created_at")}
          AND r.tenant_id = ? AND t.tenant_id = ?
        GROUP BY r.currency_code`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as RechargeCurrencyRow[];
  }

  /** Custom services totals (revenue/cost from source, profit from transactions). */
  getCustomServicesTotals(fromDt: string, toDt: string): CustomTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(cs.price_usd), 0) AS revenue_usd,
          COALESCE(SUM(cs.price_lbp), 0) AS revenue_lbp,
          COALESCE(SUM(cs.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(cs.cost_lbp), 0) AS cost_lbp,
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp,
          COUNT(*) AS count
        FROM custom_services cs
        JOIN transactions t ON t.source_table = 'custom_services' AND t.source_id = cs.id AND t.type = 'CUSTOM_SERVICE'
        WHERE cs.status = 'completed'
          AND t.status = 'ACTIVE'
          AND ${notRefunded("cs")}
          AND ${notPartnerPending("custom_services", "cs.id")}
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
   */
  getLotoTotals(fromDt: string, toDt: string): LotoTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(lt.sale_amount), 0) AS revenue_lbp,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp,
          COUNT(*) AS count
        FROM loto_tickets lt
        JOIN transactions t ON t.source_table = 'loto_tickets' AND t.source_id = lt.id AND t.type = 'LOTO'
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("lt")}
          AND ${notPartnerPending("loto_tickets", "lt.id")}
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

  /** Exchange totals (v30+: leg1 + leg2 profit; revenue = sum of amount_in). */
  getExchangeTotals(fromDt: string, toDt: string): ExchangeTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(${EXCHANGE_LEG_PROFIT}), 0) AS profit_usd,
          COALESCE(SUM(amount_in), 0) AS revenue_usd,
          COUNT(*) AS count
        FROM exchange_transactions
        WHERE ${notRefunded("exchange_transactions")}
          AND ${notPartnerPending("exchange_transactions", "exchange_transactions.id")}
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
   * row (PFT-6) or an uncovered client-debt charge row (DBT-1) — the exact
   * negation of the gates {@link getByUser}/{@link getByClient} already apply
   * before counting a transaction's profit as realized. Reuses
   * txnNotPartnerPending / notDebtPending verbatim (rule 14) so this bucket
   * always reconciles with the realized totals: a source moves out of here
   * and into the realized summary the moment it settles/repays, never both.
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
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
        FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND NOT (${txnNotPartnerPending("t")})
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
   * hard-deletes allocations) and {@link notPartnerPending} (a FOR-partner
   * fs row's allocated share still defers until the partner settles —
   * supplier-settled is not partner-settled; this is a SECOND, independent
   * gate from the base arm's own `notPartnerPending`, not a duplicate of
   * it). No reversal predicate is needed beyond that: a voided settlement
   * hard-DELETEs its allocation rows (`TransactionRepository.ts` — `DELETE
   * FROM settlement_commission_allocations WHERE settlement_ledger_id = ?`),
   * so a reversed allocation is physically gone rather than needing an
   * `is_voided` filter.
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
          COALESCE(SUM(sca.commission_usd), 0) AS profit_usd,
          COALESCE(SUM(sca.commission_lbp), 0) AS profit_lbp,
          0 AS count
        FROM settlement_commission_allocations sca
        JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
        WHERE sca.tenant_id = ?
          AND ${notRefunded("fs")}
          AND ${notPartnerPending("financial_services", "sca.financial_service_id")}
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
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN (${fsRevenue("fs")}) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN t.profit_usd ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE 0 END), 0) AS profit_lbp,
            COUNT(*) AS count
          FROM financial_services fs
          JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
          WHERE fs.is_settled = 1
            AND t.status = 'ACTIVE'
            AND ${notRefunded("fs")}
            AND ${notPartnerPending("financial_services", "fs.id")}
            AND ${notDebtPending("t.id")}
            AND ${dateRange("fs.created_at")}
            AND fs.tenant_id = ? AND t.tenant_id = ?
          GROUP BY fs.provider
          ${allocationArm}
        ) combined
        GROUP BY provider`,
      )
      .all(...params) as FinByProviderRow[];
  }

  /** Recharge revenue/cost/profit grouped by carrier. */
  getRechargesByCarrier(fromDt: string, toDt: string): RechargeByCarrierRow[] {
    return this.db
      .prepare(
        `SELECT
          r.carrier AS carrier,
          COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.price ELSE 0 END), 0) AS revenue_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price ELSE 0 END), 0) AS revenue_lbp,
          COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.cost ELSE 0 END), 0) AS cost_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost ELSE 0 END), 0) AS cost_lbp,
          COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN t.profit_usd ELSE 0 END), 0) AS profit_usd,
          COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE 0 END), 0) AS profit_lbp,
          COUNT(*) AS count
        FROM recharges r
        JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
        WHERE t.status = 'ACTIVE'
          AND ${notRefunded("r")}
          AND ${notPartnerPending("recharges", "r.id")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("r.created_at")}
          AND r.tenant_id = ? AND t.tenant_id = ?
        GROUP BY r.carrier`,
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
     * transaction day), why `notRefunded` + `notPartnerPending` are gates,
     * and why voiding needs no extra predicate). Built as a separate string
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
     */
    const dailyCommissionsAllocationArm = hasAllocations
      ? `
          UNION ALL
          SELECT
            DATE(sca.created_at, 'localtime') AS d,
            COALESCE(SUM(sca.commission_usd), 0) AS profit_usd,
            COALESCE(SUM(sca.commission_lbp), 0) AS profit_lbp,
            0 AS revenue_usd,
            0 AS revenue_lbp
          FROM settlement_commission_allocations sca
          JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
          WHERE sca.tenant_id = ?
            AND ${notRefunded("fs")}
            AND ${notPartnerPending("financial_services", "sca.financial_service_id")}
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
          SELECT
            DATE(s.created_at, 'localtime') AS d,
            COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND ${salePaidOrPartnerSettled("s")}
            AND ${dateRange("s.created_at")}
            AND si.tenant_id = ? AND s.tenant_id = ?
          GROUP BY DATE(s.created_at, 'localtime')
        ),
        daily_sales_profit AS (
          -- Profit from the unified ledger (SALE + REFUND), grouped by the SALE
          -- date (s.created_at — a REFUND row's source_id points at the original
          -- sale) so a refund nets the sale at its ORIGINAL date, matching
          -- daily_sales revenue/cost and getSalesProfit (no cross-window divergence).
          SELECT
            DATE(s.created_at, 'localtime') AS d,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd
          FROM transactions t
          JOIN sales s ON s.id = t.source_id
          WHERE t.status = 'ACTIVE'
            AND t.source_table = 'sales'
            AND t.type IN ('SALE', 'REFUND')
            AND s.status IN ('completed', 'refunded')
            AND ${salePaidOrPartnerSettled("s")}
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
              COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN t.profit_usd ELSE 0 END), 0) AS profit_usd,
              COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE 0 END), 0) AS profit_lbp,
              COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN (${fsRevenue("fs")}) ELSE 0 END), 0) AS revenue_usd,
              COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) ELSE 0 END), 0) AS revenue_lbp
            FROM financial_services fs
            JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
            WHERE fs.is_settled = 1
              AND t.status = 'ACTIVE'
              AND ${notRefunded("fs")}
              AND ${notPartnerPending("financial_services", "fs.id")}
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
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.price ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.cost ELSE 0 END), 0) AS cost_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost ELSE 0 END), 0) AS cost_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN t.profit_usd ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE 0 END), 0) AS profit_lbp
          FROM recharges r
          JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
          WHERE t.status = 'ACTIVE'
            AND ${notRefunded("r")}
            AND ${notPartnerPending("recharges", "r.id")}
          AND ${notDebtPending("t.id")}
            AND ${dateRange("r.created_at")}
            AND r.tenant_id = ? AND t.tenant_id = ?
          GROUP BY DATE(r.created_at, 'localtime')
        ),
        daily_custom AS (
          SELECT
            DATE(cs.created_at, 'localtime') AS d,
            COALESCE(SUM(cs.price_usd), 0) AS revenue_usd,
            COALESCE(SUM(cs.price_lbp), 0) AS revenue_lbp,
            COALESCE(SUM(cs.cost_usd), 0) AS cost_usd,
            COALESCE(SUM(cs.cost_lbp), 0) AS cost_lbp,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
            COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
          FROM custom_services cs
          JOIN transactions t ON t.source_table = 'custom_services' AND t.source_id = cs.id AND t.type = 'CUSTOM_SERVICE'
          WHERE cs.status = 'completed'
            AND t.status = 'ACTIVE'
            AND ${notRefunded("cs")}
          AND ${notPartnerPending("custom_services", "cs.id")}
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
            COALESCE(SUM(lt.sale_amount), 0) AS revenue_lbp,
            COALESCE(SUM(t.profit_lbp), 0) AS profit_lbp
          FROM loto_tickets lt
          JOIN transactions t ON t.source_table = 'loto_tickets' AND t.source_id = lt.id AND t.type = 'LOTO'
          WHERE t.status = 'ACTIVE'
            AND ${notRefunded("lt")}
            AND ${notPartnerPending("loto_tickets", "lt.id")}
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
            COALESCE(SUM(amount_in), 0) AS revenue_usd,
            COALESCE(SUM(${EXCHANGE_LEG_PROFIT}), 0) AS profit_usd
          FROM exchange_transactions
          WHERE ${notRefunded("exchange_transactions")}
            AND ${notPartnerPending("exchange_transactions", "exchange_transactions.id")}
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
   * `getFinancialSettledByCurrency`: `notPartnerPending` (PFT-6 — a
   * for-partner row defers until partner settlement FIFO covers its FOR_%
   * row) and `notDebtPending` (DBT-1 — a CUSTOMER_ACCOUNT-charged service
   * defers until the client repays), via the same transactions JOIN shape
   * (`t.status = 'ACTIVE'`). A settled-but-pending row is withheld here AND
   * from the pending row (which keys on is_settled = 0) — it surfaces in
   * getDeferredProfit until settlement/repayment, matching the per-currency
   * pair.
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
          COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN fs.commission ELSE 0 END), 0) AS total_usd,
          COALESCE(SUM(CASE WHEN fs.currency  = 'LBP' THEN fs.commission ELSE 0 END), 0) AS total_lbp,
          COUNT(*) AS count
        FROM financial_services fs
        JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
        WHERE fs.is_settled = 1
          AND fs.commission > 0
          AND ${embeddedCommission("fs", this._hasCommissionModelColumn())}
          AND t.status = 'ACTIVE'
          AND ${notRefunded("fs")}
          AND ${notPartnerPending("financial_services", "fs.id")}
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
            -- DBT-2: partner/debt-pending transactions contribute 0 until
            -- settled/repaid, so this view matches the Summary's gates.
            WHEN NOT (${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")}) THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              -- Original FINANCIAL_SERVICE and its REFUND both gated by
              -- is_settled; the REFUND negates so a settled FS refund nets to 0
              -- and an UNSETTLED FS refund contributes 0 (was: refund fell to
              -- the ungated ELSE and drove per-user/client revenue negative).
              SELECT CASE WHEN fs.is_settled = 1
                THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0)
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${salePaidOrPartnerSettled("s2")}
                THEN (CASE WHEN t.type = 'SALE'
                           THEN s2.final_amount_usd
                           ELSE t.amount_usd END)
                ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.amount_usd
          END) AS revenue_usd,
          SUM(t.amount_lbp) AS revenue_lbp,
          SUM(CASE
            -- DBT-2: partner/debt-pending transactions contribute 0 until
            -- settled/repaid, so this view matches the Summary's gates.
            WHEN NOT (${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")}) THEN 0
            -- D17: a SUPPLIER_SETTLEMENT/REFUND row is classified bills-only
            -- (stamp, unchanged) vs cashless (re-sourced from THIS
            -- settlement's own allocations) — see supplierSettlementProfitArm.
            ${supplierSettlementProfitArm(hasAllocations, "usd")}
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${salePaidOrPartnerSettled("s2")}
                THEN t.profit_usd ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            WHEN t.source_table = 'financial_services' THEN (
              -- FS + its REFUND both gated by is_settled (t.profit_usd already
              -- carries the sign: +commission on the original, -commission on
              -- the refund). Fixes: refunding an UNSETTLED commission used to
              -- fall to the ungated ELSE and post a phantom -commission here.
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_usd ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE t.profit_usd
          END) AS profit_usd,
          SUM(CASE
            -- DBT-2: partner/debt-pending transactions contribute 0 until
            -- settled/repaid, so this view matches the Summary's gates.
            WHEN NOT (${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")}) THEN 0
            -- D17: see the profit_usd arm above — identical branch, LBP currency.
            ${supplierSettlementProfitArm(hasAllocations, "lbp")}
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_lbp ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${salePaidOrPartnerSettled("s2")}
                THEN t.profit_lbp ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.profit_lbp
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

  /** Top clients by realized profit (same realized gates as getByUser). */
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
            -- DBT-2: partner/debt-pending transactions contribute 0 until
            -- settled/repaid, so this view matches the Summary's gates.
            WHEN NOT (${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")}) THEN 0
            WHEN t.source_table = 'financial_services' THEN (
              -- Original FINANCIAL_SERVICE and its REFUND both gated by
              -- is_settled; the REFUND negates so a settled FS refund nets to 0
              -- and an UNSETTLED FS refund contributes 0 (was: refund fell to
              -- the ungated ELSE and drove per-user/client revenue negative).
              SELECT CASE WHEN fs.is_settled = 1
                THEN (CASE WHEN t.type = 'REFUND' THEN -1 ELSE 1 END) * COALESCE(${fsRevenue("fs")}, 0)
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${salePaidOrPartnerSettled("s2")}
                THEN (CASE WHEN t.type = 'SALE'
                           THEN s2.final_amount_usd
                           ELSE t.amount_usd END)
                ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.amount_usd
          END) AS revenue_usd,
          SUM(t.amount_lbp) AS revenue_lbp,
          SUM(CASE
            -- DBT-2: partner/debt-pending transactions contribute 0 until
            -- settled/repaid, so this view matches the Summary's gates.
            WHEN NOT (${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")}) THEN 0
            -- D17: a SUPPLIER_SETTLEMENT/REFUND row is classified bills-only
            -- (stamp, unchanged) vs cashless (re-sourced from THIS
            -- settlement's own allocations) — see supplierSettlementProfitArm.
            ${supplierSettlementProfitArm(hasAllocations, "usd")}
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${salePaidOrPartnerSettled("s2")}
                THEN t.profit_usd ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            WHEN t.source_table = 'financial_services' THEN (
              -- FS + its REFUND both gated by is_settled (t.profit_usd already
              -- carries the sign: +commission on the original, -commission on
              -- the refund). Fixes: refunding an UNSETTLED commission used to
              -- fall to the ungated ELSE and post a phantom -commission here.
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_usd ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            ELSE t.profit_usd
          END) AS profit_usd,
          SUM(CASE
            -- DBT-2: partner/debt-pending transactions contribute 0 until
            -- settled/repaid, so this view matches the Summary's gates.
            WHEN NOT (${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")}) THEN 0
            -- D17: see the profit_usd arm above — identical branch, LBP currency.
            ${supplierSettlementProfitArm(hasAllocations, "lbp")}
            WHEN t.source_table = 'financial_services' THEN (
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_lbp ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id AND fs.tenant_id = ?
            )
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${salePaidOrPartnerSettled("s2")}
                THEN t.profit_lbp ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id AND s2.tenant_id = ?
            )
            ELSE t.profit_lbp
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
