import { ipcMain } from "electron";
import {
  CustomerSessionService,
  getCustomerSessionRepository,
  getUserRepository,
  getSessionCheckoutService,
  type CheckoutRequest,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { validatePayload, SessionCheckoutSchema } from "../schemas/index.js";
import { audit } from "./auditHelper.js";

const sessionService = new CustomerSessionService();


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

      // Client auto-registration (name+phone) happens inside
      // CustomerSessionService.startSession so the web backend route gets the
      // same behavior — do not re-add it here.
      const result = await sessionService.startSession({
        ...data,
        started_by,
        user_id: auth.userId,
      });

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
      return sessionService.updateSession(sessionId, data, auth.userId);
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

  // Batch checkout — thin wrapper over the shared core SessionCheckoutService
  // (the orchestration was extracted to packages/core in WP4). Resolves the
  // Electron session's operator + validates the basket envelope, then delegates.
  ipcMain.handle("session:checkout", async (event, request: unknown) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };

    // Validate the basket-payment envelope (payments + exchangeRate) before
    // touching the DB. cartItems.formData is opaque (each module service
    // validates its own), so only the basket-payment fields are checked.
    const validation = validatePayload(SessionCheckoutSchema, request);
    if (!validation.ok) return { success: false, error: validation.error };

    const username =
      getUserRepository().findByIdSafe(auth.userId)?.username ||
      String(auth.userId);

    // Stamp the AUTHENTICATED operator on every record checkout creates
    // (items, payments, client registration) — never the wire-supplied userId.
    const result = await getSessionCheckoutService().checkout(
      {
        ...(validation.data as unknown as CheckoutRequest),
        userId: auth.userId,
      },
      { username },
    );

    if (result.success) {
      audit(event.sender.id, {
        action: "update",
        entity_type: "customer_session",
        entity_id: String(validation.data.sessionId),
        summary: `Session checkout: ${result.itemCount} items, USD ${(result.checkoutTotalUsd ?? 0).toFixed(2)}, LBP ${(result.checkoutTotalLbp ?? 0).toFixed(0)}`,
      });
    }
    return result;
  });

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
