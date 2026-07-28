/**
 * Wallet Exchange IPC Handlers
 *
 * Thin wrapper over WalletExchangeService for IPC communication. Converts a
 * provider wallet's (OMT App / Whish App) own USD balance to LBP or vice
 * versa — never touches General, never a customer. Same role tier as the
 * general Exchange feature (admin + staff), since this is a normal
 * operational action, not a physical-cash withdrawal.
 */

import { ipcMain } from "electron";
import { getWalletExchangeService, createChildLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { validatePayload, WalletExchangeSchema } from "../schemas/index.js";

const walletExchangeLogger = createChildLogger({ module: "wallet-exchange" });

let service: ReturnType<typeof getWalletExchangeService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getWalletExchangeService();
  }
  return service;
}

export function registerWalletExchangeHandlers(): void {
  walletExchangeLogger.info("Registering Wallet Exchange IPC handlers");

  ipcMain.handle(
    "wallet-exchange:create",
    async (
      e,
      data: {
        drawerName: "OMT_App" | "Whish_App";
        fromCurrency: "USD" | "LBP";
        toCurrency: "USD" | "LBP";
        amountIn: number;
        rate: number;
        note?: string;
        transaction_time?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const validation = validatePayload(WalletExchangeSchema, data);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }

        const svc = getServiceInstance();
        const result = svc.exchange(validation.data, auth.userId);
        if (result.success) {
          audit(e.sender.id, {
            action: "create",
            entity_type: "wallet_exchange",
            summary: `${validation.data.drawerName.replace("_", " ")} Exchange: ${validation.data.amountIn} ${validation.data.fromCurrency} → ${result.amountOut} ${validation.data.toCurrency}`,
            metadata: {
              drawer_name: validation.data.drawerName,
              from_currency: validation.data.fromCurrency,
              to_currency: validation.data.toCurrency,
              amount_in: validation.data.amountIn,
              amount_out: result.amountOut,
              rate: validation.data.rate,
            },
          });
        }
        return result;
      } catch (error) {
        walletExchangeLogger.error({ error }, "wallet-exchange:create failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create wallet exchange",
        };
      }
    },
  );

  ipcMain.handle(
    "wallet-exchange:history",
    async (
      _e,
      params?: { drawerName?: "OMT_App" | "Whish_App"; limit?: number },
    ) => {
      try {
        const svc = getServiceInstance();
        const data = svc.getHistory(params?.drawerName, params?.limit);
        return { success: true, data };
      } catch (error) {
        walletExchangeLogger.error(
          { error },
          "wallet-exchange:history failed",
        );
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to retrieve wallet exchange history",
        };
      }
    },
  );

  walletExchangeLogger.info("Wallet Exchange IPC handlers registered");
}
