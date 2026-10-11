/**
 * Offline bindings — stock family (LIRA-306, T099). Each calls the SAME core
 * service the REST route calls, with the actor from the event instead of the
 * JWT (E2, O-new-7):
 *   - POST   /api/inventory/products/:id/stock         → adjustStockDelta(id, delta, reason, userId)
 *                                                       | adjustStock(id, newQuantity, reason, userId)
 *   - POST   /api/inventory/products/:id/receive-stock → receiveStock({ ...body, product_id, userId })
 *     (an `attach_to_recorded_debt_id` attaches the delivery to the supplier's
 *     recorded debt inside the same service call — the supplier-ledger side
 *     effect replays with it)
 *   - POST   /api/product-units/register               → registerUnits(product_id, imeis)  (no actor)
 *   - DELETE /api/product-units/:id                    → deleteUnit(id)                    (no actor)
 */
import { getInventoryService } from "../../services/InventoryService.js";
import { getProductUnitService } from "../../services/ProductUnitService.js";
import type { ReceiveStockInput, StockAdjustInput } from "../../validators/inventory.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** Same message the REST route answers with (backend/src/api/productUnits.ts). */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

const adjustStock: OfflineBinding = {
  channel: "inventory:adjust-stock",
  run: (payload, ctx) => {
    const { id, newQuantity, delta, reason } = payload as unknown as StockAdjustInput;
    const service = getInventoryService();
    return (
      delta !== undefined
        ? service.adjustStockDelta(id, delta, reason, ctx.actorUserId)
        : service.adjustStock(id, newQuantity as number, reason, ctx.actorUserId)
    ) as unknown as BindingResult;
  },
};

const receiveStock: OfflineBinding = {
  channel: "inventory:receive-stock",
  run: (payload, ctx) =>
    getInventoryService().receiveStock({
      ...(payload as unknown as ReceiveStockInput),
      userId: ctx.actorUserId,
    }) as unknown as BindingResult,
};

const registerUnits: OfflineBinding = {
  channel: "product-units:register",
  run: (payload) => {
    const p = payload as { product_id: number; imeis: string[] };
    try {
      return { success: true, data: getProductUnitService().registerUnits(p.product_id, p.imeis) };
    } catch (err) {
      return { success: false, error: errMessage(err) };
    }
  },
};

const deleteUnit: OfflineBinding = {
  channel: "product-units:delete",
  run: (payload) => {
    try {
      getProductUnitService().deleteUnit((payload as { id: number }).id);
      return { success: true };
    } catch (err) {
      return { success: false, error: errMessage(err) };
    }
  },
};

export const STOCK_BINDINGS: readonly OfflineBinding[] = [adjustStock, receiveStock, registerUnits, deleteUnit];
