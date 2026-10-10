/**
 * Warranty IPC Handlers (LIRA-296 — warranty for any item).
 *
 * Desktop twin of `backend/src/api/warranty.ts`: both call the SAME core
 * `WarrantyService` with the SAME shared schemas (rules 14 and 19).
 *
 * P1: `warranty:search` (admin, staff) — find warranty lines by customer,
 * phone, receipt number, product or serial/IMEI.
 * P2: `warranty:claim` / `warranty:claims-for` (admin, staff — the service
 * keeps REPLACE/REFUND admin-only), `warranty:void-claim`,
 * `warranty:defective`, `warranty:defective-resolve` (admin). The actor
 * (user id + role) always comes from the session, never the payload.
 */
import { ipcMain } from "electron";
import { getWarrantyService, warrantyLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import {
  validatePayload,
  WarrantySearchSchema,
  CreateWarrantyClaimSchema,
  WarrantyClaimsForSchema,
  VoidWarrantyClaimSchema,
  ListDefectiveItemsSchema,
  ResolveDefectiveSchema,
} from "../schemas/index.js";
import { audit } from "./auditHelper.js";

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export function registerWarrantyHandlers(): void {
  ipcMain.handle("warranty:search", (event, payload: unknown) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(WarrantySearchSchema, payload);
    if (!v.ok) return { success: false, error: v.error };
    try {
      return { success: true, data: getWarrantyService().search(v.data) };
    } catch (error) {
      warrantyLogger.error({ error }, "warranty:search failed");
      return {
        success: false,
        error: errorMessage(error, "Failed to search warranties"),
      };
    }
  });

  ipcMain.handle("warranty:claim", (event, payload: unknown) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(CreateWarrantyClaimSchema, payload);
    if (!v.ok) return { success: false, error: v.error };
    const result = getWarrantyService().createClaim(v.data, {
      userId: auth.userId,
      role: auth.role,
    });
    if (result.success) {
      audit(event.sender.id, {
        action: "create",
        entity_type: "warranty_claim",
        entity_id: String(result.data.claim.id),
        summary: `Warranty claim #${result.data.claim.id} (${result.data.claim.action})`,
      });
    }
    return result;
  });

  ipcMain.handle("warranty:claims-for", (event, payload: unknown) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(WarrantyClaimsForSchema, payload);
    if (!v.ok) return { success: false, error: v.error };
    try {
      return { success: true, data: getWarrantyService().claimsFor(v.data) };
    } catch (error) {
      warrantyLogger.error({ error }, "warranty:claims-for failed");
      return {
        success: false,
        error: errorMessage(error, "Failed to load claims"),
      };
    }
  });

  ipcMain.handle("warranty:void-claim", (event, payload: unknown) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(VoidWarrantyClaimSchema, payload);
    if (!v.ok) return { success: false, error: v.error };
    const result = getWarrantyService().voidClaim(v.data, {
      userId: auth.userId,
      role: auth.role,
    });
    if (result.success) {
      audit(event.sender.id, {
        action: "delete",
        entity_type: "warranty_claim",
        entity_id: String(v.data.claim_id),
        summary: `Voided warranty claim #${v.data.claim_id}`,
      });
    }
    return result;
  });

  ipcMain.handle("warranty:defective", (event, payload: unknown) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(ListDefectiveItemsSchema, payload ?? {});
    if (!v.ok) return { success: false, error: v.error };
    try {
      return {
        success: true,
        data: getWarrantyService().listDefective(v.data),
      };
    } catch (error) {
      warrantyLogger.error({ error }, "warranty:defective failed");
      return {
        success: false,
        error: errorMessage(error, "Failed to load defective items"),
      };
    }
  });

  ipcMain.handle("warranty:defective-resolve", (event, payload: unknown) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const v = validatePayload(ResolveDefectiveSchema, payload);
    if (!v.ok) return { success: false, error: v.error };
    const result = getWarrantyService().resolveDefective(v.data, {
      userId: auth.userId,
      role: auth.role,
    });
    if (result.success) {
      audit(event.sender.id, {
        action: "update",
        entity_type: "defective_item",
        entity_id: String(v.data.defective_item_id),
        summary: `Defective item #${v.data.defective_item_id}: ${v.data.outcome}`,
      });
    }
    return result;
  });
}
