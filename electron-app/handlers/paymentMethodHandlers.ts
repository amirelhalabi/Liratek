/**
 * Payment Method IPC Handlers
 *
 * Registers Electron IPC handlers for payment method CRUD operations.
 */

import { ipcMain } from "electron";
import { getPaymentMethodService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  PaymentMethodCreateSchema,
  PaymentMethodUpdateSchema,
} from "../schemas/index.js";

const log = settingsLogger.child({ sub: "paymentMethodHandlers" });

export function registerPaymentMethodHandlers(): void {
  const service = getPaymentMethodService();

  // List all payment methods (including inactive)
  ipcMain.handle("payment-methods:list", () => {
    return service.listAll();
  });

  // List active payment methods only
  ipcMain.handle("payment-methods:list-active", () => {
    return service.listActive();
  });

  // Create a new payment method (admin only)
  ipcMain.handle("payment-methods:create", (e, payload: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    // LIRA-297: same core schema as POST /api/payment-methods (rule 14).
    const v = validatePayload(PaymentMethodCreateSchema, payload);
    if (!v.ok) return { success: false, error: v.error };
    const data = v.data;
    log.info({ code: data.code }, "Creating payment method");
    const result = service.create(data);
    audit(e.sender.id, {
      action: "create",
      entity_type: "payment_method",
      summary: `Created payment method "${data.code}"`,
    });
    return result;
  });

  // Update a payment method (admin only)
  ipcMain.handle(
    "payment-methods:update",
    (e, id: number, payload: unknown) => {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
      // LIRA-297: same core schema as PUT /api/payment-methods/:id.
      const v = validatePayload(PaymentMethodUpdateSchema, payload);
      if (!v.ok) return { success: false, error: v.error };
      const data = v.data;
      log.info({ id, data }, "Updating payment method");
      const result = service.update(id, data);
      audit(e.sender.id, {
        action: "update",
        entity_type: "payment_method",
        entity_id: String(id),
        summary: `Updated payment method #${id}`,
      });
      return result;
    },
  );

  // Delete a payment method (admin only, non-system only)
  ipcMain.handle("payment-methods:delete", (e, id: number) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    log.info({ id }, "Deleting payment method");
    const result = service.delete(id);
    audit(e.sender.id, {
      action: "delete",
      entity_type: "payment_method",
      entity_id: String(id),
      summary: `Deleted payment method #${id}`,
    });
    return result;
  });

  // Reorder payment methods (admin only)
  ipcMain.handle("payment-methods:reorder", (e, ids: number[]) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    log.info({ ids }, "Reordering payment methods");
    const result = service.reorder(ids);
    audit(e.sender.id, {
      action: "update",
      entity_type: "payment_method",
      summary: `Reordered ${ids.length} payment methods`,
    });
    return result;
  });
}
