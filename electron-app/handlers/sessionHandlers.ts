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
  getClientRepository,
  getDatabase,
  getUserRepository,
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
  /** IN = customer paid the shop; OUT = change handed back. Defaults to IN. */
  direction?: "IN" | "OUT";
}

interface CheckoutRequest {
  sessionId: number;
  cartItems: CheckoutCartItem[];
  /** Primary payment method (e.g. "CASH", "CUSTOMER_ACCOUNT") */
  paidByMethod: string;
  /** Multi-payment lines (optional) */
  payments?: CheckoutPayment[];
  /** Client ID (required if any payment involves CUSTOMER_ACCOUNT) */
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

/** Map checkout payment legs (snake_case) to the camelCase shape the
 *  financial/recharge repositories expect (with IN/OUT direction). */
function checkoutPaymentsToLegs(payments: CheckoutPayment[]) {
  return payments.map((p) => ({
    method: p.method,
    currencyCode: p.currency_code,
    amount: p.amount,
    direction: p.direction ?? "IN",
  }));
}

/**
 * Process a single cart item by calling the appropriate service method.
 * Returns the created entity/transaction ID.
 *
 * `injectCheckoutPayments` is set ONLY for a single-item checkout: there, the
 * Session Checkout modal is the source of truth for payment, so its legs (incl.
 * change/OUT) drive the financial/recharge item — otherwise a single item would
 * record just its add-to-cart default and lose the customer's change. It is NOT
 * set for multi-item checkouts, where one shared payment can't be attributed to
 * a single item.
 */
function processCartItem(
  item: CheckoutCartItem,
  paidByMethod: string,
  payments: CheckoutPayment[] | undefined,
  userId: number,
  injectCheckoutPayments = false,
): { transactionId: number; transactionType: string } {
  const data = { ...item.formData };
  const canInject =
    injectCheckoutPayments && !!payments && payments.length > 0;

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
      if (canInject) {
        data.payments = checkoutPaymentsToLegs(payments!);
        data.paid_by_method = "MULTI";
      } else {
        data.paid_by_method = data.paid_by_method || paidByMethod;
      }
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

    case "omt:add-transaction":
    case "financial:create": {
      // FinancialService.addTransaction(data) — data includes paidByMethod, payments.
      // Multi-item checkouts do NOT inject the checkout-level payments (one shared
      // payment can't be attributed per item, and every item would record the full
      // total). A single-item checkout DOES (canInject): the modal is the payment
      // source of truth, so its legs — including the change/OUT leg — are recorded.
      if (canInject) {
        data.payments = checkoutPaymentsToLegs(payments!);
        data.paidByMethod = "MULTI";
      } else {
        data.paidByMethod = data.paidByMethod || paidByMethod;
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

      // Look up username server-side instead of trusting frontend
      const user = getUserRepository().findByIdSafe(auth.userId);
      const started_by = user?.username || data.started_by || "unknown";

      const result = await sessionService.startSession({
        ...data,
        started_by,
        user_id: auth.userId,
      });

      // Auto-register client when both name and phone are supplied
      if (result.success && data.customer_name && data.customer_phone) {
        try {
          const clientRepo = getClientRepository();
          const existing = clientRepo.findByPhone(data.customer_phone);
          if (!existing) {
            clientRepo.createClient(
              { full_name: data.customer_name, phone_number: data.customer_phone },
              auth.userId,
            );
          }
        } catch {
          // Client creation is best-effort; do not fail the session
        }
      }

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

  // Get all active sessions (for multi-PC polling)
  ipcMain.handle("session:getActiveSessions", async () => {
    try {
      const repo = getCustomerSessionRepository();
      const sessions = repo.getActiveSessions();
      return { success: true, sessions };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Failed to get active sessions",
      };
    }
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

  // Delete session permanently
  ipcMain.handle("session:delete", async (event, sessionId: number) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const result = await sessionService.deleteSession(sessionId);
    if (result.success) {
      audit(event.sender.id, {
        action: "delete",
        entity_type: "customer_session",
        entity_id: String(sessionId),
        summary: `Deleted customer session #${sessionId}`,
      });
    }
    return result;
  });

  // List sessions
  ipcMain.handle(
    "session:list",
    async (_event, limit?: number, offset?: number) => {
      return sessionService.listSessions(limit, offset);
    },
  );

  // Get sessions by date range
  ipcMain.handle(
    "session:byDateRange",
    async (event, from: string, to: string) => {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      return sessionService.getSessionsByDateRange(from, to);
    },
  );

  // Get today's sessions
  ipcMain.handle("session:today", async (event) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    return sessionService.getTodaySessions();
  });

  // Get today's sessions (active + closed) for session list UI
  ipcMain.handle("session:todayAll", async (event) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    return sessionService.getTodayAllSessions();
  });

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
        profitUsd?: number;
        profitLbp?: number;
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
          data.profitUsd ?? 0,
          data.profitLbp ?? 0,
        );
      }
      return sessionService.linkTransactionToActiveSession(
        data.transactionType,
        data.transactionId,
        data.amountUsd,
        data.amountLbp,
        data.profitUsd ?? 0,
        data.profitLbp ?? 0,
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
        let checkoutTotalUsd = 0;
        let checkoutTotalLbp = 0;
        let checkoutProfitUsd = 0;
        let checkoutProfitLbp = 0;

        // Inject session customer_name into cart items that lack a client name
        const sessionCustomerName =
          sessionResult.session.customer_name || undefined;
        const sessionCustomerPhone =
          sessionResult.session.customer_phone || undefined;

        // Resolve client ID from session customer name/phone for DEBT payments
        let sessionClientId: number | undefined;
        if (sessionCustomerName) {
          try {
            const clientRepo = getClientRepository();
            // Try exact match by phone first, then search by name
            if (sessionCustomerPhone) {
              const byPhone = clientRepo.findByPhone(sessionCustomerPhone);
              if (byPhone) sessionClientId = byPhone.id;
            }
            if (!sessionClientId) {
              const results = clientRepo.search(sessionCustomerName, {
                limit: 1,
              });
              if (results.length > 0) sessionClientId = results[0].id;
            }
          } catch {
            // Client resolution failed — will be handled per-item
          }
        }

        if (sessionCustomerName) {
          for (const item of cartItems) {
            const fd = item.formData;
            if (fd._batch && Array.isArray(fd.items)) {
              for (const sub of fd.items as Record<string, unknown>[]) {
                if (!sub.clientName && !sub.senderName && !sub.client_name) {
                  sub.clientName = sessionCustomerName;
                }
                if (!sub.clientId && sessionClientId) {
                  sub.clientId = sessionClientId;
                }
              }
            } else {
              if (!fd.clientName && !fd.senderName && !fd.client_name) {
                fd.clientName = sessionCustomerName;
              }
              if (!fd.clientId && sessionClientId) {
                fd.clientId = sessionClientId;
              }
            }
          }
        }

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
                // Compute per-sub-item profit from formData
                const batchItems = item.formData.items as
                  | Array<Record<string, unknown>>
                  | undefined;
                for (let bi = 0; bi < batchResults.length; bi++) {
                  const result = batchResults[bi];
                  let subProfitUsd = 0;
                  let subProfitLbp = 0;
                  if (batchItems && batchItems[bi]) {
                    const sub = batchItems[bi];
                    const comm = Number(sub.commission) || 0;
                    const subCurrency =
                      (sub.currency as string) || item.currency || "USD";
                    if (subCurrency === "LBP") {
                      subProfitLbp = comm;
                    } else {
                      subProfitUsd = comm;
                    }
                  }
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
                    subProfitUsd,
                    subProfitLbp,
                  );
                  itemResults.push({
                    cartItemId: item.id,
                    module: item.module,
                    transactionId: result.transactionId,
                    success: true,
                  });
                }
              } else {
                // Single item — process directly. When the whole cart is this one
                // item, the Session Checkout modal's payment (incl. change) is the
                // source of truth, so inject its legs into the recorded transaction.
                const isSoleItem = cartItems.length === 1;
                const result = processCartItem(
                  item,
                  paidByMethod,
                  payments,
                  userId,
                  isSoleItem,
                );

                // Compute per-item profit from formData
                let itemProfitUsd = 0;
                let itemProfitLbp = 0;
                const comm =
                  Number(item.formData.commission) ||
                  Number(item.formData.totalProfitUsd) ||
                  Number(item.formData.profitUsd) ||
                  0;
                const commLbp =
                  Number(item.formData.profitLbp) ||
                  Number(item.formData.commissionLbp) ||
                  0;
                if (item.currency === "LBP") {
                  itemProfitLbp = comm || commLbp;
                } else {
                  itemProfitUsd = comm;
                  itemProfitLbp = commLbp;
                }

                // Link transaction to session
                repo.linkTransaction(
                  sessionId,
                  result.transactionType,
                  result.transactionId,
                  item.currency === "USD" ? item.amount : 0,
                  item.currency === "LBP" ? item.amount : 0,
                  itemProfitUsd,
                  itemProfitLbp,
                );

                itemResults.push({
                  cartItemId: item.id,
                  module: item.module,
                  transactionId: result.transactionId,
                  success: true,
                });
              }

              // Accumulate totals by currency
              if (item.currency === "LBP") {
                checkoutTotalLbp += item.amount;
              } else {
                checkoutTotalUsd += item.amount;
              }

              // Extract profit/commission from formData
              if (item.formData._batch && Array.isArray(item.formData.items)) {
                for (const sub of item.formData.items as Array<
                  Record<string, unknown>
                >) {
                  const comm = Number(sub.commission) || 0;
                  const subCurrency =
                    (sub.currency as string) || item.currency || "USD";
                  if (subCurrency === "LBP") {
                    checkoutProfitLbp += comm;
                  } else {
                    checkoutProfitUsd += comm;
                  }
                }
              } else {
                // Check multiple profit field names used by different modules
                const comm =
                  Number(item.formData.commission) ||
                  Number(item.formData.totalProfitUsd) ||
                  Number(item.formData.profitUsd) ||
                  0;
                const commLbp =
                  Number(item.formData.profitLbp) ||
                  Number(item.formData.commissionLbp) ||
                  0;
                if (item.currency === "LBP") {
                  checkoutProfitLbp += comm || commLbp;
                } else {
                  checkoutProfitUsd += comm;
                  checkoutProfitLbp += commLbp;
                }
              }
            } catch (err: any) {
              // If any item fails, the transaction will be rolled back
              throw new Error(
                `Failed to process cart item "${item.label}" (${item.module}): ${err?.message || "Unknown error"}`,
              );
            }
          }

          db.prepare(
            `
            UPDATE customer_sessions
            SET checkout_at = datetime('now'),
                checkout_total = ?,
                checkout_currency = ?,
                checkout_total_usd = ?,
                checkout_total_lbp = ?,
                checkout_profit_usd = ?,
                checkout_profit_lbp = ?,
                is_active = 0,
                closed_at = datetime('now'),
                closed_by = ?
            WHERE id = ?
          `,
          ).run(
            checkoutTotalUsd + checkoutTotalLbp, // legacy field
            cartItems[0]?.currency || "USD", // legacy field
            checkoutTotalUsd,
            checkoutTotalLbp,
            checkoutProfitUsd,
            checkoutProfitLbp,
            getUserRepository().findByIdSafe(auth.userId)?.username ||
              String(userId),
            sessionId,
          );
        });

        // Execute the transaction
        runCheckout();

        audit(event.sender.id, {
          action: "update",
          entity_type: "customer_session",
          entity_id: String(sessionId),
          summary: `Session checkout: ${cartItems.length} items, USD ${checkoutTotalUsd.toFixed(2)}, LBP ${checkoutTotalLbp.toFixed(0)}`,
        });

        return {
          success: true,
          results: itemResults,
          checkoutTotalUsd,
          checkoutTotalLbp,
          checkoutProfitUsd,
          checkoutProfitLbp,
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

  // ── Cart persistence ──────────────────────────────────────────────

  ipcMain.handle(
    "session:cart:add",
    async (
      event,
      sessionId: number,
      item: {
        item_id: string;
        module: string;
        label: string;
        amount: number;
        currency: string;
        form_data: string;
        ipc_channel: string;
      },
    ) => {
      try {
        const auth = requireRole(event.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };
        const repo = getCustomerSessionRepository();
        const id = repo.addCartItem(sessionId, {
          ...item,
          user_id: auth.userId,
        });
        return { success: true, id };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || "Failed to add cart item",
        };
      }
    },
  );

  ipcMain.handle("session:cart:get", async (_event, sessionId: number) => {
    try {
      const repo = getCustomerSessionRepository();
      const items = repo.getCartItems(sessionId);
      return { success: true, items };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Failed to get cart items",
      };
    }
  });

  ipcMain.handle(
    "session:cart:remove",
    async (event, sessionId: number, itemId: string) => {
      try {
        const auth = requireRole(event.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };
        const repo = getCustomerSessionRepository();
        repo.removeCartItem(sessionId, itemId);
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || "Failed to remove cart item",
        };
      }
    },
  );

  ipcMain.handle("session:cart:clear", async (event, sessionId: number) => {
    try {
      const auth = requireRole(event.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };
      const repo = getCustomerSessionRepository();
      repo.clearCart(sessionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to clear cart" };
    }
  });
}
