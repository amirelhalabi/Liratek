/**
 * Financial Repository
 *
 * Handles cross-table financial aggregation for P&L and Commissions.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";

export interface MonthlyPL {
  month: string;
  salesProfitUSD: number;
  serviceCommissionsUSD: number;
  serviceCommissionsLBP: number;
  /** Per-currency commission breakdown (dynamic) */
  serviceCommissionsByCurrency: Record<string, number>;
  expensesUSD: number;
  expensesLBP: number;
  netProfitUSD: number;
  netProfitLBP: number;
}

export class FinancialRepository extends BaseRepository<{ id: number }> {
  constructor() {
    super("sales", { softDelete: false }); // Base table doesn't matter much for aggregations
  }

  // Override getColumns() - This repository uses aggregations, not direct selects
  protected getColumns(): string {
    return "id"; // Minimal since this repo only does aggregations
  }

  /**
   * Get list of all drawer names from drawer_balances
   */
  getDrawerNames(): string[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT drawer_name FROM drawer_balances ORDER BY drawer_name`,
        )
        .all() as { drawer_name: string }[];
      return rows.map((r) => r.drawer_name);
    } catch (error) {
      throw new DatabaseError("Failed to get drawer names", { cause: error });
    }
  }

  /**
   * Get Monthly P&L Aggregation
   * @param month format 'YYYY-MM'
   */
  getMonthlyPL(month: string): MonthlyPL {
    try {
      // 1. Sales Profit (Gross Profit from Products)
      const salesResult = this.db
        .prepare(
          `
        SELECT 
          COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0) as profit
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed' 
          AND strftime('%Y-%m', s.created_at) = ?
      `,
        )
        .get(month) as { profit: number };

      // 2. Service Commissions (OMT, Whish, etc.) — grouped by currency
      const commissionRows = this.db
        .prepare(
          `
        SELECT 
          currency,
          COALESCE(SUM(commission), 0) as commission
        FROM financial_services
        WHERE strftime('%Y-%m', created_at) = ?
        GROUP BY currency
      `,
        )
        .all(month) as { currency: string; commission: number }[];

      const serviceCommissionsByCurrency: Record<string, number> = {};
      for (const row of commissionRows) {
        serviceCommissionsByCurrency[row.currency] = row.commission;
      }
      // Keep legacy USD/LBP fields for backward compat
      const commissionUsd = serviceCommissionsByCurrency["USD"] || 0;
      const commissionLbp = serviceCommissionsByCurrency["LBP"] || 0;

      // 3. Expenses
      const expensesResult = this.db
        .prepare(
          `
        SELECT 
          COALESCE(SUM(amount_usd), 0) as expenses_usd,
          COALESCE(SUM(amount_lbp), 0) as expenses_lbp
        FROM expenses
        WHERE strftime('%Y-%m', expense_date) = ?
      `,
        )
        .get(month) as { expenses_usd: number; expenses_lbp: number };

      // Per-currency net profit: income - expenses, independently
      const netProfitUSD =
        salesResult.profit + commissionUsd - expensesResult.expenses_usd;
      const netProfitLBP = commissionLbp - expensesResult.expenses_lbp;

      return {
        month,
        salesProfitUSD: salesResult.profit,
        serviceCommissionsUSD: commissionUsd,
        serviceCommissionsLBP: commissionLbp,
        serviceCommissionsByCurrency,
        expensesUSD: expensesResult.expenses_usd,
        expensesLBP: expensesResult.expenses_lbp,
        netProfitUSD,
        netProfitLBP,
      };
    } catch (error) {
      throw new DatabaseError("Failed to aggregate monthly P&L", {
        cause: error,
      });
    }
  }
}

let financialRepositoryInstance: FinancialRepository | null = null;

export function getFinancialRepository(): FinancialRepository {
  if (!financialRepositoryInstance) {
    financialRepositoryInstance = new FinancialRepository();
  }
  return financialRepositoryInstance;
}
