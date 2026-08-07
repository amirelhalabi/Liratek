/**
 * Recharge IPC Handlers
 *
 * Thin wrapper over RechargeService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  getRechargeService,
  rechargeLogger,
  getUserRepository,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import type { RechargeData } from "@liratek/core";

import {
  RechargeSchema,
  TopUpAppSchema,
  TopUpFromSupplierSchema,
  TopUpFromPartnerSchema,
  TopUpFromClientSchema,
  validatePayload,
} from "../schemas/index.js";

export function registerRechargeHandlers(): void {
  const rechargeService = getRechargeService();

  // Get Virtual Stock
  ipcMain.handle("recharge:get-stock", () => {
    return rechargeService.getStock();
  });

  // Get Recharge History
  ipcMain.handle(
    "recharge:get-history",
    (event: IpcMainInvokeEvent, provider: "MTC" | "Alfa") => {
      return rechargeService.getHistory(provider);
    },
  );

  // Get All Drawer Balances
  ipcMain.handle("recharge:get-drawer-balances", () => {
    return rechargeService.getDrawerBalances();
  });

  // Process Recharge Transaction (admin only)
  ipcMain.handle(
    "recharge:process",
    (event: IpcMainInvokeEvent, data: RechargeData) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(RechargeSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      rechargeLogger.info(
        {
          provider: v.data.provider,
          type: v.data.type,
          amount: v.data.amount,
        },
        "Processing recharge",
      );
      const result = rechargeService.processRecharge({
        ...v.data,
        userId: auth.userId,
      } as RechargeData);
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge",
        summary: `Recharge ${v.data.provider} ${v.data.type}: ${v.data.amount}`,
        metadata: {
          provider: v.data.provider,
          type: v.data.type,
          amount: v.data.amount,
        },
      });
      return result;
    },
  );

  // Top up provider drawer (admin and staff)
  ipcMain.handle(
    "recharge:top-up-app",
    (
      event: IpcMainInvokeEvent,
      data: {
        provider:
          | "MTC"
          | "Alfa"
          | "OMT_APP"
          | "WHISH_APP"
          | "OMT_SYSTEM"
          | "WHISH_SYSTEM"
          | "iPick"
          | "Katsh";
        amount: number;
        currency: "USD" | "LBP";
        sourceDrawer: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      // CARRIER_LINES_VALIDITY_PLAN.md Phase 8.4 — this handler had no Zod
      // validation at all before now (CLAUDE.md's write-path gotcha list).
      const v = validatePayload(TopUpAppSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      rechargeLogger.info(
        {
          provider: v.data.provider,
          amount: v.data.amount,
          currency: v.data.currency,
          sourceDrawer: v.data.sourceDrawer,
        },
        "Processing app top-up",
      );
      const result = rechargeService.topUpApp({
        ...v.data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge_topup",
        summary: `App top-up ${v.data.provider}: ${v.data.amount} ${v.data.currency} from ${v.data.sourceDrawer}`,
        metadata: {
          provider: v.data.provider,
          amount: v.data.amount,
          currency: v.data.currency,
          sourceDrawer: v.data.sourceDrawer,
        },
      });
      return result;
    },
  );

  // Top up Katsh/iPick drawer via supplier credit (admin and staff)
  ipcMain.handle(
    "recharge:top-up-from-supplier",
    (
      event: IpcMainInvokeEvent,
      data: {
        provider: "iPick" | "Katsh";
        amount: number;
        currency: "USD" | "LBP";
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(TopUpFromSupplierSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      rechargeLogger.info(
        {
          provider: v.data.provider,
          amount: v.data.amount,
          currency: v.data.currency,
        },
        "Processing supplier top-up",
      );
      const result = rechargeService.topUpFromSupplier({
        ...v.data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge_topup",
        summary: `Supplier top-up ${v.data.provider}: ${v.data.amount} ${v.data.currency}`,
        metadata: {
          provider: v.data.provider,
          amount: v.data.amount,
          currency: v.data.currency,
        },
      });
      return result;
    },
  );

  // Top up Whish App drawer via partner credit (admin and staff)
  ipcMain.handle(
    "recharge:top-up-from-partner",
    (
      event: IpcMainInvokeEvent,
      data: {
        provider: "WHISH_APP";
        partnerId: number;
        amount: number;
        currency: "USD" | "LBP";
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(TopUpFromPartnerSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      rechargeLogger.info(
        {
          provider: v.data.provider,
          partnerId: v.data.partnerId,
          amount: v.data.amount,
          currency: v.data.currency,
        },
        "Processing partner top-up",
      );
      const result = rechargeService.topUpFromPartner({
        ...v.data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge_topup",
        summary: `Partner top-up ${v.data.provider}: ${v.data.amount} ${v.data.currency}`,
        metadata: {
          provider: v.data.provider,
          partnerId: v.data.partnerId,
          amount: v.data.amount,
          currency: v.data.currency,
        },
      });
      return result;
    },
  );

  // Top up Whish App drawer from a client (admin and staff)
  ipcMain.handle(
    "recharge:top-up-from-client",
    (
      event: IpcMainInvokeEvent,
      data: {
        amount: number;
        cashPaid: number;
        currency: "USD" | "LBP";
        clientName?: string;
        clientId?: number;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const v = validatePayload(TopUpFromClientSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      rechargeLogger.info(
        {
          amount: v.data.amount,
          cashPaid: v.data.cashPaid,
          currency: v.data.currency,
          clientId: v.data.clientId,
        },
        "Processing client top-up",
      );
      const result = rechargeService.topUpFromClient({
        ...v.data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge_topup",
        summary: `Client top-up: ${v.data.amount} ${v.data.currency}`,
        metadata: {
          amount: v.data.amount,
          cashPaid: v.data.cashPaid,
          currency: v.data.currency,
          clientName: v.data.clientName,
          clientId: v.data.clientId,
        },
      });
      return result;
    },
  );

  // Update recharge metadata (staff and admin)
  ipcMain.handle(
    "recharge:update-metadata",
    (
      event: IpcMainInvokeEvent,
      data: {
        id: number;
        phone_number?: string;
        client_name?: string;
        note?: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      // Resolve username for edited_by display
      let editedBy = `user-${auth.userId}`;
      try {
        const userRepo = getUserRepository();
        const user = userRepo.findById(auth.userId);
        if (user) editedBy = user.username;
      } catch {
        // fallback to user-{id}
      }

      const result = rechargeService.updateRechargeMetadata(
        data.id,
        {
          phone_number: data.phone_number,
          client_name: data.client_name,
          note: data.note,
        },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(event.sender.id, {
          action: "edit_metadata",
          entity_type: "recharge",
          entity_id: String(data.id),
          summary: `Edited recharge #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );
}
