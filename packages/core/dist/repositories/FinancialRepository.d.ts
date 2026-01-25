/**
 * Financial Repository
 *
 * Handles cross-table financial aggregation for P&L and Commissions.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface MonthlyPL {
    month: string;
    salesProfitUSD: number;
    serviceCommissionsUSD: number;
    serviceCommissionsLBP: number;
    expensesUSD: number;
    expensesLBP: number;
    netProfitUSD: number;
}
export declare class FinancialRepository extends BaseRepository<{
    id: number;
}> {
    constructor();
    /**
     * Get Monthly P&L Aggregation
     * @param month format 'YYYY-MM'
     */
    getMonthlyPL(month: string): MonthlyPL;
}
export declare function getFinancialRepository(): FinancialRepository;
