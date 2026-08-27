/**
 * Carrier Line IPC Handlers (LIRA W6.a)
 *
 * Shop-owned alfa/mtc SIM lines: remaining credits + validity expiry.
 *
 * Every channel here is informational — no drawer legs, no checkout/closing
 * involvement — with ONE exception: `carrier-lines:record-usage` (LIRA-145)
 * is a money write. It books a `Line_Usage` expense, moves the carrier's
 * credit drawer, and writes a linked `carrier_line_movements` row. Treat it
 * under the money rules (FEATURE_GUIDE §13), not as a balance edit.
 */

import { ipcMain } from "electron";
import {
  getCarrierLineService,
  getCarrierLineRepository,
  type CreateCarrierLineData,
  type UpdateCarrierLineData,
  type UpdateBalanceData,
  type CarrierKey,
  type RecordCarrierLineUsageData,
} from "@liratek/core";
import { financialLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import {
  validatePayload,
  CarrierLineCreateSchema,
  CarrierLineUpdateSchema,
  CarrierLineUpdateBalanceSchema,
  RecordCarrierLineUsageSchema,
} from "../schemas/index.js";
import { audit } from "./auditHelper.js";

export function registerCarrierLineHandlers(): void {
  const service = getCarrierLineService();

  // Active lines for one carrier — the Recharge-tab compact panel. Read-only,
  // no role gate (mirrors other read handlers, e.g. inventory's reports).
  ipcMain.handle(
    "carrier-lines:get-active-by-carrier",
    (_event, carrier: CarrierKey) => {
      try {
        const data = service.getActiveByCarrier(carrier);
        return { success: true, data };
      } catch (error) {
        financialLogger.error(
          { error },
          "carrier-lines:get-active-by-carrier failed",
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get lines",
        };
      }
    },
  );

  ipcMain.handle("carrier-lines:get-all-active", () => {
    try {
      const data = service.getAllActive();
      return { success: true, data };
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:get-all-active failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get lines",
      };
    }
  });

  // Admin listing (includes archived) — the Settings manager.
  ipcMain.handle("carrier-lines:get-all-admin", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const data = service.getAllIncludingInactive();
      return { success: true, data };
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:get-all-admin failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get lines",
      };
    }
  });

  ipcMain.handle("carrier-lines:create", (e, data: CreateCarrierLineData) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(CarrierLineCreateSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = service.create(v.data);
      audit(e.sender.id, {
        action: "create",
        entity_type: "carrier_line",
        summary: `Added ${v.data.carrier} carrier line ${v.data.phone_number}`,
      });
      return result;
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:create failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create",
      };
    }
  });

  ipcMain.handle(
    "carrier-lines:update",
    (e, id: number, data: UpdateCarrierLineData) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const v = validatePayload(CarrierLineUpdateSchema, { ...data, id });
        if (!v.ok) return { success: false, error: v.error };

        const { id: _id, ...rest } = v.data;
        const result = service.update(id, rest);
        audit(e.sender.id, {
          action: "update",
          entity_type: "carrier_line",
          entity_id: String(id),
          summary: `Updated carrier line #${id}`,
        });
        return result;
      } catch (error) {
        financialLogger.error({ error }, "carrier-lines:update failed");
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update",
        };
      }
    },
  );

  // Recharge-tab inline quick-update: credits and/or a new expiry date.
  // admin + staff — staff process day-to-day recharges and need to keep the
  // panel current.
  ipcMain.handle(
    "carrier-lines:update-balance",
    (e, id: number, data: UpdateBalanceData) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const v = validatePayload(CarrierLineUpdateBalanceSchema, {
          ...data,
          id,
        });
        if (!v.ok) return { success: false, error: v.error };

        const { id: _id, ...rest } = v.data;
        const result = service.updateBalance(id, rest);
        audit(e.sender.id, {
          action: "update",
          entity_type: "carrier_line",
          entity_id: String(id),
          summary: `Updated carrier line #${id} balance`,
        });
        return result;
      } catch (error) {
        financialLogger.error({ error }, "carrier-lines:update-balance failed");
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update",
        };
      }
    },
  );

  // LIRA-145: record CONSUMPTION of a line's credits as an expense.
  //
  // NOT a balance edit — `update-balance` above silently overwrites `credits`
  // and books nothing. This one books the difference as a `Line_Usage`
  // expense at face value ($1/credit, USD), debits the carrier's credit
  // drawer for it (no cash moves), and writes the `carrier_line_movements`
  // row linked to the expense's unified transaction — that linkage is what
  // makes the generic void path restore the line automatically (rule 20).
  //
  // admin + staff: same gate as `expenses:update-metadata` (dbHandlers.ts) and
  // as `update-balance` — staff run the day-to-day recharges these credits
  // are consumed by. All rejections (line missing/archived, stale
  // `expectedCurrentCredits`, non-positive delta) are SERVER decisions inside
  // the repository's db transaction; the schema only guards the shape.
  ipcMain.handle(
    "carrier-lines:record-usage",
    (e, data: RecordCarrierLineUsageData) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const v = validatePayload(RecordCarrierLineUsageSchema, data);
        if (!v.ok) return { success: false, error: v.error };

        const result = service.recordUsage(v.data, auth.userId);
        if (result.success && result.data) {
          audit(e.sender.id, {
            action: "update",
            entity_type: "carrier_line",
            entity_id: String(v.data.carrierLineId),
            summary: `Recorded $${result.data.creditsUsed} usage on carrier line #${v.data.carrierLineId}`,
            metadata: {
              expense_id: result.data.expenseId,
              transaction_id: result.data.transactionId,
              credits_used: result.data.creditsUsed,
              new_credits: result.data.newCredits,
            },
          });
        }
        return result;
      } catch (error) {
        financialLogger.error({ error }, "carrier-lines:record-usage failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to record usage",
        };
      }
    },
  );

  ipcMain.handle("carrier-lines:archive", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const result = service.archive(id);
      audit(e.sender.id, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Archived carrier line #${id}`,
      });
      return result;
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:archive failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to archive",
      };
    }
  });

  ipcMain.handle("carrier-lines:toggle-active", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const result = service.toggleActive(id);
      audit(e.sender.id, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Toggled carrier line #${id}`,
      });
      return result;
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:toggle-active failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to toggle",
      };
    }
  });

  // LIRA-090: get the primary line for a carrier — called by the Only-Days
  // sale form and the self-charge form to pre-populate the target line.
  // Read-only; no role gate (mirrors other read handlers in this module).
  ipcMain.handle("carrier-lines:get-primary", (_event, carrier: CarrierKey) => {
    try {
      const repo = getCarrierLineRepository();
      const line = repo.getPrimary(carrier);
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:get-primary failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get primary",
      };
    }
  });

  // LIRA-090: designate a line as the primary for its carrier — Settings
  // admin only. Clears the previous primary atomically (see
  // CarrierLineRepository.setPrimary's doc).
  ipcMain.handle("carrier-lines:set-primary", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const repo = getCarrierLineRepository();
      const line = repo.setPrimary(id);
      if (!line) {
        return { success: false, error: `Carrier line #${id} not found` };
      }
      audit(e.sender.id, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Set carrier line #${id} as primary (${line.carrier})`,
      });
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error }, "carrier-lines:set-primary failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to set primary",
      };
    }
  });

  financialLogger.info("Carrier line IPC handlers registered");
}
