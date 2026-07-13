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
  type SaleEntity,
  type DashboardStats,
  type DrawerBalances,
  type TopProduct,
  type RecentSale,
  type ChartDataPoint,
} from "../repositories/index.js";
import { salesLogger } from "../utils/logger.js";
import { getSettingsService } from "./SettingsService.js";

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
  processSale(sale: SaleRequest, userId: number): SaleResult {
    try {
      if (sale.transaction_time) {
        const txTime = new Date(sale.transaction_time);
        if (isNaN(txTime.getTime())) {
          throw new Error("Invalid transaction_time format");
        }
        if (txTime > new Date()) {
          throw new Error("transaction_time cannot be in the future");
        }
      }

      const allowOutOfStock =
        getSettingsService().getSettingValue("allow_out_of_stock_sales")
          ?.value === "1";
      const result = this.salesRepo.processSale(sale, userId, {
        allowOutOfStock,
      });

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
      // Enriched with the display customer (linked client, or the walk-in
      // name from the unified transaction) so Sale Detail + reprint show the
      // real customer, not always "Walk-in Customer" (RCP-1).
      return this.salesRepo.getSaleWithCustomer(saleId);
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

  /**
   * Refund a specific item from a sale (partial or full quantity)
   */
  refundSaleItem(params: {
    saleId: number;
    saleItemId: number;
    refundQuantity: number;
    userId: number;
  }): { success: boolean; refundId?: number; error?: string } {
    try {
      const refundTxnId = this.salesRepo.refundSaleItem(params);
      salesLogger.info(
        {
          saleId: params.saleId,
          saleItemId: params.saleItemId,
          refundQuantity: params.refundQuantity,
          refundTxnId,
        },
        `Item refund processed - ${params.refundQuantity} units refunded`,
      );
      return { success: true, refundId: refundTxnId };
    } catch (error) {
      salesLogger.error({ error, params }, "Item refund failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  /**
   * Get sales by date range (completed + refunded, with item count)
   */
  findByDateRange(startDate: string, endDate: string) {
    try {
      return this.salesRepo.findByDateRange(startDate, endDate);
    } catch (error) {
      salesLogger.error(
        { error, startDate, endDate },
        "Failed to get sales by date range",
      );
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
   * Get recent sales for a specific date (defaults to today)
   */
  getTodaysSales(date?: string): RecentSale[] {
    return this.salesRepo.getTodaysSales(50, date);
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

  /**
   * Update non-financial metadata on a sale record.
   * Records old/new values for audit trail.
   */
  updateSaleMetadata(
    id: number,
    data: { note?: string; client_name?: string; client_phone?: string },
    editedBy: string,
  ): {
    success: boolean;
    entity?: SaleEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.salesRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Sale not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    if (data.note !== undefined && data.note !== existing.note) {
      oldValues.note = existing.note;
      newValues.note = data.note;
    }

    // Walk-in customer rename (RCP-1): allowed ONLY for walk-in sales
    // (client_id IS NULL). A client-linked sale takes its name from the
    // clients record — a per-sale edit would fork the transaction label from
    // the client's real name, so it is silently ignored here.
    const isWalkin = existing.client_id == null;
    const rename: { client_name?: string; client_phone?: string } = {};
    if (isWalkin) {
      if (data.client_name !== undefined) {
        newValues.client_name = data.client_name;
        rename.client_name = data.client_name;
      }
      if (data.client_phone !== undefined) {
        newValues.client_phone = data.client_phone;
        rename.client_phone = data.client_phone;
      }
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.salesRepo.updateMetadata(
      id,
      { ...(data.note !== undefined ? { note: data.note } : {}), ...rename },
      editedBy,
    );
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    salesLogger.info(
      { id, editedBy, oldValues, newValues },
      "Sale metadata updated",
    );

    return { success: true, entity: updated, oldValues };
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
