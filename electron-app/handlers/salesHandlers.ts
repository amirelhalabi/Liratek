/**
 * Sales IPC Handlers
 *
 * Thin wrapper over SalesService for IPC communication.
 * Handles: IPC message routing to service
 */

import { ipcMain } from "electron";
import {
  getSalesService,
  getTransactionService,
  salesLogger,
} from "@liratek/core";
import type { SaleRequest } from "@liratek/core";
import { requireRole } from "../session.js";
import { SaleProcessSchema, validatePayload } from "../schemas/index.js";

export function registerSalesHandlers(): void {
  const salesService = getSalesService();

  // Process a sale (create or update)
  ipcMain.handle("sales:process", (_event, sale: SaleRequest) => {
    const v = validatePayload(SaleProcessSchema, sale);
    if (!v.ok) return { success: false, error: v.error };
    salesLogger.debug(
      { id: v.data.id, status: v.data.status },
      "Processing sale",
    );
    return salesService.processSale(v.data as SaleRequest);
  });

  // Get Drafts
  ipcMain.handle("sales:get-drafts", () => {
    salesLogger.debug("Getting drafts");
    return salesService.getDrafts();
  });

  // Delete Draft
  ipcMain.handle("sales:delete-draft", (_event, saleId: number) => {
    salesLogger.debug({ saleId }, "Deleting draft");
    return salesService.deleteDraft(saleId);
  });

  // Dashboard Stats
  ipcMain.handle("sales:get-dashboard-stats", () => {
    return salesService.getDashboardStats();
  });

  // Chart Data (Sales or Profit for last 30 days)
  ipcMain.handle(
    "dashboard:get-profit-sales-chart",
    (_event, type: "Sales" | "Profit") => {
      salesLogger.debug({ type }, "Getting chart data");
      return salesService.getChartData(type);
    },
  );

  // Drawer Balances
  ipcMain.handle("dashboard:get-drawer-balances", () => {
    return salesService.getDrawerBalances();
  });

  // Today's Sales or specific date sales
  ipcMain.handle("sales:get-todays-sales", (_event, date?: string) => {
    return salesService.getTodaysSales(date);
  });

  // Top Products
  ipcMain.handle("sales:get-top-products", () => {
    return salesService.getTopProducts();
  });

  // Get Sale by ID
  ipcMain.handle("sales:get", (_event, saleId: number) => {
    salesLogger.debug({ saleId }, "Getting sale by ID");
    return salesService.getSale(saleId);
  });

  // Get Sale Items by Sale ID
  ipcMain.handle("sales:get-items", (_event, saleId: number) => {
    salesLogger.debug({ saleId }, "Getting sale items");
    return salesService.getSaleItems(saleId);
  });

  // Refund a sale by sale ID (admin only)
  ipcMain.handle("sales:refund", (e, saleId: number) => {
    if (typeof saleId !== "number" || saleId < 1 || !Number.isInteger(saleId)) {
      return { success: false, error: "Invalid sale ID" };
    }
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");
      const userId = auth.userId ?? 1;
      const txnService = getTransactionService();
      const refundId = txnService.refundBySaleId(saleId, userId);
      return { success: true, refundId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Refund a specific item from a sale (admin only)
  ipcMain.handle(
    "sales:refund-item",
    (
      e,
      params: { saleId: number; saleItemId: number; refundQuantity: number },
    ) => {
      // Validation
      if (typeof params.saleId !== "number" || params.saleId < 1) {
        return { success: false, error: "Invalid sale ID" };
      }
      if (typeof params.saleItemId !== "number" || params.saleItemId < 1) {
        return { success: false, error: "Invalid sale item ID" };
      }
      if (
        typeof params.refundQuantity !== "number" ||
        params.refundQuantity < 1
      ) {
        return { success: false, error: "Invalid refund quantity" };
      }

      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) {
          throw new Error(auth.error ?? "Admin access required");
        }
        const userId = auth.userId ?? 1;

        const salesService = getSalesService();
        const result = salesService.refundSaleItem({
          saleId: params.saleId,
          saleItemId: params.saleItemId,
          refundQuantity: params.refundQuantity,
          userId,
        });

        return result;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Get sales by date range (for reports)
  ipcMain.handle(
    "sales:get-by-date-range",
    (_event, startDate: string, endDate: string) => {
      salesLogger.debug({ startDate, endDate }, "Getting sales by date range");
      return salesService.findByDateRange(startDate, endDate);
    },
  );
}
