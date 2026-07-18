/**
 * Partner IPC Handlers
 *
 * Thin wrapper over PartnerService for IPC communication.
 * Handles: Authorization, IPC message routing to service
 */

import { ipcMain } from "electron";
import {
  getPartnerService,
  ipcLogger,
  type CreatePartnerData,
  type UpdatePartnerData,
  type LedgerFilters,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  PartnerRecordTransactionSchema,
  PartnerSettleSchema,
  PartnerWriteOffSchema,
  validatePayload,
} from "../schemas/index.js";

let service: ReturnType<typeof getPartnerService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getPartnerService();
  }
  return service;
}

export function registerPartnerHandlers(): void {
  ipcLogger.info("Registering Partner IPC handlers");

  // Get all partners (any role)
  ipcMain.handle("partners:get-all", (_event, includeInactive?: boolean) => {
    try {
      return getServiceInstance().getAllPartners(includeInactive);
    } catch (error) {
      ipcLogger.error({ error }, "partners:get-all failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get partners",
      };
    }
  });

  // Get partner by ID (any role)
  ipcMain.handle("partners:get-by-id", (_event, id: number) => {
    try {
      return getServiceInstance().getPartnerById(id);
    } catch (error) {
      ipcLogger.error({ error }, "partners:get-by-id failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get partner",
      };
    }
  });

  // Create partner (admin, staff)
  ipcMain.handle("partners:create", (event, data: CreatePartnerData) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const result = getServiceInstance().createPartner(data);
      audit(event.sender.id, {
        action: "create",
        entity_type: "partner",
        entity_id: String(result.id),
        summary: `Created partner "${data.name}"`,
        metadata: { name: data.name, phone: data.phone },
      });
      return { success: true, data: result };
    } catch (error) {
      ipcLogger.error({ error }, "partners:create failed");
      const msg = error instanceof Error ? error.message : "";
      const causeMsg =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : "";
      if (
        msg.includes("UNIQUE") ||
        causeMsg.includes("UNIQUE") ||
        msg.includes("SQLITE_CONSTRAINT") ||
        causeMsg.includes("SQLITE_CONSTRAINT")
      ) {
        return {
          success: false,
          error: "A partner with this name already exists.",
        };
      }
      return { success: false, error: "Failed to create partner" };
    }
  });

  // Update partner (admin, staff)
  ipcMain.handle(
    "partners:update",
    (event, id: number, data: UpdatePartnerData) => {
      try {
        const auth = requireRole(event.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const result = getServiceInstance().updatePartner(id, data);
        audit(event.sender.id, {
          action: "update",
          entity_type: "partner",
          entity_id: String(id),
          summary: `Updated partner #${id}`,
          new_values: data as Record<string, unknown>,
        });
        return { success: true, data: result };
      } catch (error) {
        ipcLogger.error({ error }, "partners:update failed");
        const msg = error instanceof Error ? error.message : "";
        const causeMsg =
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : "";
        if (
          msg.includes("UNIQUE") ||
          causeMsg.includes("UNIQUE") ||
          msg.includes("SQLITE_CONSTRAINT") ||
          causeMsg.includes("SQLITE_CONSTRAINT")
        ) {
          return {
            success: false,
            error: "A partner with this name already exists.",
          };
        }
        return { success: false, error: "Failed to update partner" };
      }
    },
  );

  // Deactivate partner (admin + staff)
  ipcMain.handle("partners:deactivate", (event, id: number) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      getServiceInstance().deactivatePartner(id);
      audit(event.sender.id, {
        action: "update",
        entity_type: "partner",
        entity_id: String(id),
        summary: `Deactivated partner #${id}`,
        old_values: { is_active: true },
        new_values: { is_active: false },
      });
      return { success: true };
    } catch (error) {
      ipcLogger.error({ error }, "partners:deactivate failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to deactivate partner",
      };
    }
  });

  // Activate partner (admin + staff)
  ipcMain.handle("partners:activate", (event, id: number) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      getServiceInstance().activatePartner(id);
      audit(event.sender.id, {
        action: "update",
        entity_type: "partner",
        entity_id: String(id),
        summary: `Activated partner #${id}`,
        old_values: { is_active: false },
        new_values: { is_active: true },
      });
      return { success: true };
    } catch (error) {
      ipcLogger.error({ error }, "partners:activate failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to activate partner",
      };
    }
  });

  // Get partner balance (any role)
  ipcMain.handle("partners:get-balance", (_event, partnerId: number) => {
    try {
      return getServiceInstance().getPartnerBalance(partnerId);
    } catch (error) {
      ipcLogger.error({ error }, "partners:get-balance failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get partner balance",
      };
    }
  });

  // Get all balances (any role)
  ipcMain.handle(
    "partners:get-all-balances",
    (_event, includeInactive?: boolean) => {
      try {
        return getServiceInstance().getAllBalances(includeInactive);
      } catch (error) {
        ipcLogger.error({ error }, "partners:get-all-balances failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get all balances",
        };
      }
    },
  );

  // Get partner ledger / statement (any role)
  ipcMain.handle(
    "partners:get-ledger",
    (_event, partnerId: number, filters?: LedgerFilters) => {
      try {
        return getServiceInstance().getPartnerStatement(partnerId, filters);
      } catch (error) {
        ipcLogger.error({ error }, "partners:get-ledger failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get partner ledger",
        };
      }
    },
  );

  // Record partner transaction (admin, staff)
  ipcMain.handle("partners:record-transaction", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(PartnerRecordTransactionSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = getServiceInstance().recordPartnerTransaction({
        ...v.data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "create",
        entity_type: "partner_ledger",
        summary: `Partner #${v.data.partnerId} ${v.data.direction}: ${v.data.amount} ${v.data.currency} (${v.data.transactionType ?? "MANUAL"})`,
        metadata: {
          partnerId: v.data.partnerId,
          transactionType: v.data.transactionType,
          amount: v.data.amount,
          currency: v.data.currency,
          direction: v.data.direction,
        },
      });
      return { success: true, data: result };
    } catch (error) {
      ipcLogger.error({ error }, "partners:record-transaction failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to record partner transaction",
      };
    }
  });

  // Settle partner balance (admin, staff)
  ipcMain.handle("partners:settle", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(PartnerSettleSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = getServiceInstance().settle({
        ...v.data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "settle",
        entity_type: "partner_ledger",
        summary: `Settled partner #${v.data.partnerId}: ${v.data.amount} ${v.data.currency} via ${v.data.settlementMethod}`,
        metadata: {
          partnerId: v.data.partnerId,
          amount: v.data.amount,
          currency: v.data.currency,
          settlementMethod: v.data.settlementMethod,
        },
      });
      return { success: true, data: result };
    } catch (error) {
      ipcLogger.error({ error }, "partners:settle failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to settle partner",
      };
    }
  });

  // CQ-10 (D4): standalone write-off — forgive part of a partner balance
  // with NO settlement attached. Admin-only on both transports.
  ipcMain.handle("partners:write-off", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(PartnerWriteOffSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      const result = getServiceInstance().writeOff({
        ...v.data,
        userId: auth.userId,
      });
      if (result.success) {
        audit(event.sender.id, {
          action: "write_off",
          entity_type: "partner_write_off",
          summary: `Partner write-off for #${v.data.partnerId}: $${v.data.amount_usd} + ${v.data.amount_lbp} LBP`,
          metadata: {
            partnerId: v.data.partnerId,
            amount_usd: v.data.amount_usd,
            amount_lbp: v.data.amount_lbp,
          },
        });
      }
      return result;
    } catch (error) {
      ipcLogger.error({ error }, "partners:write-off failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to write off partner balance",
      };
    }
  });

  ipcLogger.info("Partner IPC handlers registered");
}
