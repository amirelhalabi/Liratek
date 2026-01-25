import { BaseRepository } from "./BaseRepository.js";
export interface DailyClosingEntity {
    id: number;
    closing_date: string;
    drawer_name: string;
    opening_balance_usd: number;
    opening_balance_lbp: number;
    physical_usd?: number;
    physical_lbp?: number;
    physical_eur?: number;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    variance_usd?: number;
    notes?: string | null;
    report_path?: string | null;
    updated_by?: number;
    created_at?: string;
    updated_at?: string;
}
export interface ClosingAmountEntity {
    id?: number;
    closing_id: number;
    drawer_name: string;
    currency_code: string;
    opening_amount: number;
    physical_amount: number;
}
export interface DrawerBalances {
    usd: number;
    lbp: number;
    eur: number;
}
export interface SystemExpectedBalances {
    generalDrawer: DrawerBalances;
    omtDrawer: DrawerBalances;
    whishDrawer: DrawerBalances;
    binanceDrawer: DrawerBalances;
    mtcDrawer: DrawerBalances;
    alfaDrawer: DrawerBalances;
}
export interface DailyStatsSnapshot {
    salesCount: number;
    totalSalesUSD: number;
    totalSalesLBP: number;
    debtPaymentsUSD: number;
    debtPaymentsLBP: number;
    totalExpensesUSD: number;
    totalExpensesLBP: number;
    totalProfitUSD: number;
}
export interface OpeningBalanceAmount {
    drawer_name: string;
    currency_code: string;
    opening_amount: number;
}
export interface ClosingAmount {
    drawer_name: string;
    currency_code: string;
    physical_amount: number;
    opening_amount?: number;
}
export declare class ClosingRepository extends BaseRepository<DailyClosingEntity> {
    constructor();
    /**
     * Find existing closing record for a date
     */
    findByDate(closingDate: string): DailyClosingEntity | undefined;
    /**
     * Set opening balances for a date
     */
    setOpeningBalances(closingDate: string, amounts: OpeningBalanceAmount[], userId: number): {
        success: boolean;
        id?: number | bigint;
        error?: string;
    };
    /**
     * Create a daily closing record
     */
    createDailyClosing(closingDate: string, amounts: ClosingAmount[], systemExpectedUsd: number, systemExpectedLbp: number, varianceNotes?: string, reportPath?: string): {
        success: boolean;
        id?: number | bigint;
        error?: string;
    };
    /**
     * Update an existing daily closing
     */
    updateDailyClosing(id: number, data: Partial<DailyClosingEntity>): {
        success: boolean;
        error?: string;
    };
    /**
     * Get system expected balances for today
     */
    getSystemExpectedBalances(): SystemExpectedBalances;
    /**
     * Check if opening balance exists for a specific date
     */
    hasOpeningBalanceForDate(date: string): boolean;
    /**
     * Get daily stats snapshot for closing report
     */
    getDailyStatsSnapshot(): DailyStatsSnapshot;
    /**
     * Log activity
     */
    private logActivity;
}
export declare function getClosingRepository(): ClosingRepository;
export declare function resetClosingRepository(): void;
