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

import { RechargeSchema, validatePayload } from "../schemas/index.js";

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

  // Top up MTC/Alfa balance (admin only)
  ipcMain.handle(
    "recharge:top-up",
    (
      event: IpcMainInvokeEvent,
      data: { provider: "MTC" | "Alfa"; amount: number; currency?: string },
    ) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      rechargeLogger.info(
        { provider: data.provider, amount: data.amount },
        "Processing top-up",
      );
      const result = rechargeService.topUp({ ...data, userId: auth.userId });
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge_topup",
        summary: `Top-up ${data.provider}: ${data.amount}`,
        metadata: { provider: data.provider, amount: data.amount },
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
          | "iPick"
          | "Katsh"
          | "BINANCE";
        amount: number;
        currency: "USD" | "LBP";
        sourceDrawer: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      rechargeLogger.info(
        {
          provider: data.provider,
          amount: data.amount,
          currency: data.currency,
          sourceDrawer: data.sourceDrawer,
        },
        "Processing app top-up",
      );
      const result = rechargeService.topUpApp({
        ...data,
        userId: auth.userId,
      });
      audit(event.sender.id, {
        action: "create",
        entity_type: "recharge_topup",
        summary: `App top-up ${data.provider}: ${data.amount} ${data.currency} from ${data.sourceDrawer}`,
        metadata: {
          provider: data.provider,
          amount: data.amount,
          currency: data.currency,
          sourceDrawer: data.sourceDrawer,
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
