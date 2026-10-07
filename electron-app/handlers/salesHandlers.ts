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
  getUserRepository,
} from "@liratek/core";
import type { SaleRequest } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  SaleProcessSchema,
  SaleUpdateMetadataSchema,
  SaleRefundSchema,
  SaleRefundItemSchema,
  SaleUndoItemRefundSchema,
  SaleRefundPreviewSchema,
  DashboardChartQuerySchema,
  NetProfitWindowQuerySchema,
  validatePayload,
} from "../schemas/index.js";

export function registerSalesHandlers(): void {
  const salesService = getSalesService();

  // Process a sale (create or update)
  ipcMain.handle("sales:process", (event, sale: SaleRequest) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(SaleProcessSchema, sale);
    if (!v.ok) return { success: false, error: v.error };
    salesLogger.debug(
      { id: v.data.id, status: v.data.status },
      "Processing sale",
    );
    const result = salesService.processSale(v.data as SaleRequest, auth.userId);
    // Only audit a sale that actually committed — a guarded/failed sale
    // (e.g. out of stock) returns { success:false } and is rolled back.
    if (result.success) {
      audit(event.sender.id, {
        action: "create",
        entity_type: "sale",
        entity_id: String((result as any)?.id ?? ""),
        summary: `Processed sale (status: ${v.data.status})`,
        metadata: { status: v.data.status, itemCount: v.data.items?.length },
      });
    }
    return result;
  });

  // Get Drafts
  ipcMain.handle("sales:get-drafts", () => {
    salesLogger.debug("Getting drafts");
    return salesService.getDrafts();
  });

  // Delete Draft (LIRA-234: same roles as sales:process — any authenticated
  // session could previously cancel ANY draft, and a refused delete was
  // still audited as if it had succeeded).
  ipcMain.handle("sales:delete-draft", (event, saleId: number) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!Number.isInteger(saleId) || saleId < 1) {
      return { success: false, error: "Invalid sale ID" };
    }
    salesLogger.debug({ saleId }, "Deleting draft");
    const result = salesService.deleteDraft(saleId);
    // Only audit a delete that actually committed (same pattern as
    // sales:process above) — a refused delete (not a draft / not found)
    // must not leave a phantom "Deleted draft" audit row.
    if (result.success) {
      audit(event.sender.id, {
        action: "delete",
        entity_type: "sale",
        entity_id: String(saleId),
        summary: `Deleted draft sale #${saleId}`,
      });
    }
    return result;
  });

  // Dashboard Stats
  ipcMain.handle("sales:get-dashboard-stats", () => {
    return salesService.getDashboardStats();
  });

  // Chart Data (Sales or Profit for last 30 days). `clientDay` is the
  // renderer's OWN calendar day (rule 27, DC-10) — read-only handler, so a
  // malformed value degrades to "omitted" (server-side clientDay()
  // fallback) rather than failing the whole read (electron-app/CLAUDE.md:
  // "read-only handlers — validation optional but recommended").
  ipcMain.handle(
    "dashboard:get-profit-sales-chart",
    (_event, type: "Sales" | "Profit", clientDay?: string) => {
      const v = validatePayload(DashboardChartQuerySchema, {
        type,
        client_day: clientDay,
      });
      const safeType = v.ok ? v.data.type : type === "Profit" ? "Profit" : "Sales";
      const safeDay = v.ok ? v.data.client_day : undefined;
      salesLogger.debug({ type: safeType }, "Getting chart data");
      return salesService.getChartData(safeType, safeDay);
    },
  );

  // DC-11 — "Net Profit — last 30 days" tile.
  ipcMain.handle(
    "dashboard:get-net-profit-last-30-days",
    (_event, clientDay?: string) => {
      const v = validatePayload(NetProfitWindowQuerySchema, {
        client_day: clientDay,
      });
      const safeDay = v.ok ? v.data.client_day : undefined;
      return salesService.getNetProfitLast30Days(safeDay);
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

  // Refund a sale by sale ID (admin only). LIRA-231: an optional
  // `refundLegs` field carries the operator's chosen return method(s) — same
  // LIRA-078 contract the Transactions page uses (rule 14). Omitting it
  // reproduces the pre-existing default reversal, byte-identical.
  //
  // 2026-09-26: an optional `unitExtras` 4th positional arg carries the POS
  // "Returned phones" per-unit defective/warranty-override flags — same
  // "Returned phones" UI RefundMethodModal already renders on the
  // Transactions page, now also reachable here (rule 14 — reused schema,
  // reused `TransactionRepository.refundBySaleId` forwarding).
  ipcMain.handle(
    "sales:refund",
    (
      e,
      saleId: number,
      refundLegs?: unknown,
      unitExtras?: unknown,
      exchangeRate?: unknown,
      // Owner decision 2026-10-07 — refund kept change (5th positional).
      keptChange?: unknown,
    ) => {
      const v = validatePayload(SaleRefundSchema, {
        saleId,
        refundLegs,
        unitExtras,
        exchangeRate,
        keptChange: keptChange ?? undefined,
      });
      if (!v.ok) return { success: false, error: v.error };
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error);
        const userId = auth.userId;
        const txnService = getTransactionService();
        const refundId = txnService.refundBySaleId(v.data.saleId, userId, {
          refundLegs: v.data.refundLegs,
          refundUnitExtras: v.data.unitExtras,
          exchangeRate: v.data.exchangeRate,
          keptChange: v.data.keptChange
            ? {
                usd: v.data.keptChange.kept_change_usd,
                lbp: v.data.keptChange.kept_change_lbp,
              }
            : undefined,
        });
        audit(e.sender.id, {
          action: "refund",
          entity_type: "sale",
          entity_id: String(v.data.saleId),
          summary: `Refunded sale #${v.data.saleId}`,
          metadata: {
            refundId,
            refundLegs: v.data.refundLegs,
            unitExtras: v.data.unitExtras,
            exchangeRate: v.data.exchangeRate,
            keptChange: v.data.keptChange,
          },
        });
        return { success: true, refundId };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Refund a specific item from a sale (admin only). LIRA-231: same optional
  // `refundLegs` override, validated against this ITEM's proportional share
  // by the repository.
  //
  // 2026-09-26: same optional `unitExtras` — validated by
  // `SalesRepository.refundSaleItem` against THIS ITEM's own linked units
  // only (never the whole sale's).
  ipcMain.handle(
    "sales:refund-item",
    (
      e,
      params: {
        saleId: number;
        saleItemId: number;
        refundQuantity: number;
        refundLegs?: unknown;
        unitExtras?: unknown;
        exchangeRate?: unknown;
        // Owner decision 2026-10-07 — refund kept change.
        keptChange?: unknown;
      },
    ) => {
      const v = validatePayload(SaleRefundItemSchema, params);
      if (!v.ok) return { success: false, error: v.error };

      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) {
          throw new Error(auth.error);
        }
        const userId = auth.userId;

        const result = salesService.refundSaleItem({
          saleId: v.data.saleId,
          saleItemId: v.data.saleItemId,
          refundQuantity: v.data.refundQuantity,
          refundLegs: v.data.refundLegs,
          unitExtras: v.data.unitExtras,
          exchangeRate: v.data.exchangeRate,
          keptChange: v.data.keptChange
            ? {
                usd: v.data.keptChange.kept_change_usd,
                lbp: v.data.keptChange.kept_change_lbp,
              }
            : undefined,
          userId,
        });
        audit(e.sender.id, {
          action: "refund",
          entity_type: "sale_item",
          entity_id: String(v.data.saleItemId),
          summary: `Refunded ${v.data.refundQuantity}x item #${v.data.saleItemId} from sale #${v.data.saleId}`,
          metadata: {
            saleId: v.data.saleId,
            refundQuantity: v.data.refundQuantity,
            refundLegs: v.data.refundLegs,
            unitExtras: v.data.unitExtras,
            exchangeRate: v.data.exchangeRate,
            keptChange: v.data.keptChange,
          },
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

  // LIRA-147 — admin-only "Undo refund" for a standalone per-item refund.
  // Same `["admin"]`-only gate as the refund action itself.
  ipcMain.handle(
    "sales:undo-item-refund",
    (e, params: { refundTransactionId: number }) => {
      const v = validatePayload(SaleUndoItemRefundSchema, params);
      if (!v.ok) return { success: false, error: v.error };

      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) {
          throw new Error(auth.error);
        }
        const userId = auth.userId;

        const result = salesService.undoItemRefund({
          refundTransactionId: v.data.refundTransactionId,
          userId,
        });
        if (result.success) {
          audit(e.sender.id, {
            action: "refund",
            entity_type: "transaction",
            entity_id: String(v.data.refundTransactionId),
            summary: `Undid refund #${v.data.refundTransactionId}`,
            metadata: { refundTransactionId: v.data.refundTransactionId },
          });
        }

        return result;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // LIRA-231 — POS refund preview (admin only, same gate as the refund
  // actions themselves): the sale's (or one item's proportional share of
  // the sale's) own customer-facing payment legs, plus whether the sale is
  // session-linked. Read-only.
  ipcMain.handle(
    "sales:refund-preview",
    (
      e,
      params: {
        saleId: number;
        item?: { saleItemId: number; refundQuantity: number };
      },
    ) => {
      const v = validatePayload(SaleRefundPreviewSchema, params);
      if (!v.ok) return { success: false, error: v.error };
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
      return salesService.getRefundPreview(v.data.saleId, v.data.item);
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

  // Update sale metadata (staff and admin)
  ipcMain.handle(
    "sales:update-metadata",
    (
      event,
      data: {
        id: number;
        note?: string;
        // RCP-1 walk-in rename — applied only to walk-in sales by the service.
        client_name?: string;
        client_phone?: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(SaleUpdateMetadataSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      let editedBy = `user-${auth.userId}`;
      try {
        const userRepo = getUserRepository();
        const user = userRepo.findById(auth.userId);
        if (user) editedBy = user.username;
      } catch {
        // fallback to user-{id}
      }

      const result = salesService.updateSaleMetadata(
        v.data.id,
        {
          ...(v.data.note !== undefined ? { note: v.data.note } : {}),
          ...(v.data.client_name !== undefined
            ? { client_name: v.data.client_name }
            : {}),
          ...(v.data.client_phone !== undefined
            ? { client_phone: v.data.client_phone }
            : {}),
        },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(event.sender.id, {
          action: "edit_metadata",
          entity_type: "sale",
          entity_id: String(data.id),
          summary: `Edited sale #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );
}
