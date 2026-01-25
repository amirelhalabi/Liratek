/**
 * Sales Service
 *
 * Business logic layer for sales operations.
 * Uses SalesRepository for data access.
 *
 * This service encapsulates:
 * - Sales processing (create/update/draft)
 * - Dashboard statistics
 * - Drawer balances
 * - Chart data generation
 */
import { SalesRepository, type SaleRequest, type DashboardStats, type DrawerBalances, type TopProduct, type RecentSale, type ChartDataPoint } from "../repositories/index.js";
export interface SaleResult {
    success: boolean;
    saleId?: number;
    error?: string;
}
export declare class SalesService {
    private salesRepo;
    constructor(salesRepo?: SalesRepository);
    /**
     * Process a sale (create new or update existing)
     */
    processSale(sale: SaleRequest): SaleResult;
    /**
     * Get all draft sales with their items
     */
    getDrafts(): import("../index.js").DraftSaleWithItems[];
    /**
     * Get dashboard statistics (today's totals, counts)
     */
    getDashboardStats(): DashboardStats;
    /**
     * Get drawer balances for today
     */
    getDrawerBalances(): DrawerBalances;
    /**
     * Get today's recent sales (last 5)
     */
    getTodaysSales(): RecentSale[];
    /**
     * Get top selling products
     */
    getTopProducts(): TopProduct[];
    /**
     * Get chart data for profit/sales over last 30 days
     */
    getChartData(type: "Sales" | "Profit"): ChartDataPoint[];
}
export declare function getSalesService(): SalesService;
/** Reset the singleton (for testing) */
export declare function resetSalesService(): void;
