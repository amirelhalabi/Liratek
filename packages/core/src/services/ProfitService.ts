/**
 * Profit Service
 *
 * Comprehensive profit analytics across all revenue modules:
 * - Product sales (sold price - cost price)
 * - Financial services (commission)
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
}

export interface ProfitByUser {
  user_id: number;
  username: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
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
  maintenance: {
    revenue_usd: number;
    cost_usd: number;
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
  client_id: number;
  client_name: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
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
            AND s.created_at >= ? AND s.created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        cost_usd: number;
        profit_usd: number;
        count: number;
      };

      // 2. Financial services (commission-based profit)
      const finRows = this.db
        .prepare(
          `SELECT
            currency,
            COALESCE(SUM(amount), 0) AS revenue,
            COALESCE(SUM(commission), 0) AS commission,
            COUNT(*) AS count
          FROM financial_services
          WHERE created_at >= ? AND created_at <= ?
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

      // 3. Custom services
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

      // 4. Maintenance
      const maint = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(final_amount_usd), 0) AS revenue_usd,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(final_amount_usd - cost_usd), 0) AS profit_usd,
            COUNT(*) AS count
          FROM maintenance
          WHERE status = 'Completed'
            AND created_at >= ? AND created_at <= ?`,
        )
        .get(fromDt, toDt) as {
        revenue_usd: number;
        cost_usd: number;
        profit_usd: number;
        count: number;
      };

      // 5. Expenses
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
        custom.revenue_usd +
        maint.revenue_usd;
      const grossRevenueLbp = finSvc.revenue_lbp + custom.revenue_lbp;
      const totalCostUsd = sales.cost_usd + custom.cost_usd + maint.cost_usd;
      const totalCostLbp = custom.cost_lbp;
      const grossProfitUsd =
        sales.profit_usd +
        finSvc.commission_usd +
        custom.profit_usd +
        maint.profit_usd;
      const grossProfitLbp = finSvc.commission_lbp + custom.profit_lbp;

      return {
        period: `${from} to ${to}`,
        sales,
        financial_services: finSvc,
        custom_services: custom,
        maintenance: maint,
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

      // Financial services by provider
      const finRows = this.db
        .prepare(
          `SELECT
            provider,
            COALESCE(SUM(CASE WHEN currency != 'LBP' THEN amount ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN currency = 'LBP' THEN amount ELSE 0 END), 0) AS revenue_lbp,
            COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS profit_usd,
            COALESCE(SUM(CASE WHEN currency = 'LBP' THEN commission ELSE 0 END), 0) AS profit_lbp,
            COUNT(*) AS count
          FROM financial_services
          WHERE created_at >= ? AND created_at <= ?
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

      // Maintenance
      const maintRow = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(final_amount_usd), 0) AS revenue_usd,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(final_amount_usd - cost_usd), 0) AS profit_usd,
            COUNT(*) AS count
          FROM maintenance
          WHERE status = 'Completed'
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
              AND s.created_at >= ? AND s.created_at <= ?
            GROUP BY DATE(s.created_at)
          ),
          daily_commissions AS (
            SELECT
              DATE(created_at) AS d,
              COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) AS profit_usd,
              COALESCE(SUM(CASE WHEN currency = 'LBP' THEN commission ELSE 0 END), 0) AS profit_lbp,
              COALESCE(SUM(CASE WHEN currency != 'LBP' THEN amount ELSE 0 END), 0) AS revenue_usd,
              COALESCE(SUM(CASE WHEN currency = 'LBP' THEN amount ELSE 0 END), 0) AS revenue_lbp
            FROM financial_services
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
            WHERE status = 'Completed'
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
            COALESCE(ds.revenue_usd, 0) + COALESCE(dc.revenue_usd, 0) + COALESCE(dcm.revenue_usd, 0) + COALESCE(dm.revenue_usd, 0) AS revenue_usd,
            COALESCE(dc.revenue_lbp, 0) + COALESCE(dcm.revenue_lbp, 0) AS revenue_lbp,
            COALESCE(ds.cost_usd, 0) + COALESCE(dcm.cost_usd, 0) + COALESCE(dm.cost_usd, 0) AS cost_usd,
            COALESCE(dcm.cost_lbp, 0) AS cost_lbp,
            COALESCE(ds.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) AS profit_usd,
            COALESCE(dc.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) AS profit_lbp,
            COALESCE(de.expenses_usd, 0) AS expenses_usd,
            COALESCE(de.expenses_lbp, 0) AS expenses_lbp,
            COALESCE(ds.profit_usd, 0) + COALESCE(dc.profit_usd, 0) + COALESCE(dcm.profit_usd, 0) + COALESCE(dm.profit_usd, 0) - COALESCE(de.expenses_usd, 0) AS net_profit_usd,
            COALESCE(dc.profit_lbp, 0) + COALESCE(dcm.profit_lbp, 0) - COALESCE(de.expenses_lbp, 0) AS net_profit_lbp
          FROM dates
          LEFT JOIN daily_sales ds ON ds.d = dates.d
          LEFT JOIN daily_commissions dc ON dc.d = dates.d
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
   */
  getByPaymentMethod(from: string, to: string): ProfitByPaymentMethod[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.db
        .prepare(
          `SELECT
            p.method,
            SUM(CASE WHEN p.currency_code != 'LBP' THEN p.amount ELSE 0 END) AS total_usd,
            SUM(CASE WHEN p.currency_code = 'LBP' THEN p.amount ELSE 0 END) AS total_lbp,
            COUNT(*) AS count
          FROM payments p
          WHERE p.created_at >= ? AND p.created_at <= ?
          GROUP BY p.method
          ORDER BY total_usd DESC`,
        )
        .all(fromDt, toDt) as ProfitByPaymentMethod[];
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
            SUM(t.amount_usd) AS revenue_usd,
            SUM(t.amount_lbp) AS revenue_lbp,
            SUM(CASE
              WHEN t.type = 'SALE' THEN (
                SELECT COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0)
                FROM sale_items si WHERE si.sale_id = t.source_id
              )
              WHEN t.type = 'FINANCIAL_SERVICE' THEN (
                SELECT COALESCE(commission, 0) FROM financial_services WHERE id = t.source_id
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
            COUNT(*) AS transaction_count
          FROM transactions t
          LEFT JOIN users u ON u.id = t.user_id
          WHERE t.status = 'ACTIVE'
            AND t.type IN ('SALE', 'FINANCIAL_SERVICE', 'CUSTOM_SERVICE', 'MAINTENANCE')
            AND t.created_at >= ? AND t.created_at <= ?
          GROUP BY t.user_id
          ORDER BY profit_usd DESC`,
        )
        .all(fromDt, toDt) as ProfitByUser[];
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
            COALESCE(c.full_name, 'Walk-in') AS client_name,
            SUM(t.amount_usd) AS revenue_usd,
            SUM(t.amount_lbp) AS revenue_lbp,
            SUM(CASE
              WHEN t.type = 'SALE' THEN (
                SELECT COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0)
                FROM sale_items si WHERE si.sale_id = t.source_id
              )
              WHEN t.type = 'FINANCIAL_SERVICE' THEN (
                SELECT COALESCE(commission, 0) FROM financial_services WHERE id = t.source_id
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
            COUNT(*) AS transaction_count
          FROM transactions t
          LEFT JOIN clients c ON c.id = t.client_id
          WHERE t.status = 'ACTIVE'
            AND t.type IN ('SALE', 'FINANCIAL_SERVICE', 'CUSTOM_SERVICE', 'MAINTENANCE')
            AND t.created_at >= ? AND t.created_at <= ?
          GROUP BY COALESCE(t.client_id, 0)
          ORDER BY profit_usd DESC
          LIMIT ?`,
        )
        .all(fromDt, toDt, limit) as ProfitByClient[];
    } catch (error) {
      logger.error({ error }, "ProfitService.getByClient error");
      return [];
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
