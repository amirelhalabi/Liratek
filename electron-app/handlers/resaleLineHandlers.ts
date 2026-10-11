/**
 * Resale (for-sale) phone line IPC handlers — LIRA-309.
 *
 * Thin wrapper over `ResaleLineService`. Mirrors the REST routes in
 * `backend/src/api/resaleLines.ts` (rule 19): both validate with the same
 * core schema and return the same `{ success, data?, error? }` envelope.
 *
 * Auth: the list carries no role gate (an authenticated session may read it,
 * like `carrier-lines:get-all-active` — the Mobile Recharge page needs it to
 * recognise the shop's own numbers). Saving a line's details is admin-only,
 * matching the carrier-line write handlers.
 */

import { ipcMain } from "electron";
import { getResaleLineService, inventoryLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  ListResaleLinesQuerySchema,
  SaveResaleLineSchema,
} from "../schemas/index.js";

export function registerResaleLineHandlers(): void {
  const service = getResaleLineService();

  ipcMain.handle("resale-lines:list", (_event, query: unknown) => {
    try {
      const v = validatePayload(ListResaleLinesQuerySchema, query ?? {});
      if (!v.ok) return { success: false, error: v.error };
      return { success: true, data: service.listLines(v.data) };
    } catch (error) {
      inventoryLogger.error({ error }, "resale-lines:list failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load phone lines",
      };
    }
  });

  ipcMain.handle("resale-lines:save", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(SaveResaleLineSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = service.saveDetails(v.data);
      if (result.success) {
        audit(event.sender.id, {
          action: "update",
          entity_type: "resale_line",
          entity_id: String(v.data.product_id),
          summary: `Saved phone line details for product #${v.data.product_id}`,
          metadata: {
            carrier: v.data.carrier,
            validity_expires_at: v.data.validity_expires_at ?? null,
            credits: v.data.credits ?? null,
          },
        });
      }
      return result;
    } catch (error) {
      inventoryLogger.error({ error }, "resale-lines:save failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save phone line details",
      };
    }
  });
}
