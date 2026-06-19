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
  cost_usd: number;
  profit_usd: number;
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

/** Inclusive [from, to] date-range bound on a column (two bind params). */
function dateRange(col: string): string {
  return `${col} >= ? AND ${col} <= ?`;
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
  "'OMT', 'WHISH', 'OMT_APP', 'WISH_APP', 'BINANCE'";

/** Providers that represent cost/price mobile services. */
const MOBILE_PROVIDERS = "'iPick', 'KATCH', 'BOB'";

/** Internal/system payment flows excluded from the per-method profit view. */
const INTERNAL_PAYMENT_METHODS =
  "'OMT', 'WHISH', 'BOB', 'iPick', 'Katsh', 'WISH_APP', 'OMT_APP', 'BINANCE', 'RESERVE', 'COMMISSION'";

/** Transaction types that count toward per-user / per-client profit. */
const PROFIT_TXN_TYPES =
  "'SALE', 'FINANCIAL_SERVICE', 'RECHARGE', 'CUSTOM_SERVICE', 'MAINTENANCE', 'REFUND'";

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
          AND ${saleFullyPaid("s")}
          AND ${dateRange("s.created_at")}`,
      )
      .get(fromDt, toDt) as SalesRevCostRow;
  }

  /** Sales profit from the unified ledger (SALE + REFUND), gated by fully-paid. */
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
          AND ${saleFullyPaid("s")}
          AND ${dateRange("t.created_at")}`,
      )
      .get(fromDt, toDt) as SalesProfitRow;
  }

  /** Settled financial-service commissions (OMT/WHISH family) grouped by currency. */
  getFinancialSettledByCurrency(fromDt: string, toDt: string): FinCurrencyRow[] {
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
          AND ${dateRange("fs.created_at")}
        GROUP BY fs.currency`,
      )
      .all(fromDt, toDt) as FinCurrencyRow[];
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
          AND ${dateRange("fs.created_at")}
        GROUP BY fs.currency`,
      )
      .all(fromDt, toDt) as FinCurrencyRow[];
  }

  /** Mobile services (iPick/KATCH/BOB) revenue/cost/profit grouped by currency. */
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
          AND ${dateRange("fs.created_at")}
        GROUP BY fs.currency`,
      )
      .all(fromDt, toDt) as MobileCurrencyRow[];
  }

  /** Recharges (MTC/Alfa) revenue/cost/profit grouped by currency. */
  getRechargesByCurrency(
    fromDt: string,
    toDt: string,
  ): RechargeCurrencyRow[] {
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
          AND ${dateRange("r.created_at")}
        GROUP BY r.currency_code`,
      )
      .all(fromDt, toDt) as RechargeCurrencyRow[];
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
          AND ${dateRange("cs.created_at")}`,
      )
      .get(fromDt, toDt) as CustomTotalsRow;
  }

  /** Maintenance totals (revenue/cost from source, profit from transactions). */
  getMaintenanceTotals(fromDt: string, toDt: string): MaintTotalsRow {
    return this.db
      .prepare(
        `SELECT
          COALESCE(SUM(m.final_amount_usd), 0) AS revenue_usd,
          COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(t.profit_usd), 0) AS profit_usd,
          COUNT(*) AS count
        FROM maintenance m
        JOIN transactions t ON t.source_table = 'maintenance' AND t.source_id = m.id AND t.type = 'MAINTENANCE'
        WHERE LOWER(m.status) = 'completed'
          AND t.status = 'ACTIVE'
          AND ${dateRange("m.created_at")}`,
      )
      .get(fromDt, toDt) as MaintTotalsRow;
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
        WHERE ${dateRange("created_at")}`,
      )
      .get(fromDt, toDt) as ExchangeTotalsRow;
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
          AND ${dateRange("expense_date")}`,
      )
      .get(fromDt, toDt) as ExpenseTotalsRow;
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
          AND ${dateRange("fs.created_at")}
        GROUP BY fs.provider`,
      )
      .all(fromDt, toDt) as FinByProviderRow[];
  }

  /** Recharge revenue/cost/profit grouped by carrier. */
  getRechargesByCarrier(
    fromDt: string,
    toDt: string,
  ): RechargeByCarrierRow[] {
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
          AND ${dateRange("r.created_at")}
        GROUP BY r.carrier`,
      )
      .all(fromDt, toDt) as RechargeByCarrierRow[];
  }

  // ---------------------------------------------------------------------------
  // By date (getByDate)
  // ---------------------------------------------------------------------------

  /**
   * Daily profit breakdown for a date range (for charts). Returns one row per
   * calendar day in [from, to], with every category LEFT-JOINed by day.
   */
  getByDate(from: string, to: string, fromDt: string, toDt: string): ProfitByDateRow[] {
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
            DATE(s.created_at) AS d,
            COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND ${saleFullyPaid("s")}
            AND ${dateRange("s.created_at")}
          GROUP BY DATE(s.created_at)
        ),
        daily_sales_profit AS (
          -- Profit from the unified ledger (SALE + REFUND), grouped by the
          -- TRANSACTION date. A REFUND nets the SALE at the refund's date (accrual).
          SELECT
            DATE(t.created_at) AS d,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd
          FROM transactions t
          JOIN sales s ON s.id = t.source_id
          WHERE t.status = 'ACTIVE'
            AND t.source_table = 'sales'
            AND t.type IN ('SALE', 'REFUND')
            AND s.status IN ('completed', 'refunded')
            AND ${saleFullyPaid("s")}
            AND ${dateRange("t.created_at")}
          GROUP BY DATE(t.created_at)
        ),
        daily_commissions AS (
          SELECT
            DATE(fs.created_at) AS d,
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN t.profit_usd ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN t.profit_lbp ELSE 0 END), 0) AS profit_lbp,
            COALESCE(SUM(CASE WHEN fs.currency != 'LBP' THEN (${fsRevenue("fs")}) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN fs.currency = 'LBP' THEN (${fsRevenue("fs")}) ELSE 0 END), 0) AS revenue_lbp
          FROM financial_services fs
          JOIN transactions t ON t.source_table = 'financial_services' AND t.source_id = fs.id AND t.type = 'FINANCIAL_SERVICE'
          WHERE fs.is_settled = 1
            AND t.status = 'ACTIVE'
            AND ${dateRange("fs.created_at")}
          GROUP BY DATE(fs.created_at)
        ),
        daily_recharges AS (
          SELECT
            DATE(r.created_at) AS d,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.price ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.price ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN r.cost ELSE 0 END), 0) AS cost_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN r.cost ELSE 0 END), 0) AS cost_lbp,
            COALESCE(SUM(CASE WHEN r.currency_code != 'LBP' THEN t.profit_usd ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN r.currency_code = 'LBP' THEN t.profit_lbp ELSE 0 END), 0) AS profit_lbp
          FROM recharges r
          JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
          WHERE t.status = 'ACTIVE'
            AND ${dateRange("r.created_at")}
          GROUP BY DATE(r.created_at)
        ),
        daily_custom AS (
          SELECT
            DATE(cs.created_at) AS d,
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
            AND ${dateRange("cs.created_at")}
          GROUP BY DATE(cs.created_at)
        ),
        daily_maint AS (
          SELECT
            DATE(m.created_at) AS d,
            COALESCE(SUM(m.final_amount_usd), 0) AS revenue_usd,
            COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
            COALESCE(SUM(t.profit_usd), 0) AS profit_usd
          FROM maintenance m
          JOIN transactions t ON t.source_table = 'maintenance' AND t.source_id = m.id AND t.type = 'MAINTENANCE'
          WHERE LOWER(m.status) = 'completed'
            AND t.status = 'ACTIVE'
            AND ${dateRange("m.created_at")}
          GROUP BY DATE(m.created_at)
        ),
        daily_expenses AS (
          SELECT
            DATE(expense_date) AS d,
            COALESCE(SUM(amount_usd), 0) AS expenses_usd,
            COALESCE(SUM(amount_lbp), 0) AS expenses_lbp
          FROM expenses
          WHERE status = 'active'
            AND ${dateRange("expense_date")}
          GROUP BY DATE(expense_date)
        ),
        daily_exchange AS (
          SELECT
            DATE(created_at) AS d,
            COALESCE(SUM(amount_in), 0) AS revenue_usd,
            COALESCE(SUM(${EXCHANGE_LEG_PROFIT}), 0) AS profit_usd
          FROM exchange_transactions
          WHERE ${dateRange("created_at")}
          GROUP BY DATE(created_at)
        )
        SELECT
          dates.d AS date,
          COALESCE(ds.revenue_usd, 0) + COALESCE(dc.revenue_usd, 0) + COALESCE(dr.revenue_usd, 0) + COALESCE(dcm.revenue_usd, 0) + COALESCE(dm.revenue_usd, 0) + COALESCE(dex.revenue_usd, 0) AS revenue_usd,
          COALESCE(dc.revenue_lbp, 0) + COALESCE(dr.revenue_lbp, 0) + COALESCE(dcm.revenue_lbp, 0) AS revenue_lbp,
          COALESCE(ds.cost_usd, 0) + COALESCE(dr.cost_usd, 0) + COALESCE(dcm.cost_usd, 0) + COALESCE(dm.cost_usd, 0) + COALESCE(dex.revenue_usd, 0) - COALESCE(dex.profit_usd, 0) AS cost_usd,
          COALESCE(dr.cost_lbp, 0) + COALESCE(dcm.cost_lbp, 0) AS cost_lbp,
          COALESCE(dsp.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) + COALESCE(dex.profit_usd, 0) AS profit_usd,
          COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) AS profit_lbp,
          COALESCE(de.expenses_usd, 0) AS expenses_usd,
          COALESCE(de.expenses_lbp, 0) AS expenses_lbp,
          COALESCE(dsp.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) + COALESCE(dex.profit_usd, 0) - COALESCE(de.expenses_usd, 0) AS net_profit_usd,
          COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) - COALESCE(de.expenses_lbp, 0) AS net_profit_lbp
        FROM dates
        LEFT JOIN daily_sales ds ON ds.d = dates.d
        LEFT JOIN daily_sales_profit dsp ON dsp.d = dates.d
        LEFT JOIN daily_commissions dc ON dc.d = dates.d
        LEFT JOIN daily_recharges dr ON dr.d = dates.d
        LEFT JOIN daily_custom dcm ON dcm.d = dates.d
        LEFT JOIN daily_maint dm ON dm.d = dates.d
        LEFT JOIN daily_expenses de ON de.d = dates.d
        LEFT JOIN daily_exchange dex ON dex.d = dates.d
        ORDER BY dates.d DESC`,
      )
      .all(
        from,
        to, // dates CTE
        fromDt,
        toDt, // daily_sales
        fromDt,
        toDt, // daily_sales_profit
        fromDt,
        toDt, // daily_commissions
        fromDt,
        toDt, // daily_recharges
        fromDt,
        toDt, // daily_custom
        fromDt,
        toDt, // daily_maint
        fromDt,
        toDt, // daily_expenses
        fromDt,
        toDt, // daily_exchange
      ) as ProfitByDateRow[];
  }

  // ---------------------------------------------------------------------------
  // By payment method (getByPaymentMethod)
  // ---------------------------------------------------------------------------

  /** Real customer-facing payment methods (excludes internal/system flows). */
  getPaymentMethodRows(fromDt: string, toDt: string): PaymentMethodRow[] {
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
        LEFT JOIN transactions t ON t.id = p.transaction_id
        WHERE ${dateRange("p.created_at")}
          -- Exclude internal system flows
          AND p.method NOT IN (${INTERNAL_PAYMENT_METHODS})
          AND p.amount > 0
        GROUP BY p.method
        HAVING total_usd > 0 OR total_lbp > 0`,
      )
      .all(fromDt, toDt) as PaymentMethodRow[];
  }

  /** Realized (settled) financial-service commission totals by currency. */
  getRealizedCommissionTotals(
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
        WHERE is_settled = 1
          AND commission > 0
          AND ${dateRange("created_at")}`,
      )
      .get(fromDt, toDt) as CommissionTotalsRow;
  }

  /** Pending (unsettled) financial-service commission totals by currency. */
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
          AND ${dateRange("created_at")}`,
      )
      .get(fromDt, toDt) as CommissionTotalsRow;
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
           AND ${dateRange("created_at")}
         GROUP BY provider`,
      )
      .all(fromDt, toDt) as PendingCommissionByProviderRow[];
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
    return this.db
      .prepare(
        `SELECT
          t.user_id,
          COALESCE(u.username, 'Unknown') AS username,
          SUM(CASE
            WHEN t.type = 'FINANCIAL_SERVICE' THEN (
              SELECT CASE WHEN fs.is_settled = 1
                THEN COALESCE(${fsRevenue("fs")}, 0)
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id
            )
            WHEN t.type = 'SALE' THEN (
              SELECT CASE
                WHEN ${saleFullyPaid("s2")}
                THEN s2.final_amount_usd ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id
            )
            ELSE t.amount_usd
          END) AS revenue_usd,
          SUM(t.amount_lbp) AS revenue_lbp,
          SUM(CASE
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${saleFullyPaid("s2")}
                THEN t.profit_usd ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id
            )
            WHEN t.type = 'FINANCIAL_SERVICE' THEN (
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_usd ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id
            )
            ELSE t.profit_usd
          END) AS profit_usd,
          0 AS profit_lbp,
          COUNT(*) AS transaction_count,
          COALESCE((
            SELECT SUM(fs2.commission)
            FROM financial_services fs2
            JOIN transactions t2 ON t2.source_table = 'financial_services' AND t2.source_id = fs2.id
            WHERE t2.user_id = t.user_id
              AND fs2.is_settled = 0
              AND fs2.commission > 0
              AND ${dateRange("fs2.created_at")}
          ), 0) AS pending_profit_usd
        FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND ${dateRange("t.created_at")}
        GROUP BY t.user_id
        ORDER BY profit_usd DESC`,
      )
      .all(fromDt, toDt, fromDt, toDt) as ProfitByUserRow[];
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
    return this.db
      .prepare(
        `SELECT
          t.client_id,
          COALESCE(t.client_name, c.full_name, 'Walk-in') AS client_name,
          COALESCE(t.client_phone, c.phone_number) AS client_phone,
          SUM(CASE
            WHEN t.type = 'FINANCIAL_SERVICE' THEN (
              SELECT CASE WHEN fs.is_settled = 1
                THEN COALESCE(${fsRevenue("fs")}, 0)
                ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id
            )
            WHEN t.type = 'SALE' THEN (
              SELECT CASE
                WHEN ${saleFullyPaid("s2")}
                THEN s2.final_amount_usd ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id
            )
            ELSE t.amount_usd
          END) AS revenue_usd,
          SUM(t.amount_lbp) AS revenue_lbp,
          SUM(CASE
            WHEN t.type IN ('SALE', 'REFUND') AND t.source_table = 'sales' THEN (
              SELECT CASE
                WHEN ${saleFullyPaid("s2")}
                THEN t.profit_usd ELSE 0 END
              FROM sales s2 WHERE s2.id = t.source_id
            )
            WHEN t.type = 'FINANCIAL_SERVICE' THEN (
              SELECT CASE WHEN fs.is_settled = 1 THEN t.profit_usd ELSE 0 END
              FROM financial_services fs WHERE fs.id = t.source_id
            )
            ELSE t.profit_usd
          END) AS profit_usd,
          0 AS profit_lbp,
          COUNT(*) AS transaction_count,
          COALESCE((
            SELECT SUM(fs2.commission)
            FROM financial_services fs2
            JOIN transactions t2 ON t2.source_table = 'financial_services' AND t2.source_id = fs2.id
            WHERE (
              (t.client_id IS NOT NULL AND t2.client_id = t.client_id)
              OR (t.client_id IS NULL AND t2.client_name = t.client_name)
            )
              AND fs2.is_settled = 0
              AND fs2.commission > 0
              AND ${dateRange("fs2.created_at")}
          ), 0) AS pending_profit_usd
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.status = 'ACTIVE'
          AND t.type IN (${PROFIT_TXN_TYPES})
          AND ${dateRange("t.created_at")}
        GROUP BY t.client_id, COALESCE(t.client_name, c.full_name), COALESCE(t.client_phone, c.phone_number)
        ORDER BY profit_usd DESC
        LIMIT ?`,
      )
      .all(fromDt, toDt, fromDt, toDt, limit) as ProfitByClientRow[];
  }

  // ---------------------------------------------------------------------------
  // Pending profit (getPendingProfit)
  // ---------------------------------------------------------------------------

  /** Completed-but-not-fully-paid sales with their potential (deferred) profit. */
  getPendingSaleProfit(
    fromDt: string,
    toDt: string,
  ): PendingSaleProfitRow[] {
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
            WHERE si.sale_id = s.id AND si.is_refunded = 0
          ), 0) AS potential_profit_usd,
          COALESCE((
            SELECT GROUP_CONCAT(si.quantity || 'x ' || COALESCE(p.name, 'Item'), ', ')
            FROM sale_items si
            LEFT JOIN products p ON p.id = si.product_id
            WHERE si.sale_id = s.id AND si.is_refunded = 0
          ), '') AS items_summary
        FROM sales s
        LEFT JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id AND t.type = 'SALE'
        LEFT JOIN clients c ON c.id = t.client_id
        WHERE s.status = 'completed'
          AND ${saleNotFullyPaid("s")}
          AND ${dateRange("s.created_at")}
        ORDER BY s.created_at DESC`,
      )
      .all(fromDt, toDt) as PendingSaleProfitRow[];
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
          AND ${dateRange("created_at")}
        ORDER BY created_at DESC`,
      )
      .all(fromDt, toDt) as UnsettledCommissionRow[];
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
