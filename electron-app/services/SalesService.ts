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

import {
  SalesRepository,
  getSalesRepository,
  type SaleRequest,
  type DashboardStats,
  type DrawerBalances,
  type TopProduct,
  type RecentSale,
  type ChartDataPoint,
} from "../database/repositories/index.js";

// =============================================================================
// Types
// =============================================================================

export interface SaleResult {
  success: boolean;
  saleId?: number;
  error?: string;
}

// =============================================================================
// Sales Service Class
// =============================================================================

export class SalesService {
  private salesRepo: SalesRepository;

  constructor(salesRepo?: SalesRepository) {
    this.salesRepo = salesRepo ?? getSalesRepository();
  }

  // ---------------------------------------------------------------------------
  // Sales Operations
  // ---------------------------------------------------------------------------

  /**
   * Process a sale (create new or update existing)
   */
  processSale(sale: SaleRequest): SaleResult {
    try {
      const result = this.salesRepo.processSale(sale);

      if (result.success && result.saleId) {
        const drawerName = sale.drawer_name || "General_Drawer_B";
        const finalAmount = sale.final_amount || 0;
        console.log(
          `[SALES] ${drawerName} - Sale #${result.saleId}: $${finalAmount.toFixed(2)} [${sale.status || "completed"}]`,
        );
      }

      return result;
    } catch (error) {
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
    } catch (error) {
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
  getDashboardStats(): DashboardStats {
    try {
      const stats = this.salesRepo.getDashboardStats();

      const todayDate = new Date().toLocaleDateString();
      console.log(
        `[SALES] Dashboard stats - Today: ${todayDate}, Sales: $${stats.totalSalesUSD} USD / ${stats.totalSalesLBP.toLocaleString()} LBP`,
      );

      return stats;
    } catch (error) {
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
  getDrawerBalances(): DrawerBalances {
    return this.salesRepo.getDrawerBalances();
  }

  /**
   * Get today's recent sales (last 5)
   */
  getTodaysSales(): RecentSale[] {
    return this.salesRepo.getTodaysSales(5);
  }

  /**
   * Get top selling products
   */
  getTopProducts(): TopProduct[] {
    return this.salesRepo.getTopProducts(5);
  }

  // ---------------------------------------------------------------------------
  // Chart Data
  // ---------------------------------------------------------------------------

  /**
   * Get chart data for profit/sales over last 30 days
   */
  getChartData(type: "Sales" | "Profit"): ChartDataPoint[] {
    return this.salesRepo.getChartData(type);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let salesServiceInstance: SalesService | null = null;

export function getSalesService(): SalesService {
  if (!salesServiceInstance) {
    salesServiceInstance = new SalesService();
  }
  return salesServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetSalesService(): void {
  salesServiceInstance = null;
}
