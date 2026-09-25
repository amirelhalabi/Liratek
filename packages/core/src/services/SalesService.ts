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
import { getProfitService, type ProfitService } from "./ProfitService.js";
import { clientDay } from "../utils/requestDay.js";
import { addDaysToDateString } from "../utils/calendarDate.js";

/** DC-10/DC-11 — both the chart and the "Net Profit" tile read a rolling
 *  30-day window ending on "today" (owner decision, OWNER_NOTES_2026-09-21.md
 *  §7). Named so it's never re-typed as a bare `30`/`29` a second place. */
const CHART_WINDOW_DAYS = 30;

/**
 * CHART-m5 (verifier finding, round 1 of the DC-10..12 fix pass) —
 * `getNetProfitLast30Days`'s result shape was hand-typed FOUR separate times
 * (here, `frontend/src/types/electron.d.ts`, `packages/ui/src/api/types.ts`,
 * `frontend/src/api/backendApi.ts`) — a second (third, fourth) definition of
 * one contract, against rules 14/21. This is now the single definition;
 * every other site imports it TYPE-ONLY from `@liratek/core` instead of
 * re-typing the four fields by hand.
 */
export interface NetProfitWindowResult {
  netProfitUSD: number;
  netProfitLBP: number;
  fromDate: string;
  toDate: string;
}

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
  private profitService: ProfitService;

  constructor(salesRepo?: SalesRepository, profitService?: ProfitService) {
    this.salesRepo = salesRepo ?? getSalesRepository();
    this.profitService = profitService ?? getProfitService();
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
   * Get chart data for profit/sales over the rolling last 30 days.
   *
   * "Sales" is unchanged — a thin delegate to `SalesRepository.getChartData`
   * (DC-1..DC-4, OWNER_NOTES_2026-09-21.md §7.1).
   *
   * "Profit" is DC-10 (§7.2): composed HERE, in the service layer, from
   * `ProfitService.getByDate` — the exact same gross-profit-per-day figures
   * the Profits page's By Date tab reads — instead of a second, divergent
   * per-unit SQL query (rule 13/14; see `SalesRepository.getChartData`'s own
   * doc comment for the query this replaced). `profit` carries the day's
   * gross USD profit (before expenses, per the owner's 2026-09-24 decision);
   * `lbp` carries the day's gross LBP profit — the chart renders it on a
   * second y-axis, mirroring how the "Sales" series already splits usd/lbp.
   *
   * `endDay` is the CLIENT's own calendar day (`YYYY-MM-DD`) — rule 27: the
   * web backend has no idea what day it is for the tenant, so the caller
   * (IPC handler / REST route) passes the value the FRONTEND computed from
   * its own clock, validated against `clientDayInputSchema`. Omitted (any
   * direct/internal caller), it falls back to `clientDay()` — the request's
   * own day if one was supplied further up the call stack via
   * `runWithTenant`, else this machine's `localDay()` (desktop, where the
   * machine IS the shop's clock).
   *
   * The fallback is resolved ONCE, here, into `to`, and BOTH series window
   * on that same value (DAY-1 fix, CLAUDE.md rule 27) — "Sales" used to let
   * `SalesRepository.getChartData` ask SQLite for `date('now','localtime')`
   * independently, so on web, between 00:00 and 03:00 Beirut, the two
   * series could cover different 30-day windows (the server's `'now'` is
   * still the previous Beirut day). There is no second day source: a caller
   * that wants a different day for "Sales" than "Profit" cannot ask this
   * method for it, by design.
   */
  getChartData(type: "Sales" | "Profit", endDay?: string): ChartDataPoint[] {
    const to = endDay ?? clientDay();

    if (type === "Sales") {
      return this.salesRepo.getChartData("Sales", to);
    }

    const from = addDaysToDateString(to, -(CHART_WINDOW_DAYS - 1));
    const rows = this.profitService.getByDate(from, to);
    const byDate = new Map(rows.map((r) => [r.date, r]));

    const points: ChartDataPoint[] = [];
    for (let i = 0; i < CHART_WINDOW_DAYS; i++) {
      const date = addDaysToDateString(from, i);
      const row = byDate.get(date);
      points.push({
        date,
        profit: row?.profit_usd ?? 0,
        lbp: row?.profit_lbp ?? 0,
      });
    }
    return points;
  }

  /**
   * DC-11 (OWNER_NOTES_2026-09-21.md §7.2) — the dashboard's "Net Profit —
   * last 30 days" tile: Σ NET profit (gross − expenses, both currencies)
   * over the SAME rolling 30-day window and the SAME `ProfitService
   * .getByDate` call family `getChartData("Profit")` above reads — "no
   * second profit definition". Each day's `net_profit_usd`/`net_profit_lbp`
   * is already `profit - expenses` for that day (`ProfitRepository
   * .getByDate`'s own final SELECT), so summing it here never double-counts
   * or re-derives expenses independently.
   *
   * Replaced `FinancialRepository.getMonthlyPL` as this tile's source. That
   * method (a genuine calendar-month P&L, a deliberately separate figure
   * from this rolling window, never a rename of it) was later found to have
   * no product/UI caller anywhere — `getMonthlyPL`'s only readers were this
   * comment, its own dedicated test, and two e2e specs whose scenarios
   * (local-business-month bucketing, settled-commission composition) are
   * independently covered by `ProfitRepository.localBusinessDay.test.ts`
   * and the `getRealizedCommissionTotals`/`getSupplierCommissionTotals`
   * suites — so it was deleted as dead code (DAY-2,
   * OWNER_NOTES_2026-09-21.md:1051), taking `MonthlyPL` and every channel/
   * route/binding/type that carried it with it.
   */
  getNetProfitLast30Days(endDay?: string): NetProfitWindowResult {
    const to = endDay ?? clientDay();
    const from = addDaysToDateString(to, -(CHART_WINDOW_DAYS - 1));
    const rows = this.profitService.getByDate(from, to);
    const netProfitUSD = rows.reduce((sum, r) => sum + r.net_profit_usd, 0);
    const netProfitLBP = rows.reduce((sum, r) => sum + r.net_profit_lbp, 0);
    return { netProfitUSD, netProfitLBP, fromDate: from, toDate: to };
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
