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
} from "../repositories/index.js";
import { salesLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface SaleResult {
  success: boolean;
  id?: number;
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

      if (result.success && result.id) {
        const drawerName = sale.drawer_name || "General";
        const finalAmount = sale.final_amount || 0;
        salesLogger.info(
          {
            id: result.id,
            drawer: drawerName,
            amount: finalAmount,
            status: sale.status || "completed",
          },
          `${drawerName} - Sale #${result.id}: $${finalAmount.toFixed(2)}`,
        );
      }

      return result;
    } catch (error) {
      salesLogger.error({ error, sale }, "Sale transaction failed");
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
      salesLogger.error({ error }, "Failed to get drafts");
      return [];
    }
  }

  /**
   * Delete a draft sale and its items
   */
  deleteDraft(saleId: number) {
    try {
      salesLogger.info({ saleId }, "Deleting draft");
      return this.salesRepo.deleteDraft(saleId);
    } catch (error) {
      salesLogger.error({ error, saleId }, "Failed to delete draft");
      return { success: false, error: "Failed to delete draft" };
    }
  }

  /**
   * Get a single sale by ID
   */
  getSale(saleId: number) {
    try {
      return this.salesRepo.findById(saleId);
    } catch (error) {
      salesLogger.error({ error, saleId }, "Failed to get sale");
      throw error;
    }
  }

  /**
   * Get sale items with product details
   */
  getSaleItems(saleId: number) {
    try {
      return this.salesRepo.getSaleItems(saleId);
    } catch (error) {
      salesLogger.error({ error, saleId }, "Failed to get sale items");
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

      salesLogger.debug(
        {
          totalSalesUSD: stats.totalSalesUSD,
          totalSalesLBP: stats.totalSalesLBP,
          ordersCount: stats.ordersCount,
        },
        `Dashboard stats - Sales: $${stats.totalSalesUSD} USD / ${stats.totalSalesLBP.toLocaleString()} LBP`,
      );

      return stats;
    } catch (error) {
      salesLogger.error({ error }, "Failed to get dashboard stats");
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
   * Get today's sales (up to 50 for POS view)
   */
  getTodaysSales(): RecentSale[] {
    return this.salesRepo.getTodaysSales(50);
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
