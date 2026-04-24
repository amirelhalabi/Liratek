import { ipcMain } from "electron";
import {
  CustomerSessionService,
  getSalesService,
  getRechargeService,
  getFinancialService,
  getLotoService,
  getCustomServiceService,
  getMaintenanceService,
  getCustomerSessionRepository,
  getDatabase,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

const sessionService = new CustomerSessionService();

/**
 * Cart item shape from the frontend SessionContext.
 * Each item captures the exact IPC payload needed to replay the transaction at checkout.
 */
interface CheckoutCartItem {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
}

interface CheckoutPayment {
  method: string;
  currency_code: string;
  amount: number;
}

interface CheckoutRequest {
  sessionId: number;
  cartItems: CheckoutCartItem[];
  /** Primary payment method (e.g. "CASH", "DEBT") */
  paidByMethod: string;
  /** Multi-payment lines (optional) */
  payments?: CheckoutPayment[];
  /** Client ID (required if any payment involves DEBT) */
  clientId?: number;
  /** Client name (for debt entries) */
  clientName?: string;
  /** User ID of the checkout operator */
  userId: number;
}

interface CheckoutItemResult {
  cartItemId: string;
  module: string;
  transactionId: number;
  success: boolean;
  error?: string;
}

/**
 * Process a single cart item by calling the appropriate service method.
 * Returns the created entity/transaction ID.
 */
function processCartItem(
  item: CheckoutCartItem,
  paidByMethod: string,
  payments: CheckoutPayment[] | undefined,
  userId: number,
): { transactionId: number; transactionType: string } {
  const data = { ...item.formData };

  // Inject payment info based on module type
  switch (item.ipcChannel) {
    case "sales:process": {
      // SalesService.processSale(saleData, userId)
      // Payment info is already in formData (payment_method, paid_usd, paid_lbp, etc.)
      // Override payment_method with checkout's paidByMethod
      if (!data.payment_method) {
        data.payment_method = paidByMethod;
      }
      const salesService = getSalesService();
      const result = salesService.processSale(data as any, userId);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to process sale");
      }
      return { transactionId: result.id, transactionType: "sale" };
    }

    case "recharge:process": {
      // RechargeService.processRecharge(data) — data includes paid_by_method
      data.paid_by_method = data.paid_by_method || paidByMethod;
      data.userId = userId;
      const rechargeService = getRechargeService();
      const result = rechargeService.processRecharge(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to process recharge");
      }
      return {
        transactionId: result.id,
        transactionType:
          item.module === "recharge_mtc" ? "recharge_mtc" : "recharge_alfa",
      };
    }

    case "omt:add-transaction": {
      // FinancialService.addTransaction(data) — data includes paidByMethod, payments
      data.paidByMethod = data.paidByMethod || paidByMethod;
      if (payments && payments.length > 0 && !data.payments) {
        data.payments = payments;
      }
      const financialService = getFinancialService();
      const result = financialService.addTransaction(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to add financial transaction");
      }
      // Map module to transaction type
      const moduleToType: Record<string, string> = {
        omt_app: "omt_app",
        whish_app: "whish_app",
        omt_system: "omt_system",
        whish_system: "whish_system",
        ipick: "ipick",
        katsh: "katsh",
        binance_send: "binance",
        binance_receive: "binance",
      };
      return {
        transactionId: result.id,
        transactionType: moduleToType[item.module] || "financial_service",
      };
    }

    case "loto:sell": {
      // LotoService.sellTicket(data) — data includes payment_method, userId
      data.payment_method = data.payment_method || paidByMethod;
      data.userId = userId;
      const lotoService = getLotoService();
      const ticket = lotoService.sellTicket(data as any);
      return { transactionId: ticket.id, transactionType: "loto_ticket" };
    }

    case "loto:cash-prize:create": {
      // LotoService.recordCashPrize(data) — data includes userId
      data.userId = userId;
      const lotoService = getLotoService();
      const prize = lotoService.recordCashPrize(data as any);
      return { transactionId: prize.id, transactionType: "loto_prize" };
    }

    case "custom-services:add": {
      // CustomServiceService.addService(data) — data includes paid_by
      data.paid_by = data.paid_by || paidByMethod;
      const customService = getCustomServiceService();
      const result = customService.addService(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to add custom service");
      }
      return { transactionId: result.id, transactionType: "custom_service" };
    }

    case "maintenance:save": {
      // MaintenanceService.saveJob(data) — data includes paid_by, payments
      data.paid_by = data.paid_by || paidByMethod;
      const maintenanceService = getMaintenanceService();
      const result = maintenanceService.saveJob(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to save maintenance job");
      }
      return { transactionId: result.id, transactionType: "maintenance" };
    }

    default:
      throw new Error(
        `Unknown IPC channel for session checkout: ${item.ipcChannel}`,
      );
  }
}

