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
 */

import { getDatabase } from "../db/connection.js";
import logger from "../utils/logger.js";

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
  total_usd: number;
  total_lbp: number;
  count: number;
  /** For commission rows: the pending amount not yet realized */
  pending_commission_usd?: number;
  /** 1 = realized/settled, 0 = pending settlement */
  is_settled?: number;
  /** 1 = all entries are debt repayment pass-throughs (no profit generated) */
  is_debt_repayment_only?: number;
}

export interface ProfitByUser {
  user_id: number;
  username: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** Pending profit from unsettled OMT/WHISH commissions for this cashier */
  pending_profit_usd: number;
}

export interface ProfitSummary {
  period: string;
  sales: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    count: number;
  };
  financial_services: {
    revenue_usd: number;
    revenue_lbp: number;
    commission_usd: number;
    commission_lbp: number;
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
    count: number;
  };
  maintenance: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    count: number;
  };
  exchange: {
    revenue_usd: number;
    profit_usd: number;
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
  /** Pending profit from unsettled commissions linked to this client */
  pending_profit_usd: number;
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
  private get db() {
    return getDatabase();
  }

  /**
   * Overall profit summary for a date range.
   */
  getSummary(from: string, to: string): ProfitSummary {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // 1. Sales profit
      const sales = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd,
            COALESCE(SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity), 0) AS profit_usd,
            COUNT(DISTINCT s.id) AS count
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) >= s.final_amount_usd - 0.05
            AND s.created_at >= ? AND s.created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        cost_usd: number;
        profit_usd: number;
        count: number;
      };

      // 2. Financial services — ONLY is_settled = 1 (realized commission)
      //    Unsettled RECEIVE commissions are pending and shown in Pending Profit tab
      const finRows = this.db
        .prepare(
          `SELECT
            currency,
            COALESCE(SUM(CASE WHEN cost > 0 THEN price ELSE amount END), 0) AS revenue,
            COALESCE(SUM(commission), 0) AS commission,
            COUNT(*) AS count
          FROM financial_services
          WHERE is_settled = 1
            AND created_at >= ? AND created_at <= ?
          GROUP BY currency`,
        )
        .all(fromDt, toDt) as {
        currency: string;
        revenue: number;
        commission: number;
        count: number;
      }[];

      const finSvc = {
        revenue_usd: 0,
        revenue_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        count: 0,
      };
      for (const row of finRows) {
        if (row.currency === "LBP") {
          finSvc.revenue_lbp += row.revenue;
          finSvc.commission_lbp += row.commission;
        } else {
          finSvc.revenue_usd += row.revenue;
          finSvc.commission_usd += row.commission;
        }
        finSvc.count += row.count;
      }

      // 3. Recharges (MTC/Alfa)
      const rechargeRows = this.db
        .prepare(
          `SELECT
            currency_code,
            COALESCE(SUM(price), 0) AS revenue,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(price - cost), 0) AS profit,
            COUNT(*) AS count
          FROM recharges
          WHERE created_at >= ? AND created_at <= ?
          GROUP BY currency_code`,
        )
        .all(fromDt, toDt) as {
        currency_code: string;
        revenue: number;
        cost: number;
        profit: number;
        count: number;
      }[];

      const recharges = {
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        count: 0,
      };
      for (const row of rechargeRows) {
        if (row.currency_code === "LBP") {
          recharges.revenue_lbp += row.revenue;
          recharges.cost_lbp += row.cost;
          recharges.profit_lbp += row.profit;
        } else {
          recharges.revenue_usd += row.revenue;
          recharges.cost_usd += row.cost;
          recharges.profit_usd += row.profit;
        }
        recharges.count += row.count;
      }

      // 4. Custom services
      const custom = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(price_usd), 0) AS revenue_usd,
            COALESCE(SUM(price_lbp), 0) AS revenue_lbp,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(cost_lbp), 0) AS cost_lbp,
            COALESCE(SUM(profit_usd), 0) AS profit_usd,
            COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
            COUNT(*) AS count
          FROM custom_services
          WHERE status = 'completed'
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        revenue_lbp: number;
        cost_usd: number;
        cost_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        count: number;
      };

      // 5. Maintenance
      const maint = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(final_amount_usd), 0) AS revenue_usd,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(final_amount_usd - cost_usd), 0) AS profit_usd,
            COUNT(*) AS count
          FROM maintenance
          WHERE LOWER(status) = 'completed'
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        cost_usd: number;
        profit_usd: number;
        count: number;
      };

      // 6. Exchange profit (v30+: sum leg profits; fallback to legacy profit_usd for old rows)
      const exchange = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(
              COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0)
            ), 0) AS profit_usd,
            COALESCE(SUM(amount_in), 0) AS revenue_usd,
            COUNT(*) AS count
          FROM exchange_transactions
          WHERE created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        profit_usd: number;
        count: number;
      };

      // 7. Expenses
      const expenses = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(amount_usd), 0) AS total_usd,
            COALESCE(SUM(amount_lbp), 0) AS total_lbp,
            COUNT(*) AS count
          FROM expenses
          WHERE status = 'active'
            AND expense_date >= ? AND expense_date <= ?`,
        )
        .get(fromDt, toDt) as {
        total_usd: number;
        total_lbp: number;
        count: number;
      };

      // Totals
      const grossRevenueUsd =
        sales.revenue_usd +
        finSvc.revenue_usd +
        recharges.revenue_usd +
        custom.revenue_usd +
        maint.revenue_usd +
        exchange.revenue_usd;
      const grossRevenueLbp =
        finSvc.revenue_lbp + recharges.revenue_lbp + custom.revenue_lbp;
      const totalCostUsd =
        sales.cost_usd + recharges.cost_usd + custom.cost_usd + maint.cost_usd;
      const totalCostLbp = recharges.cost_lbp + custom.cost_lbp;
      const grossProfitUsd =
        sales.profit_usd +
        finSvc.commission_usd +
        recharges.profit_usd +
        custom.profit_usd +
        maint.profit_usd +
        exchange.profit_usd;
      const grossProfitLbp =
        finSvc.commission_lbp + recharges.profit_lbp + custom.profit_lbp;

      return {
        period: `${from} to ${to}`,
        sales,
        financial_services: finSvc,
        recharges,
        custom_services: custom,
        maintenance: maint,
        exchange,
        expenses,
        totals: {
          gross_revenue_usd: grossRevenueUsd,
          gross_revenue_lbp: grossRevenueLbp,
          total_cost_usd: totalCostUsd,
          total_cost_lbp: totalCostLbp,
          gross_profit_usd: grossProfitUsd,
          gross_profit_lbp: grossProfitLbp,
          net_profit_usd: grossProfitUsd - expenses.total_usd,
          net_profit_lbp: grossProfitLbp - expenses.total_lbp,
        },
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

      const results: ProfitByModule[] = [];

      // Sales
      const salesRow = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
            COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd,
            COALESCE(SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity), 0) AS profit_usd,
            COUNT(DISTINCT s.id) AS count
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.status = 'completed'
            AND si.is_refunded = 0
            AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) >= s.final_amount_usd - 0.05
            AND s.created_at >= ? AND s.created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        cost_usd: number;
        profit_usd: number;
        count: number;
      };
      if (salesRow.count > 0) {
        results.push({
          module: "SALE",
          label: "Product Sales",
          revenue_usd: salesRow.revenue_usd,
          revenue_lbp: 0,
          cost_usd: salesRow.cost_usd,
          cost_lbp: 0,
          profit_usd: salesRow.profit_usd,
          profit_lbp: 0,
          count: salesRow.count,
        });
      }

      // Financial services by provider — ONLY is_settled = 1 (realized commission)
      const finRows = this.db
        .prepare(
          `SELECT
            provider,
            COALESCE(SUM(CASE WHEN currency != 'LBP' THEN (CASE WHEN cost > 0 THEN price ELSE amount END) ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN currency = 'LBP' THEN (CASE WHEN cost > 0 THEN price ELSE amount END) ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN currency = 'LBP' THEN commission ELSE 0 END), 0) AS profit_lbp,
            COUNT(*) AS count
          FROM financial_services
          WHERE is_settled = 1
            AND created_at >= ? AND created_at <= ?
          GROUP BY provider`,
        )
        .all(fromDt, toDt) as {
        provider: string;
        revenue_usd: number;
        revenue_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        count: number;
      }[];
      for (const row of finRows) {
        results.push({
          module: `FINANCIAL_SERVICE_${row.provider}`,
          label: row.provider,
          revenue_usd: row.revenue_usd,
          revenue_lbp: row.revenue_lbp,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: row.profit_usd,
          profit_lbp: row.profit_lbp,
          count: row.count,
        });
      }

      // Custom services
      const customRow = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(price_usd), 0) AS revenue_usd,
            COALESCE(SUM(price_lbp), 0) AS revenue_lbp,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(cost_lbp), 0) AS cost_lbp,
            COALESCE(SUM(profit_usd), 0) AS profit_usd,
            COALESCE(SUM(profit_lbp), 0) AS profit_lbp,
            COUNT(*) AS count
          FROM custom_services
          WHERE status = 'completed'
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        revenue_lbp: number;
        cost_usd: number;
        cost_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        count: number;
      };
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

      // Recharges by carrier
      const rechargeRows = this.db
        .prepare(
          `SELECT
            carrier,
            COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN price ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN price ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN cost ELSE 0 END), 0) AS cost_usd,
            COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN cost ELSE 0 END), 0) AS cost_lbp,
            COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN (price - cost) ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN (price - cost) ELSE 0 END), 0) AS profit_lbp,
            COUNT(*) AS count
          FROM recharges
          WHERE created_at >= ? AND created_at <= ?
          GROUP BY carrier`,
        )
        .all(fromDt, toDt) as {
        carrier: string;
        revenue_usd: number;
        revenue_lbp: number;
        cost_usd: number;
        cost_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        count: number;
      }[];
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
          count: row.count,
        });
      }

      // Maintenance
      const maintRow = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(final_amount_usd), 0) AS revenue_usd,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(final_amount_usd - cost_usd), 0) AS profit_usd,
            COUNT(*) AS count
          FROM maintenance
          WHERE LOWER(status) = 'completed'
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        cost_usd: number;
        profit_usd: number;
        count: number;
      };
      if (maintRow.count > 0) {
        results.push({
          module: "MAINTENANCE",
          label: "Maintenance",
          revenue_usd: maintRow.revenue_usd,
          revenue_lbp: 0,
          cost_usd: maintRow.cost_usd,
          cost_lbp: 0,
          profit_usd: maintRow.profit_usd,
          profit_lbp: 0,
          count: maintRow.count,
        });
      }

      // Exchange (v30+: sum leg profits)
      const exchangeRow = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(
              COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0)
            ), 0) AS profit_usd,
            COALESCE(SUM(amount_in), 0) AS revenue_usd,
            COUNT(*) AS count
          FROM exchange_transactions
          WHERE created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        profit_usd: number;
        count: number;
      };
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

      return results.sort((a, b) => b.profit_usd - a.profit_usd);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByModule error");
      return [];
    }
  }

  /**
   * Daily profit breakdown for a date range (for charts).
   */
  getByDate(from: string, to: string): ProfitByDate[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.db
        .prepare(
          `WITH dates AS (
            SELECT DATE(?) AS d
            UNION ALL
            SELECT DATE(d, '+1 day') FROM dates WHERE d < DATE(?)
          ),
          daily_sales AS (
            SELECT
              DATE(s.created_at) AS d,
              COALESCE(SUM(si.sold_price_usd * si.quantity), 0) AS revenue_usd,
              COALESCE(SUM(si.cost_price_snapshot_usd * si.quantity), 0) AS cost_usd,
              COALESCE(SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity), 0) AS profit_usd
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.status = 'completed'
              AND si.is_refunded = 0
              AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) >= s.final_amount_usd - 0.05
              AND s.created_at >= ? AND s.created_at <= ?
            GROUP BY DATE(s.created_at)
          ),
          daily_commissions AS (
            SELECT
              DATE(created_at) AS d,
              COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS profit_usd,
              COALESCE(SUM(CASE WHEN currency = 'LBP' THEN commission ELSE 0 END), 0) AS profit_lbp,
              COALESCE(SUM(CASE WHEN currency != 'LBP' THEN (CASE WHEN cost > 0 THEN price ELSE amount END) ELSE 0 END), 0) AS revenue_usd,
              COALESCE(SUM(CASE WHEN currency = 'LBP' THEN (CASE WHEN cost > 0 THEN price ELSE amount END) ELSE 0 END), 0) AS revenue_lbp
            FROM financial_services
            WHERE is_settled = 1
              AND created_at >= ? AND created_at <= ?
            GROUP BY DATE(created_at)
          ),
          daily_recharges AS (
            SELECT
              DATE(created_at) AS d,
              COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN price ELSE 0 END), 0) AS revenue_usd,
              COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN price ELSE 0 END), 0) AS revenue_lbp,
              COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN cost ELSE 0 END), 0) AS cost_usd,
              COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN cost ELSE 0 END), 0) AS cost_lbp,
              COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN (price - cost) ELSE 0 END), 0) AS profit_usd,
              COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN (price - cost) ELSE 0 END), 0) AS profit_lbp
            FROM recharges
            WHERE created_at >= ? AND created_at <= ?
            GROUP BY DATE(created_at)
          ),
          daily_custom AS (
            SELECT
              DATE(created_at) AS d,
              COALESCE(SUM(price_usd), 0) AS revenue_usd,
              COALESCE(SUM(price_lbp), 0) AS revenue_lbp,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(cost_lbp), 0) AS cost_lbp,
              COALESCE(SUM(profit_usd), 0) AS profit_usd,
              COALESCE(SUM(profit_lbp), 0) AS profit_lbp
            FROM custom_services
            WHERE status = 'completed'
              AND created_at >= ? AND created_at <= ?
            GROUP BY DATE(created_at)
          ),
          daily_maint AS (
            SELECT
              DATE(created_at) AS d,
              COALESCE(SUM(final_amount_usd), 0) AS revenue_usd,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(final_amount_usd - cost_usd), 0) AS profit_usd
            FROM maintenance
            WHERE LOWER(status) = 'completed'
              AND created_at >= ? AND created_at <= ?
            GROUP BY DATE(created_at)
          ),
          daily_expenses AS (
            SELECT
              DATE(expense_date) AS d,
              COALESCE(SUM(amount_usd), 0) AS expenses_usd,
              COALESCE(SUM(amount_lbp), 0) AS expenses_lbp
            FROM expenses
            WHERE status = 'active'
              AND expense_date >= ? AND expense_date <= ?
            GROUP BY DATE(expense_date)
          )
          SELECT
            dates.d AS date,
            COALESCE(ds.revenue_usd, 0) + COALESCE(dc.revenue_usd, 0) + COALESCE(dr.revenue_usd, 0) + COALESCE(dcm.revenue_usd, 0) + COALESCE(dm.revenue_usd, 0) AS revenue_usd,
            COALESCE(dc.revenue_lbp, 0) + COALESCE(dr.revenue_lbp, 0) + COALESCE(dcm.revenue_lbp, 0) AS revenue_lbp,
            COALESCE(ds.cost_usd, 0) + COALESCE(dr.cost_usd, 0) + COALESCE(dcm.cost_usd, 0) + COALESCE(dm.cost_usd, 0) AS cost_usd,
            COALESCE(dr.cost_lbp, 0) + COALESCE(dcm.cost_lbp, 0) AS cost_lbp,
            COALESCE(ds.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) AS profit_usd,
            COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) AS profit_lbp,
            COALESCE(de.expenses_usd, 0) AS expenses_usd,
            COALESCE(de.expenses_lbp, 0) AS expenses_lbp,
            COALESCE(ds.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dr.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) - COALESCE(de.expenses_usd, 0) AS net_profit_usd,
            COALESCE(dc.profit_lbp, 0) + COALESCE(dr.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) - COALESCE(de.expenses_lbp, 0) AS net_profit_lbp
          FROM dates
          LEFT JOIN daily_sales ds ON ds.d = dates.d
          LEFT JOIN daily_commissions dc ON dc.d = dates.d
          LEFT JOIN daily_recharges dr ON dr.d = dates.d
          LEFT JOIN daily_custom dcm ON dcm.d = dates.d
          LEFT JOIN daily_maint dm ON dm.d = dates.d
          LEFT JOIN daily_expenses de ON de.d = dates.d
          ORDER BY dates.d`,
        )
        .all(
          from,
          to, // dates CTE
          fromDt,
          toDt, // daily_sales
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
        ) as ProfitByDate[];
    } catch (error) {
      logger.error({ error }, "ProfitService.getByDate error");
      return [];
    }
  }

  /**
   * Profit breakdown by payment method.
   *
   * Shows only real customer-facing payment methods (CASH, CARD, etc.).
   * Excludes internal system flows: OMT, WHISH, RESERVE, COMMISSION drawer entries.
   *
   * Financial service commissions are shown as a separate "Commission" row:
   *   - Realized commission (is_settled = 1) → shown as positive profit
   *   - Pending commission (is_settled = 0) → shown separately with status
   */
  getByPaymentMethod(from: string, to: string): ProfitByPaymentMethod[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // Real customer-facing payment methods only.
      // Split into two groups:
      //   1. Profit-generating payments (sales, services, recharges, etc.)
      //   2. Debt repayment pass-throughs (no profit — flagged separately)
      // Exclude internal system flows (RESERVE, COMMISSION, provider system entries).
      const paymentRows = this.db
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
          WHERE p.created_at >= ? AND p.created_at <= ?
            -- Exclude internal system flows
            AND p.method NOT IN ('OMT', 'WHISH', 'BOB', 'iPick', 'Katsh', 'WISH_APP', 'OMT_APP', 'BINANCE', 'RESERVE', 'COMMISSION')
            AND p.amount > 0
          GROUP BY p.method
          HAVING total_usd > 0 OR total_lbp > 0`,
        )
        .all(fromDt, toDt) as (ProfitByPaymentMethod & {
        is_debt_repayment_only: number;
      })[];

      // Realized financial service commissions → shown as "Commission (Settled)"
      const realizedCommission = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS total_usd,
            COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN commission ELSE 0 END), 0) AS total_lbp,
            COUNT(*) AS count
          FROM financial_services
          WHERE is_settled = 1
            AND commission > 0
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        total_usd: number;
        total_lbp: number;
        count: number;
      };

      // Pending financial service commissions → shown as "Commission (Pending)"
      const pendingCommission = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS total_usd,
            COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN commission ELSE 0 END), 0) AS total_lbp,
            COUNT(*) AS count
          FROM financial_services
          WHERE is_settled = 0
            AND commission > 0
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        total_usd: number;
        total_lbp: number;
        count: number;
      };

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

      if (pendingCommission.count > 0) {
        // Build per-provider pending commission details for the label
        const pendingByProvider = this.db
          .prepare(
            `SELECT provider,
               COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS total_usd,
               COUNT(*) AS count
             FROM financial_services
             WHERE is_settled = 0 AND commission > 0
               AND created_at >= ? AND created_at <= ?
             GROUP BY provider`,
          )
          .all(fromDt, toDt) as {
          provider: string;
          total_usd: number;
          count: number;
        }[];

        const providerLabel = pendingByProvider
          .map((p) => `${p.provider} $${p.total_usd.toFixed(2)}`)
          .join(", ");

        results.push({
          method: `Commission Pending Settlement (${providerLabel || "OMT/WHISH"})`,
          total_usd: 0, // not yet in hand — shown as pending
          total_lbp: 0,
          count: pendingCommission.count,
          pending_commission_usd: pendingCommission.total_usd,
          is_settled: 0,
        });
      }

      return results.sort((a, b) => b.total_usd - a.total_usd);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByPaymentMethod error");
      return [];
    }
  }

  /**
   * Profit breakdown by user/cashier.
   */
  getByUser(from: string, to: string): ProfitByUser[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.db
        .prepare(
          `SELECT
            t.user_id,
            COALESCE(u.username, 'Unknown') AS username,
            -- Revenue: only count what the shop actually collected (realized).
            -- For FINANCIAL_SERVICE: only is_settled=1 rows contribute revenue.
            --   DEBT-funded rows have no cash collected → revenue = 0.
            -- For SALE: only fully-paid sales contribute revenue.
            -- For others: use transaction amount directly.
            SUM(CASE
              WHEN t.type = 'FINANCIAL_SERVICE' THEN (
                SELECT CASE WHEN fs.is_settled = 1
                  THEN COALESCE(CASE WHEN fs.cost > 0 THEN fs.price ELSE fs.amount END, 0)
                  ELSE 0 END
                FROM financial_services fs WHERE fs.id = t.source_id
              )
              WHEN t.type = 'SALE' THEN (
                SELECT CASE
                  WHEN (s2.paid_usd + COALESCE(s2.paid_lbp, 0) / COALESCE(NULLIF(s2.exchange_rate_snapshot, 0), 1)) >= s2.final_amount_usd - 0.05
                  THEN s2.final_amount_usd ELSE 0 END
                FROM sales s2 WHERE s2.id = t.source_id
              )
              ELSE t.amount_usd
            END) AS revenue_usd,
            SUM(t.amount_lbp) AS revenue_lbp,
            SUM(CASE
              WHEN t.type = 'SALE' THEN (
                SELECT COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0)
                FROM sale_items si
                JOIN sales s2 ON si.sale_id = s2.id
                WHERE si.sale_id = t.source_id AND si.is_refunded = 0
                  AND (s2.paid_usd + COALESCE(s2.paid_lbp, 0) / COALESCE(NULLIF(s2.exchange_rate_snapshot, 0), 1)) >= s2.final_amount_usd - 0.05
              )
              WHEN t.type = 'FINANCIAL_SERVICE' THEN (
                SELECT COALESCE(commission, 0) FROM financial_services WHERE id = t.source_id AND is_settled = 1
              )
              WHEN t.type = 'RECHARGE' THEN (
                SELECT COALESCE(price - cost, 0) FROM recharges WHERE id = t.source_id
              )
              WHEN t.type = 'CUSTOM_SERVICE' THEN (
                SELECT COALESCE(profit_usd, 0) FROM custom_services WHERE id = t.source_id
              )
              WHEN t.type = 'MAINTENANCE' THEN (
                SELECT COALESCE(final_amount_usd - cost_usd, 0) FROM maintenance WHERE id = t.source_id
              )
              ELSE 0
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
                AND fs2.created_at >= ? AND fs2.created_at <= ?
            ), 0) AS pending_profit_usd
          FROM transactions t
          LEFT JOIN users u ON u.id = t.user_id
          WHERE t.status = 'ACTIVE'
            AND t.type IN ('SALE', 'FINANCIAL_SERVICE', 'RECHARGE', 'CUSTOM_SERVICE', 'MAINTENANCE')
            AND t.created_at >= ? AND t.created_at <= ?
          GROUP BY t.user_id
          ORDER BY profit_usd DESC`,
        )
        .all(fromDt, toDt, fromDt, toDt) as ProfitByUser[];
    } catch (error) {
      logger.error({ error }, "ProfitService.getByUser error");
      return [];
    }
  }

  /**
   * Top clients by profit generated.
   */
  getByClient(from: string, to: string, limit = 20): ProfitByClient[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.db
        .prepare(
          `SELECT
            t.client_id,
            COALESCE(t.client_name, c.full_name, 'Walk-in') AS client_name,
            COALESCE(t.client_phone, c.phone_number) AS client_phone,
            -- Revenue: only count realized/collected amounts (same logic as getByUser)
            SUM(CASE
              WHEN t.type = 'FINANCIAL_SERVICE' THEN (
                SELECT CASE WHEN fs.is_settled = 1
                  THEN COALESCE(CASE WHEN fs.cost > 0 THEN fs.price ELSE fs.amount END, 0)
                  ELSE 0 END
                FROM financial_services fs WHERE fs.id = t.source_id
              )
              WHEN t.type = 'SALE' THEN (
                SELECT CASE
                  WHEN (s2.paid_usd + COALESCE(s2.paid_lbp, 0) / COALESCE(NULLIF(s2.exchange_rate_snapshot, 0), 1)) >= s2.final_amount_usd - 0.05
                  THEN s2.final_amount_usd ELSE 0 END
                FROM sales s2 WHERE s2.id = t.source_id
              )
              ELSE t.amount_usd
            END) AS revenue_usd,
            SUM(t.amount_lbp) AS revenue_lbp,
            SUM(CASE
              WHEN t.type = 'SALE' THEN (
                SELECT COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0)
                FROM sale_items si
                JOIN sales s2 ON si.sale_id = s2.id
                WHERE si.sale_id = t.source_id AND si.is_refunded = 0
                  AND (s2.paid_usd + COALESCE(s2.paid_lbp, 0) / COALESCE(NULLIF(s2.exchange_rate_snapshot, 0), 1)) >= s2.final_amount_usd - 0.05
              )
              WHEN t.type = 'FINANCIAL_SERVICE' THEN (
                SELECT COALESCE(commission, 0) FROM financial_services WHERE id = t.source_id AND is_settled = 1
              )
              WHEN t.type = 'RECHARGE' THEN (
                SELECT COALESCE(price - cost, 0) FROM recharges WHERE id = t.source_id
              )
              WHEN t.type = 'CUSTOM_SERVICE' THEN (
                SELECT COALESCE(profit_usd, 0) FROM custom_services WHERE id = t.source_id
              )
              WHEN t.type = 'MAINTENANCE' THEN (
                SELECT COALESCE(final_amount_usd - cost_usd, 0) FROM maintenance WHERE id = t.source_id
              )
              ELSE 0
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
                AND fs2.created_at >= ? AND fs2.created_at <= ?
            ), 0) AS pending_profit_usd
          FROM transactions t
          LEFT JOIN clients c ON c.id = t.client_id
          WHERE t.status = 'ACTIVE'
            AND t.type IN ('SALE', 'FINANCIAL_SERVICE', 'RECHARGE', 'CUSTOM_SERVICE', 'MAINTENANCE')
            AND t.created_at >= ? AND t.created_at <= ?
          GROUP BY t.client_id, COALESCE(t.client_name, c.full_name), COALESCE(t.client_phone, c.phone_number)
          ORDER BY profit_usd DESC
          LIMIT ?`,
        )
        .all(fromDt, toDt, fromDt, toDt, limit) as ProfitByClient[];
    } catch (error) {
      logger.error({ error }, "ProfitService.getByClient error");
      return [];
    }
  }

  /**
   * Pending profit from sales with outstanding debt.
   * These are completed sales where the customer hasn't fully paid yet.
   * Profit is deferred until the sale is fully paid.
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
    };
  } {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // Pending sales profit (debt not yet paid)
      const rows = this.db
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
            AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) < s.final_amount_usd - 0.05
            AND s.created_at >= ? AND s.created_at <= ?
          ORDER BY s.created_at DESC`,
        )
        .all(fromDt, toDt) as PendingProfitRow[];

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
      const unsettled_commissions = this.db
        .prepare(
          `SELECT
            id, provider, omt_service_type, amount, currency, commission, omt_fee, created_at
          FROM financial_services
          WHERE is_settled = 0
            AND commission > 0
            AND created_at >= ? AND created_at <= ?
          ORDER BY created_at DESC`,
        )
        .all(fromDt, toDt) as UnsettledCommissionRow[];

      const unsettled_totals = {
        total_pending_commission_usd: unsettled_commissions
          .filter((r) => r.currency !== "LBP")
          .reduce((s, r) => s + r.commission, 0),
        total_pending_commission_lbp: unsettled_commissions
          .filter((r) => r.currency === "LBP")
          .reduce((s, r) => s + r.commission, 0),
        count: unsettled_commissions.length,
      };

      return { rows, totals, unsettled_commissions, unsettled_totals };
    } catch (error) {
      logger.error({ error }, "ProfitService.getPendingProfit error");
      return {
        rows: [],
        totals: {
          total_outstanding_usd: 0,
          total_pending_profit_usd: 0,
          count: 0,
        },
        unsettled_commissions: [],
        unsettled_totals: {
          total_pending_commission_usd: 0,
          total_pending_commission_lbp: 0,
          count: 0,
        },
      };
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
