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
import { getSalesRepository, } from "../repositories/index.js";
// =============================================================================
// Sales Service Class
// =============================================================================
export class SalesService {
    salesRepo;
    constructor(salesRepo) {
        this.salesRepo = salesRepo ?? getSalesRepository();
    }
    // ---------------------------------------------------------------------------
    // Sales Operations
    // ---------------------------------------------------------------------------
    /**
     * Process a sale (create new or update existing)
     */
    processSale(sale) {
        try {
            const result = this.salesRepo.processSale(sale);
            if (result.success && result.saleId) {
                const drawerName = sale.drawer_name || "General_Drawer_B";
                const finalAmount = sale.final_amount || 0;
                console.log(`[SALES] ${drawerName} - Sale #${result.saleId}: $${finalAmount.toFixed(2)} [${sale.status || "completed"}]`);
            }
            return result;
        }
        catch (error) {
            console.error("Sale transaction failed:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Get all draft sales with their items
     */
    getDrafts() {
        try {
            return this.salesRepo.findDrafts();
        }
        catch (error) {
            console.error("Failed to get drafts", error);
            return [];
        }
    }
    // ---------------------------------------------------------------------------
    // Dashboard Statistics
    // ---------------------------------------------------------------------------
    /**
     * Get dashboard statistics (today's totals, counts)
     */
    getDashboardStats() {
        try {
            const stats = this.salesRepo.getDashboardStats();
            const todayDate = new Date().toLocaleDateString();
            console.log(`[SALES] Dashboard stats - Today: ${todayDate}, Sales: $${stats.totalSalesUSD} USD / ${stats.totalSalesLBP.toLocaleString()} LBP`);
            return stats;
        }
        catch (error) {
            console.error("Failed to get dashboard stats:", error);
            return {
                totalSalesUSD: 0,
                totalSalesLBP: 0,
                cashCollectedUSD: 0,
                cashCollectedLBP: 0,
                ordersCount: 0,
                activeClients: 0,
                lowStockCount: 0,
            };
        }
    }
    /**
     * Get drawer balances for today
     */
    getDrawerBalances() {
        return this.salesRepo.getDrawerBalances();
    }
    /**
     * Get today's recent sales (last 5)
     */
    getTodaysSales() {
        return this.salesRepo.getTodaysSales(5);
    }
    /**
     * Get top selling products
     */
    getTopProducts() {
        return this.salesRepo.getTopProducts(5);
    }
    // ---------------------------------------------------------------------------
    // Chart Data
    // ---------------------------------------------------------------------------
    /**
     * Get chart data for profit/sales over last 30 days
     */
    getChartData(type) {
        return this.salesRepo.getChartData(type);
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let salesServiceInstance = null;
export function getSalesService() {
    if (!salesServiceInstance) {
        salesServiceInstance = new SalesService();
    }
    return salesServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetSalesService() {
    salesServiceInstance = null;
}
