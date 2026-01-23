/**
 * Financial Repository
 * 
 * Handles cross-table financial aggregation for P&L and Commissions.
 */

import { BaseRepository } from "./BaseRepository";
import { DatabaseError } from "../../utils/errors";

export interface MonthlyPL {
    month: string;
    salesProfitUSD: number;
    serviceCommissionsUSD: number;
    serviceCommissionsLBP: number;
    expensesUSD: number;
    expensesLBP: number;
    netProfitUSD: number;
}

export class FinancialRepository extends BaseRepository<any> {
    constructor() {
        super("sales", { softDelete: false }); // Base table doesn't matter much for aggregations
    }

    /**
     * Get Monthly P&L Aggregation
     * @param month format 'YYYY-MM'
     */
    getMonthlyPL(month: string): MonthlyPL {
        try {
            // 1. Sales Profit (Gross Profit from Products)
            const salesResult = this.db.prepare(`
        SELECT 
          COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0) as profit
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed' 
          AND strftime('%Y-%m', s.created_at) = ?
      `).get(month) as { profit: number };

            // 2. Service Commissions (OMT, Whish, etc.)
            const servicesResult = this.db.prepare(`
        SELECT 
          COALESCE(SUM(commission_usd), 0) as commission_usd,
          COALESCE(SUM(commission_lbp), 0) as commission_lbp
        FROM financial_services
        WHERE strftime('%Y-%m', created_at) = ?
      `).get(month) as { commission_usd: number; commission_lbp: number };

            // 3. Expenses
            const expensesResult = this.db.prepare(`
        SELECT 
          COALESCE(SUM(amount_usd), 0) as expenses_usd,
          COALESCE(SUM(amount_lbp), 0) as expenses_lbp
        FROM expenses
        WHERE strftime('%Y-%m', expense_date) = ?
      `).get(month) as { expenses_usd: number; expenses_lbp: number };

            // Get exchange rate for net calculation (using last snapshot or default)
            const rateResult = this.db.prepare(`
        SELECT rate FROM exchange_rates WHERE from_currency = 'USD' AND to_currency = 'LBP'
      `).get() as { rate: number } | undefined;
            const rate = rateResult?.rate || 89000;

            const totalIncomeUSD = salesResult.profit + servicesResult.commission_usd + (servicesResult.commission_lbp / rate);
            const totalExpensesUSD = expensesResult.expenses_usd + (expensesResult.expenses_lbp / rate);

            return {
                month,
                salesProfitUSD: salesResult.profit,
                serviceCommissionsUSD: servicesResult.commission_usd,
                serviceCommissionsLBP: servicesResult.commission_lbp,
                expensesUSD: expensesResult.expenses_usd,
                expensesLBP: expensesResult.expenses_lbp,
                netProfitUSD: totalIncomeUSD - totalExpensesUSD
            };
        } catch (error) {
            throw new DatabaseError("Failed to aggregate monthly P&L", { cause: error });
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