/**
 * Process batch items that have _batch: true (FinancialForm/KatchForm).
 * These have multiple items bundled into one cart entry.
 */
function processBatchCartItem(
  item: CheckoutCartItem,
  paidByMethod: string,
  payments: CheckoutPayment[] | undefined,
  userId: number,
): Array<{ transactionId: number; transactionType: string }> {
  const results: Array<{ transactionId: number; transactionType: string }> = [];
  const items = item.formData.items as Array<Record<string, unknown>>;

  if (!items || !Array.isArray(items)) {
    throw new Error(
      `Batch cart item ${item.id} has no items array in formData`,
    );
  }

  for (const subItem of items) {
    const subCartItem: CheckoutCartItem = {
      ...item,
      formData: subItem,
    };
    const result = processCartItem(subCartItem, paidByMethod, payments, userId);
    results.push(result);
  }

  return results;
}

export function registerSessionHandlers() {
  // Start a new customer session
  ipcMain.handle(
    "session:start",
    async (
      event,
      data: {
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
        started_by: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      const result = sessionService.startSession(data);
      audit(event.sender.id, {
        action: "create",
        entity_type: "customer_session",
        summary: `Started customer session${data.customer_name ? ` for "${data.customer_name}"` : ""}`,
      });
      return result;
    },
  );

  // Get active session
  ipcMain.handle("session:getActive", async () => {
    return sessionService.getActiveSession();
  });

  // Get session details
  ipcMain.handle("session:getDetails", async (_event, sessionId: number) => {
    return sessionService.getSessionDetails(sessionId);
  });

  // Update session
  ipcMain.handle(
    "session:update",
    async (
      event,
      sessionId: number,
      data: {
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      return sessionService.updateSession(sessionId, data);
    },
  );

  // Close session
  ipcMain.handle(
    "session:close",
    async (event, sessionId: number, closedBy: string) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      const result = sessionService.closeSession(sessionId, closedBy);
      audit(event.sender.id, {
        action: "update",
        entity_type: "customer_session",
        entity_id: String(sessionId),
        summary: `Closed customer session #${sessionId}`,
      });
      return result;
    },
  );

  // List sessions
  ipcMain.handle(
    "session:list",
    async (_event, limit?: number, offset?: number) => {
      return sessionService.listSessions(limit, offset);
    },
  );

  // Link transaction to active session (helper for other modules)
  ipcMain.handle(
    "session:linkTransaction",
    async (
      event,
      data: {
        sessionId?: number;
        transactionType: string;
        transactionId: number;
        amountUsd: number;
        amountLbp: number;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      if (data.sessionId) {
        return sessionService.linkTransactionToSession(
          data.sessionId,
          data.transactionType,
          data.transactionId,
          data.amountUsd,
          data.amountLbp,
        );
      }
      return sessionService.linkTransactionToActiveSession(
        data.transactionType,
        data.transactionId,
        data.amountUsd,
        data.amountLbp,
      );
    },
  );

  // Get sessions by customer (for client details view)
  ipcMain.handle(
    "session:getByCustomer",
    async (
      _event,
      data: {
        customerName: string;
        customerPhone?: string;
      },
    ) => {
      return sessionService.getSessionsByCustomer(
        data.customerName,
        data.customerPhone,
      );
    },
  );

  // Batch checkout: process all cart items and close session
  ipcMain.handle(
    "session:checkout",
    async (event, request: CheckoutRequest) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      try {
        const { sessionId, cartItems, paidByMethod, payments, userId } =
          request;

        if (!cartItems || cartItems.length === 0) {
          return { success: false, error: "Cart is empty" };
        }

        // Verify session exists and is active
        const sessionResult = await sessionService.getSessionDetails(sessionId);
        if (!sessionResult.success || !sessionResult.session) {
          return {
            success: false,
            error: sessionResult.error || "Session not found",
          };
        }
        if (!sessionResult.session.is_active) {
          return { success: false, error: "Session is already closed" };
        }

        const db = getDatabase();
        const repo = getCustomerSessionRepository();
        const itemResults: CheckoutItemResult[] = [];
        let checkoutTotal = 0;

        // Wrap everything in a DB transaction for atomicity
        const runCheckout = db.transaction(() => {
          for (const item of cartItems) {
            try {
              const isBatch = item.formData._batch === true;

              if (isBatch) {
                // Batch items (FinancialForm/KatchForm) — process each sub-item
                const batchResults = processBatchCartItem(
                  item,
                  paidByMethod,
                  payments,
                  userId,
                );
                for (const result of batchResults) {
                  // Link each sub-transaction to the session
                  repo.linkTransaction(
                    sessionId,
                    result.transactionType,
                    result.transactionId,
                    item.currency === "USD"
                      ? item.amount / batchResults.length
                      : 0,
                    item.currency === "LBP"
                      ? item.amount / batchResults.length
                      : 0,
                  );
                  itemResults.push({
                    cartItemId: item.id,
                    module: item.module,
                    transactionId: result.transactionId,
                    success: true,
                  });
                }
              } else {
                // Single item — process directly
                const result = processCartItem(
                  item,
                  paidByMethod,
                  payments,
                  userId,
                );

                // Link transaction to session
                repo.linkTransaction(
                  sessionId,
                  result.transactionType,
                  result.transactionId,
                  item.currency === "USD" ? item.amount : 0,
                  item.currency === "LBP" ? item.amount : 0,
                );

                itemResults.push({
                  cartItemId: item.id,
                  module: item.module,
                  transactionId: result.transactionId,
                  success: true,
                });
              }

              checkoutTotal += item.amount;
            } catch (err: any) {
              // If any item fails, the transaction will be rolled back
              throw new Error(
                `Failed to process cart item "${item.label}" (${item.module}): ${err?.message || "Unknown error"}`,
              );
            }
          }

          // Update session with checkout info
          const checkoutCurrency = cartItems[0]?.currency || "USD";
          db.prepare(
            `
            UPDATE customer_sessions
            SET checkout_at = datetime('now'),
                checkout_total = ?,
                checkout_currency = ?,
                is_active = 0,
                closed_at = datetime('now'),
                closed_by = ?
            WHERE id = ?
          `,
          ).run(checkoutTotal, checkoutCurrency, String(userId), sessionId);
        });

        // Execute the transaction
        runCheckout();

        audit(event.sender.id, {
          action: "update",
          entity_type: "customer_session",
          entity_id: String(sessionId),
          summary: `Session checkout: ${cartItems.length} items, total ${checkoutTotal.toFixed(2)} ${cartItems[0]?.currency || "USD"}`,
        });

        return {
          success: true,
          results: itemResults,
          checkoutTotal,
          itemCount: cartItems.length,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || "Checkout failed",
        };
      }
    },
  );
}
