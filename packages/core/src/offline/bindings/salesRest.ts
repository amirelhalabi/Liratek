/**
 * Offline bindings — sales family, the rest (LIRA-306 T079). Each calls the
 * SAME core service method its REST route calls (`backend/src/api/sales.ts`),
 * with the actor from the event (O-new-7), never a payload field.
 * `sales:process` lives in `sales.ts` (US1).
 */
import { getSalesService } from "../../services/SalesService.js";
import { getTransactionService } from "../../services/TransactionService.js";
import type {
  SaleRefundInput,
  SaleRefundItemInput,
  SaleUndoItemRefundInput,
  SaleUpdateMetadataInput,
} from "../../validators/sale.js";
import { actorUsername } from "./actor.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** `{ kept_change_usd, kept_change_lbp }` (wire) → `{ usd, lbp }` (service) — same mapping as both routes. */
function keptChange(k: SaleRefundInput["keptChange"] | null) {
  return k ? { usd: k.kept_change_usd, lbp: k.kept_change_lbp } : undefined;
}

/** DELETE /api/sales/drafts/:id → deleteDraft(saleId) */
const deleteDraft: OfflineBinding = {
  channel: "sales:delete-draft",
  run: (payload) => getSalesService().deleteDraft(Number(payload.saleId)) as unknown as BindingResult,
};

/** POST /api/sales/:id/refund → refundBySaleId(saleId, userId, opts); returns { success, refundId } */
const refund: OfflineBinding = {
  channel: "sales:refund",
  run: (payload, ctx) => {
    const p = payload as unknown as SaleRefundInput;
    const refundId = getTransactionService().refundBySaleId(p.saleId, ctx.actorUserId, {
      refundLegs: p.refundLegs,
      refundUnitExtras: p.unitExtras,
      exchangeRate: p.exchangeRate,
      keptChange: keptChange(p.keptChange),
    });
    return { success: true, refundId };
  },
  mainRow: (r) => (typeof r.refundId === "number" ? { table: "transactions", id: r.refundId } : null),
};

/** POST /api/sales/:id/refund-item → refundSaleItem({ ..., userId }) */
const refundItem: OfflineBinding = {
  channel: "sales:refund-item",
  run: (payload, ctx) => {
    const p = payload as unknown as SaleRefundItemInput;
    return getSalesService().refundSaleItem({
      saleId: p.saleId,
      saleItemId: p.saleItemId,
      refundQuantity: p.refundQuantity,
      refundLegs: p.refundLegs,
      unitExtras: p.unitExtras,
      exchangeRate: p.exchangeRate,
      keptChange: keptChange(p.keptChange),
      userId: ctx.actorUserId,
    }) as unknown as BindingResult;
  },
};

/** POST /api/sales/undo-item-refund → undoItemRefund({ refundTransactionId, userId }) */
const undoItemRefund: OfflineBinding = {
  channel: "sales:undo-item-refund",
  run: (payload, ctx) =>
    getSalesService().undoItemRefund({
      refundTransactionId: (payload as unknown as SaleUndoItemRefundInput).refundTransactionId,
      userId: ctx.actorUserId,
    }) as unknown as BindingResult,
};

/** POST /api/sales/update-metadata — `editedBy` = the actor's username. */
const updateMetadata: OfflineBinding = {
  channel: "sales:update-metadata",
  run: (payload, ctx) => {
    const p = payload as unknown as SaleUpdateMetadataInput;
    const result = getSalesService().updateSaleMetadata(
      p.id,
      {
        ...(p.note !== undefined ? { note: p.note } : {}),
        ...(p.client_name !== undefined ? { client_name: p.client_name } : {}),
        ...(p.client_phone !== undefined ? { client_phone: p.client_phone } : {}),
      },
      actorUsername(ctx.actorUserId),
    );
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

export const SALES_REST_BINDINGS: readonly OfflineBinding[] = [deleteDraft, refund, refundItem, undoItemRefund, updateMetadata];
