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
} from "@liratek/core";
import { requireRole } from "../session.js";

interface RecordTransactionInput {
  partnerId: number;
  transactionType?:
    | "OMT_SEND"
    | "OMT_RECEIVE"
    | "WHISH_SEND"
    | "WHISH_RECEIVE"
    | "CUSTOM_SERVICE"
    | "SETTLEMENT"
    | "ADJUSTMENT";
  referenceTable?: string;
  referenceId?: number;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
  notes?: string;
}

interface SettleInput {
  partnerId: number;
  amount: number;
  currency: string;
  settlementMethod: string;
  notes?: string;
}

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

  // Deactivate partner (admin only)
  ipcMain.handle("partners:deactivate", (event, id: number) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      getServiceInstance().deactivatePartner(id);
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

  // Activate partner (admin only)
  ipcMain.handle("partners:activate", (event, id: number) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      getServiceInstance().activatePartner(id);
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
    (_event, partnerId: number, dateRange?: { start: string; end: string }) => {
      try {
        return getServiceInstance().getPartnerStatement(partnerId, dateRange);
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
  ipcMain.handle(
    "partners:record-transaction",
    (event, data: RecordTransactionInput) => {
      try {
        const auth = requireRole(event.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const result = getServiceInstance().recordPartnerTransaction({
          ...data,
          userId: auth.userId,
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
    },
  );

  // Settle partner balance (admin, staff)
  ipcMain.handle("partners:settle", (event, data: SettleInput) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const result = getServiceInstance().settle({
        ...data,
        userId: auth.userId,
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

  ipcLogger.info("Partner IPC handlers registered");
}
