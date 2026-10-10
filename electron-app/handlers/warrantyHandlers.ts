/**
 * Warranty IPC Handlers (LIRA-296 — warranty for any item).
 *
 * Desktop twin of `backend/src/api/warranty.ts`: both call the SAME core
 * `WarrantyService` with the SAME shared schemas (rules 14 and 19).
 *
 * P1: `warranty:search` (admin, staff) — find warranty lines by customer,
 * phone, receipt number, product or serial/IMEI.
 */
import { ipcMain } from "electron";
import { getWarrantyService, warrantyLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { validatePayload, WarrantySearchSchema } from "../schemas/index.js";

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
}
