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
  getTransactionRepository,
  getSessionPaymentService,
  getClientRepository,
  getDatabase,
  getUserRepository,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { validatePayload, SessionCheckoutSchema } from "../schemas/index.js";
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
  /** Primary payment method (e.g. "CASH", "CUSTOMER_ACCOUNT") — legacy, optional */
  paidByMethod?: string;
  /** Basket customer-cash legs (the ONE payment for the whole basket) */
  payments?: CheckoutPayment[];
  /** Operator-edited USD→LBP rate of record for the basket. */
  exchangeRate?: number;
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

/** Result of processing one cart item: the source-module id + its source_table
 *  so the caller can resolve the UNIFIED transactions.id for linking. */
interface ProcessedItem {
  /** Source-module row id (sale id, financial_services id, ticket id, …). */
  sourceId: number;
  /** Unified transactions.source_table value used to resolve the unified id. */
  sourceTable: string;
  /** Legacy session transaction_type label. */
  transactionType: string;
}

/**
 * Process a single cart item by calling the appropriate service method in
 * SESSION-BASKET deferred mode: each service creates its record + side effects +
 * internal legs but SKIPS the customer-cash legs / drawer post / debt — the
 * basket recorder (recordBasketPayment) owns the single customer payment.
 *
 * The operator-edited `exchangeRate` is threaded onto each transaction so the
 * recorded rate matches what the operator used.
 */
function processCartItem(
  item: CheckoutCartItem,
  exchangeRate: number | undefined,
  userId: number,
): ProcessedItem {
  const data = { ...item.formData, deferPayment: true } as Record<
    string,
    unknown
  >;
  if (exchangeRate && exchangeRate > 0) {
    // Thread the operator rate under every key the various services read.
    if (data.exchange_rate === undefined) data.exchange_rate = exchangeRate;
    if (data.exchangeRate === undefined) data.exchangeRate = exchangeRate;
  }

  switch (item.ipcChannel) {
    case "sales:process": {
      const salesService = getSalesService();
      const result = salesService.processSale(data as any, userId);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to process sale");
      }
      return {
        sourceId: result.id,
        sourceTable: "sales",
        transactionType: "sale",
      };
    }

    case "recharge:process": {
      data.userId = userId;
      const rechargeService = getRechargeService();
      const result = rechargeService.processRecharge(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to process recharge");
      }
      return {
        sourceId: result.id,
        sourceTable: "recharges",
        transactionType:
          item.module === "recharge_mtc" ? "recharge_mtc" : "recharge_alfa",
      };
    }

    case "omt:add-transaction":
    case "financial:create": {
      const financialService = getFinancialService();
      const result = financialService.addTransaction(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to add financial transaction");
      }
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
        sourceId: result.id,
        sourceTable: "financial_services",
        transactionType: moduleToType[item.module] || "financial_service",
      };
    }

    case "loto:sell": {
      data.userId = userId;
      const lotoService = getLotoService();
      const ticket = lotoService.sellTicket(data as any);
      return {
        sourceId: ticket.id,
        sourceTable: "loto_tickets",
        transactionType: "loto_ticket",
      };
    }

    case "loto:cash-prize:create": {
      data.userId = userId;
      const lotoService = getLotoService();
      const prize = lotoService.recordCashPrize(data as any);
      return {
        sourceId: prize.id,
        sourceTable: "loto_cash_prizes",
        transactionType: "loto_prize",
      };
    }

    case "custom-services:add": {
      const customService = getCustomServiceService();
      const result = customService.addService(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to add custom service");
      }
      return {
        sourceId: result.id,
        sourceTable: "custom_services",
        transactionType: "custom_service",
      };
    }

    case "maintenance:save": {
      const maintenanceService = getMaintenanceService();
      const result = maintenanceService.saveJob(data as any);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to save maintenance job");
      }
      return {
        sourceId: result.id,
        sourceTable: "maintenance",
        transactionType: "maintenance",
      };
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
  exchangeRate: number | undefined,
  userId: number,
): ProcessedItem[] {
  const results: ProcessedItem[] = [];
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
    results.push(processCartItem(subCartItem, exchangeRate, userId));
  }

  return results;
}

/** Map checkout payment legs (snake_case) to the camelCase shape the
 *  basket recorder expects (with IN/OUT direction). */
function checkoutPaymentsToBasketLegs(payments: CheckoutPayment[]) {
  return payments.map((p) => ({
    method: p.method,
    currencyCode: p.currency_code,
    amount: p.amount,
    direction: p.direction ?? ("IN" as const),
    voucherCode: (p as { voucher_code?: string }).voucher_code,
  }));
}

/** Resolve the unified transactions.id for a just-created source record. */
function resolveUnifiedTransactionId(
  sourceTable: string,
  sourceId: number,
): number | null {
  const txn = getTransactionRepository().getBySourceId(sourceTable, sourceId);
  return txn ? txn.id : null;
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
              {
                full_name: data.customer_name,
                phone_number: data.customer_phone,
              },
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
        // Validate the basket payment envelope (payments + exchangeRate) before
        // touching the database. cartItems.formData is opaque (validated by each
        // module's own service), so only the basket-payment fields are checked.
        const validation = validatePayload(SessionCheckoutSchema, request);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }

        const { sessionId, cartItems, payments, exchangeRate, userId } =
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
                  exchangeRate,
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
                  // Resolve the UNIFIED transactions.id for viewer grouping +
                  // basket-leg attachment, then link the sub-transaction.
                  const unifiedId = resolveUnifiedTransactionId(
                    result.sourceTable,
                    result.sourceId,
                  );
                  repo.linkTransaction(
                    sessionId,
                    result.transactionType,
                    result.sourceId,
                    item.currency === "USD"
                      ? item.amount / batchResults.length
                      : 0,
                    item.currency === "LBP"
                      ? item.amount / batchResults.length
                      : 0,
                    subProfitUsd,
                    subProfitLbp,
                    unifiedId,
                  );
                  itemResults.push({
                    cartItemId: item.id,
                    module: item.module,
                    transactionId: result.sourceId,
                    success: true,
                  });
                }
              } else {
                // Single item — process in deferred-payment mode (the basket
                // recorder owns the customer payment for the whole cart).
                const result = processCartItem(item, exchangeRate, userId);

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

                // Resolve the UNIFIED transactions.id for viewer grouping +
                // basket-leg attachment, then link the transaction.
                const unifiedId = resolveUnifiedTransactionId(
                  result.sourceTable,
                  result.sourceId,
                );
                repo.linkTransaction(
                  sessionId,
                  result.transactionType,
                  result.sourceId,
                  item.currency === "USD" ? item.amount : 0,
                  item.currency === "LBP" ? item.amount : 0,
                  itemProfitUsd,
                  itemProfitLbp,
                  unifiedId,
                );

                itemResults.push({
                  cartItemId: item.id,
                  module: item.module,
                  transactionId: result.sourceId,
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

          // AFTER all items are created (in deferred mode): record the ONE
          // customer-facing payment for the whole basket — posts each leg to its
          // drawer once, creates one debt entry for the CUSTOMER_ACCOUNT portion,
          // redeems gift cards, and back-fills each session SALE's paid state.
          if (payments && payments.length > 0) {
            getSessionPaymentService().recordBasketPayment(sessionId, {
              legs: checkoutPaymentsToBasketLegs(payments),
              exchangeRate: exchangeRate && exchangeRate > 0 ? exchangeRate : 1,
              userId,
              clientId: sessionClientId ?? null,
            });
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
