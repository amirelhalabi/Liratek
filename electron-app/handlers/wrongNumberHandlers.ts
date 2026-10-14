/**
 * Wrong-number card recharge IPC handlers — LIRA-312.
 *
 * Thin wrapper over `WrongNumberService`. Mirrors the REST routes in
 * `backend/src/api/wrongNumbers.ts` (rule 19): both validate with the same
 * core schema and return the same `{ success, data?, error? }` envelope.
 *
 * Auth (owner decision 2026-10-12): recording a wrong number and entering
 * credits received are open to cashiers and admins; undoing either is the
 * existing admin-only void (`transactions:void`). The list needs only a
 * signed-in session.
 */

import { ipcMain } from "electron";
import { getWrongNumberService, expenseLogger } from "@liratek/core";
import { isAuthenticated, requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  ListWrongNumbersQuerySchema,
  RecordWrongNumberSchema,
  WrongNumberCreditsSchema,
} from "../schemas/index.js";

function errMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function registerWrongNumberHandlers(): void {
  const service = getWrongNumberService();

  ipcMain.handle("wrong-numbers:list", (event, query: unknown) => {
    try {
      if (!isAuthenticated(event.sender.id)) {
        return { success: false, error: "Not authenticated" };
      }
      const v = validatePayload(ListWrongNumbersQuerySchema, query ?? {});
      if (!v.ok) return { success: false, error: v.error };
      return { success: true, data: service.list(v.data) };
    } catch (error) {
      expenseLogger.error({ error }, "wrong-numbers:list failed");
      return {
        success: false,
        error: errMessage(error, "Failed to load wrong-number cards"),
      };
    }
  });

  ipcMain.handle("wrong-numbers:record", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(RecordWrongNumberSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = service.recordWrongNumber(v.data, auth.userId);
      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "wrong_number_card",
          entity_id: String(result.data.id),
          summary: `Wrong number ${v.data.wrong_number} (${v.data.provider} card)`,
          metadata: {
            expense_transaction_id: result.data.expense_transaction_id,
            sale_transaction_id: v.data.sale_transaction_id ?? null,
          },
        });
      }
      return result;
    } catch (error) {
      expenseLogger.error({ error }, "wrong-numbers:record failed");
      return {
        success: false,
        error: errMessage(error, "Failed to record the wrong number"),
      };
    }
  });

  ipcMain.handle("wrong-numbers:credits", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(WrongNumberCreditsSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = service.recordCreditsReceived(v.data, auth.userId);
      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "wrong_number_card",
          entity_id: String(v.data.wrong_number_card_id),
          summary: `Credits received $${v.data.amount_usd} (wrong-number card #${v.data.wrong_number_card_id})`,
          metadata: {
            transaction_id: result.data.transaction_id,
            carrier_line_id: v.data.carrier_line_id,
          },
        });
      }
      return result;
    } catch (error) {
      expenseLogger.error({ error }, "wrong-numbers:credits failed");
      return {
        success: false,
        error: errMessage(error, "Failed to record the credits received"),
      };
    }
  });
}
