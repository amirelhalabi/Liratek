import { OpeningBalanceAmount, ClosingAmount, SystemExpectedBalances, DailyStatsSnapshot } from "../repositories/ClosingRepository.js";
export interface ClosingResult {
    success: boolean;
    id?: number | bigint;
    error?: string;
}
export interface SetOpeningBalancesData {
    closing_date: string;
    user_id?: number;
    amounts: OpeningBalanceAmount[];
}
export interface CreateClosingData {
    closing_date: string;
    user_id?: number;
    variance_notes?: string;
    report_path?: string;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    amounts: ClosingAmount[];
}
export interface UpdateClosingData {
    id: number;
    physical_usd?: number;
    physical_lbp?: number;
    physical_eur?: number;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    variance_usd?: number;
    notes?: string;
    report_path?: string;
    user_id?: number;
}
export declare class ClosingService {
    private repo;
    constructor();
    /**
     * Set opening balances for a date
     */
    setOpeningBalances(data: SetOpeningBalancesData): ClosingResult;
    /**
     * Create a daily closing record
     */
    createDailyClosing(data: CreateClosingData): ClosingResult;
    /**
     * Update an existing daily closing
     */
    updateDailyClosing(data: UpdateClosingData): ClosingResult;
    /**
     * Check if opening balance has been set for today
     */
    hasOpeningBalanceToday(): boolean;
    /**
     * Get system expected balances for today
     */
    getSystemExpectedBalances(): SystemExpectedBalances;
    /**
     * Get daily stats snapshot for closing report
     */
    getDailyStatsSnapshot(): DailyStatsSnapshot;
}
export declare function getClosingService(): ClosingService;
export declare function resetClosingService(): void;
