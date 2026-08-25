/**
 * Product Unit IPC Handlers (LIRA-143 Phase 5 — phone IMEI units &
 * warranty, current_sprint.md, owner-interviewed 2026-08-23).
 *
 * Thin wrapper over `ProductUnitService` — the intake/read API surface over
 * the per-IMEI phone unit tracker (`ProductUnitRepository`, Phase 2).
 *
 * Auth mirrors `inventoryHandlers.ts`: reads (`for-product`, `summary`,
 * `story`, `for-sale-items`) carry NO `requireRole` gate, same as
 * `inventory:get-products`/`inventory:get-product-by-barcode` — they carry
 * no write-side risk and every renderer that can reach the IPC bridge is
 * already an authenticated app session. `register`/`delete` are
 * stock-adjacent writes and mirror `inventory:adjust-stock`'s
 * admin-or-staff gate exactly.
 */

import { ipcMain } from "electron";
import { getProductUnitService, inventoryLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  RegisterProductUnitsSchema,
  ProductUnitsForProductSchema,
  ProductUnitsSummarySchema,
  ProductUnitIdSchema,
  UnitStoryQuerySchema,
  UnitsForSaleItemsSchema,
} from "../schemas/index.js";

let _productUnitService: ReturnType<typeof getProductUnitService> | null =
  null;

function getProductUnitServiceInstance() {
  if (!_productUnitService) {
    _productUnitService = getProductUnitService();
  }
  return _productUnitService;
}

export function registerProductUnitHandlers(): void {
  // Intake — register one or more IMEI units against a product model.
  // Admin/staff, same gate as inventory:adjust-stock (stock-adjacent write).
  ipcMain.handle("product-units:register", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const validation = validatePayload(RegisterProductUnitsSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = getProductUnitServiceInstance().registerUnits(
        validation.data.product_id,
        validation.data.imeis,
      );
      audit(event.sender.id, {
        action: "create",
        entity_type: "product_unit",
        entity_id: String(validation.data.product_id),
        summary: `Registered ${result.units.length} IMEI unit(s) for product #${validation.data.product_id}`,
        metadata: { drift: result.drift },
      });
      return { success: true, data: result };
    } catch (error) {
      inventoryLogger.error({ error }, "product-units:register failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to register product units",
      };
    }
  });

  // All units for a product, optionally filtered by status.
  ipcMain.handle("product-units:for-product", (_event, data: unknown) => {
    try {
      const validation = validatePayload(ProductUnitsForProductSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = getProductUnitServiceInstance().getUnitsForProduct(
        validation.data.productId,
        validation.data.status,
      );
      return { success: true, data: result };
    } catch (error) {
      inventoryLogger.error({ error }, "product-units:for-product failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load product units",
      };
    }
  });

  // Batched per-product IN_STOCK/SOLD/defective rollup.
  ipcMain.handle("product-units:summary", (_event, data: unknown) => {
    try {
      const validation = validatePayload(ProductUnitsSummarySchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = getProductUnitServiceInstance().getSummaryForProducts(
        validation.data.product_ids,
      );
      return { success: true, data: result };
    } catch (error) {
      inventoryLogger.error({ error }, "product-units:summary failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load product unit summary",
      };
    }
  });

  // Delete an intake mistake (IN_STOCK only). Admin/staff, same gate as
  // inventory:adjust-stock.
  ipcMain.handle("product-units:delete", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const validation = validatePayload(ProductUnitIdSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      getProductUnitServiceInstance().deleteUnit(validation.data.id);
      audit(event.sender.id, {
        action: "delete",
        entity_type: "product_unit",
        entity_id: String(validation.data.id),
        summary: `Deleted product unit #${validation.data.id}`,
      });
      return { success: true };
    } catch (error) {
      inventoryLogger.error({ error }, "product-units:delete failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete product unit",
      };
    }
  });

  // The walk-in lookup (decision #7) — every unit matching an IMEI, each
  // warranty-stamped.
  ipcMain.handle("product-units:story", (_event, data: unknown) => {
    try {
      const validation = validatePayload(UnitStoryQuerySchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = getProductUnitServiceInstance().getUnitStory(
        validation.data.imei,
      );
      return { success: true, data: result };
    } catch (error) {
      inventoryLogger.error({ error }, "product-units:story failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load unit story",
      };
    }
  });

  // Phase 6 refund UI — the units linked to a sale being refunded (imei +
  // defective checkbox + warranty-override date per unit).
  ipcMain.handle("product-units:for-sale-items", (_event, data: unknown) => {
    try {
      const validation = validatePayload(UnitsForSaleItemsSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = getProductUnitServiceInstance().getUnitsForSaleItems(
        validation.data.sale_item_ids,
      );
      return { success: true, data: result };
    } catch (error) {
      inventoryLogger.error(
        { error },
        "product-units:for-sale-items failed",
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load units for sale items",
      };
    }
  });
}
