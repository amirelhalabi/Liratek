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
 */

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

export interface PendingCommissionByProviderRow {
  provider: string;
  total_usd: number;
  count: number;
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
function notPartnerPending(refTable: string, idExpr: string): string {
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

/** Internal/system payment flows excluded from the per-method profit view. */
const INTERNAL_PAYMENT_METHODS =
  "'OMT', 'WHISH', 'BOB', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE', 'RESERVE', 'COMMISSION'";

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
 * in every profits view (B5).
 */
const MAINTENANCE_COMPLETED = "m.status IN ('Delivered', 'Delivered_Paid')";

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
   * LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — bills-only
   * settlement commission: `SupplierRepository.settleTransactions`'s
   * `isBillsOnlyBatch` branch stamps the operator's entered commission as
   * `profit_usd`/`profit_lbp` directly on the SUPPLIER_SETTLEMENT
   * transaction (a real provider-drawer top-up funded BY the provider — the
   * shop's own words, "our profit entirely"). Every OTHER settlement shape
   * (legacy `commission_model = 0` OMT/WHISH, or a non-bills new-model
   * batch) stamps exactly 0/0 here, so this bucket is a no-op for them.
   *
   * Double-count analysis (verified before this method was added): no OTHER
   * ProfitRepository query reads a supplier_ledger-sourced transaction, and
   * a BILL row's `financial_services.commission` column stays 0 forever
   * (LIRA-112 — the settlement never writes it back), so this is the
   * commission's ONE and ONLY home across every profits view.
   *
   * Includes `REFUND` on the SAME `source_table` (rule 14 — same pattern as
   * {@link getDebtRepaymentProfit}): a reversed settlement's REFUND row
   * carries the negated stamp (`TransactionRepository
   * ._refundTransactionInternal`), so summing the pair nets to 0 (rule 20).
   * A VOIDed settlement needs no REFUND counterpart — its own row simply
   * drops out of the `status = 'ACTIVE'` filter. `source_table =
   * 'supplier_ledger'` also matches SUPPLIER_PAYMENT / journal-entry rows
   * (and their REFUNDs) — harmless, since none of those ever stamp a
   * nonzero profit (verified: no `createTransaction` call for them passes
   * `profit_usd`/`profit_lbp`, so both default to 0).
   */
  getSupplierCommissionTotals(
    fromDt: string,
    toDt: string,
  ): SupplierCommissionTotalsRow {
    return this.db
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
      .get(
        fromDt,
        toDt,
        getCurrentTenantId(),
      ) as SupplierCommissionTotalsRow;
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
        WHERE ${MAINTENANCE_COMPLETED}
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
          AND ${notPartnerPending("exchange_transactions", "id")}
          AND ${dateRange("created_at")}
          AND tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as ExchangeTotalsRow;
  }

  /** Active expenses totals in the date range. */
  getExpenseTotals(fromDt: string, toDt: string): ExpenseTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(amount_usd), 0) AS total_usd,
          COALESCE(SUM(amount_lbp), 0) AS total_lbp,
          COUNT(*) AS count
        FROM expenses
        WHERE status = 'active'
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

    return {
      partner_profit_usd: partnerRow.profit_usd,
      partner_profit_lbp: partnerRow.profit_lbp,
      client_debt_profit_usd: clientDebtRow.profit_usd,
      client_debt_profit_lbp: clientDebtRow.profit_lbp,
    };
  }

  // ---------------------------------------------------------------------------
  // By module (getByModule)
  // ---------------------------------------------------------------------------

  /** Settled financial-service revenue/profit grouped by provider. */
  getFinancialSettledByProvider(
    fromDt: string,
    toDt: string,
  ): FinByProviderRow[] {
    return this.db
      .prepare(
        `SELECT
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
        GROUP BY fs.provider`,
      )
      .all(
        fromDt,
        toDt,
        getCurrentTenantId(),
        getCurrentTenantId(),
      ) as FinByProviderRow[];
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
          WHERE ${MAINTENANCE_COMPLETED}
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
          WHERE status = 'active'
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
            AND ${notPartnerPending("exchange_transactions", "id")}
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
      .all(
        from,
        to, // dates CTE
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_sales (si, s)
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_sales_profit (t, s)
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_commissions (fs, t)
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_recharges (r, t)
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_custom (cs, t)
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_maint (m, t)
        fromDt,
        toDt,
        tenantId,
        tenantId, // daily_loto (lt, t)
        fromDt,
        toDt,
        tenantId, // daily_expenses
        fromDt,
        toDt,
        tenantId, // daily_exchange
        fromDt,
        toDt,
        tenantId, // daily_pmfee (fs)
      ) as ProfitByDateRow[];
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
   * pair. Deliberately NOT adopted from the sibling: the
   * `provider IN (COMMISSION_PROVIDERS)` filter — this row has always
   * counted every commission > 0 row regardless of provider; narrowing it
   * is a separate owner-facing semantics question, not part of the LIRA-108
   * gate closure.
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
   */
  getPendingCommissionTotals(
    fromDt: string,
    toDt: string,
  ): CommissionTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS total_usd,
          COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN commission ELSE 0 END), 0) AS total_lbp,
          COUNT(*) AS count
        FROM financial_services
        WHERE is_settled = 0
          AND commission > 0
          AND ${notRefunded("financial_services")}
          AND ${dateRange("created_at")}
          AND tenant_id = ?`,
      )
      .get(fromDt, toDt, getCurrentTenantId()) as CommissionTotalsRow;
  }

  /** Per-provider pending commission detail (for the pending-row label). */
  getPendingCommissionByProvider(
    fromDt: string,
    toDt: string,
  ): PendingCommissionByProviderRow[] {
    return this.db
      .prepare(
        `SELECT provider,
           COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS total_usd,
           COUNT(*) AS count
         FROM financial_services
         WHERE is_settled = 0 AND commission > 0
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
          COALESCE((
            SELECT SUM(fs2.commission)
            FROM financial_services fs2
            JOIN transactions t2 ON t2.source_table = 'financial_services' AND t2.source_id = fs2.id
              AND t2.type = 'FINANCIAL_SERVICE'
            WHERE t2.user_id = COALESCE(orig.user_id, t.user_id)
              AND fs2.is_settled = 0
              AND fs2.commission > 0
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
      .all(
        tenantId, // revenue_usd CASE — financial_services fs subquery
        tenantId, // revenue_usd CASE — sales s2 subquery
        tenantId, // profit_usd CASE — sales s2 subquery
        tenantId, // profit_usd CASE — financial_services fs subquery
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
      ) as ProfitByUserRow[];
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
      .all(
        tenantId, // revenue_usd CASE — financial_services fs subquery
        tenantId, // revenue_usd CASE — sales s2 subquery
        tenantId, // profit_usd CASE — sales s2 subquery
        tenantId, // profit_usd CASE — financial_services fs subquery
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
      ) as ProfitByClientRow[];
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

  /** Unsettled financial-service commissions (RECEIVE rows not yet settled). */
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
