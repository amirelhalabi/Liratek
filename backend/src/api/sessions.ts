/**
 * Customer session REST routes — HTTP twin of
 * electron-app/handlers/sessionHandlers.ts (non-checkout surface).
 *
 * Parity rules (same as loto.ts): IPC-identical envelopes
 * (`{ success, <key> }`; 200 + `{ success:false, error }` on failure so the
 * frontend adapter unwraps the same keys and pages branch on `result.success`,
 * not HTTP status). Both transports call the same core CustomerSessionService /
 * CustomerSessionRepository. Checkout is deliberately NOT here — it is added in
 * WP4 once the orchestration is extracted into a core service.
 *
 * Route ordering: every static path is declared BEFORE `/:id` so Express does
 * not capture "active", "today", "range", etc. as an id.
 */
import { Router, Request, Response } from "express";
import {
  CustomerSessionService,
  getCustomerSessionRepository,
  getSessionCheckoutService,
  sessionCheckoutSchema,
  type SessionCheckoutInput,
  type CheckoutRequest,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const router = Router();
const sessionService = new CustomerSessionService();

// All customer-session routes require auth (WP2 — this router previously
// mounted with NO auth at all). authenticateJWT also establishes the tenant
// context (runWithTenant) for tenant users, so every route below — including
// /checkout and the cart writes — runs tenant-scoped.
router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);

// safeParse against the core schema, bridging the zod-major type gap (same
// pattern as loto.ts). Runtime API is identical.
type SafeParseable<T> = {
  safeParse: (data: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: Array<{ path: (string | number)[]; message: string }>;
        };
      };
};
const checkoutSchema =
  sessionCheckoutSchema as unknown as SafeParseable<SessionCheckoutInput>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Static read paths (before /:id) ───────────────────────────────────────

// GET /api/sessions/active — the single active session (or null)
router.get("/active", async (_req: Request, res: Response) => {
  try {
    res.json(await sessionService.getActiveSession());
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/sessions/active-list — all active sessions (repo, plural)
router.get("/active-list", (_req: Request, res: Response) => {
  try {
    const sessions = getCustomerSessionRepository().getActiveSessions();
    res.json({ success: true, sessions });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/sessions/today — today's closed+checked-out sessions (summary)
router.get("/today", async (_req: Request, res: Response) => {
  try {
    res.json(await sessionService.getTodaySessions());
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/sessions/today-all — every session started today (active + closed)
router.get("/today-all", async (_req: Request, res: Response) => {
  try {
    res.json(await sessionService.getTodayAllSessions());
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/sessions/range?from&to
router.get("/range", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.json({ success: false, error: "from and to are required" });
      return;
    }
    res.json(await sessionService.getSessionsByDateRange(from, to));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/sessions/by-customer?name&phone
router.get("/by-customer", async (req: Request, res: Response) => {
  try {
    const { name, phone } = req.query as { name?: string; phone?: string };
    if (!name) {
      res.json({ success: false, error: "name is required" });
      return;
    }
    res.json(await sessionService.getSessionsByCustomer(name, phone));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/sessions — recent sessions (limit/offset)
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    res.json(await sessionService.listSessions(limit, offset));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// ── Writes ─────────────────────────────────────────────────────────────────

// POST /api/sessions/start
router.post("/start", writeGate, async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, customer_notes } = req.body;
    const authUser = (req as AuthRequest).user;
    const result = await sessionService.startSession({
      customer_name,
      customer_phone,
      customer_notes,
      started_by: authUser?.username || "unknown",
      user_id: authUser?.userId,
    });
    if (result.success) {
      // Mirrors sessionHandlers.ts's session:start audit
      // (create/customer_session).
      auditRest(req as AuthRequest, {
        action: "create",
        entity_type: "customer_session",
        summary: `Started customer session${customer_name ? ` for "${customer_name}"` : ""}`,
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/sessions/checkout — basket checkout (shared core orchestration).
// Validates the basket envelope against the SAME core schema the IPC handler
// uses, then delegates to SessionCheckoutService (money invariants live there).
router.post("/checkout", writeGate, async (req: Request, res: Response) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      res.json({ success: false, error: `Validation failed: ${msg}` });
      return;
    }
    const authUser = (req as AuthRequest).user;
    // Stamp the AUTHENTICATED operator on every record checkout creates
    // (items, payments, client registration) — never the wire-supplied userId.
    const result = await getSessionCheckoutService().checkout(
      {
        ...(parsed.data as unknown as CheckoutRequest),
        ...(authUser ? { userId: authUser.userId } : {}),
      },
      { username: authUser?.username || "unknown" },
    );
    if (result.success) {
      // Mirrors sessionHandlers.ts's session:checkout audit
      // (update/customer_session).
      auditRest(req as AuthRequest, {
        action: "update",
        entity_type: "customer_session",
        entity_id: String(parsed.data.sessionId),
        summary: `Session checkout: ${result.itemCount} items, USD ${(result.checkoutTotalUsd ?? 0).toFixed(2)}, LBP ${(result.checkoutTotalLbp ?? 0).toFixed(0)}`,
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/sessions/link-transaction
router.post(
  "/link-transaction",
  writeGate,
  async (req: Request, res: Response) => {
    try {
      const {
        sessionId,
        transactionType,
        transactionId,
        amountUsd,
        amountLbp,
      } = req.body;
      if (!transactionType || !transactionId) {
        res.json({
          success: false,
          error: "transactionType and transactionId are required",
        });
        return;
      }
      const result = sessionId
        ? await sessionService.linkTransactionToSession(
            sessionId,
            transactionType,
            transactionId,
            amountUsd || 0,
            amountLbp || 0,
          )
        : await sessionService.linkTransactionToActiveSession(
            transactionType,
            transactionId,
            amountUsd || 0,
            amountLbp || 0,
          );
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// ── Cart persistence (parameterized by session id) ──────────────────────────

// GET /api/sessions/:id/cart
router.get("/:id/cart", (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    const items = getCustomerSessionRepository().getCartItems(id);
    res.json({ success: true, items });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/sessions/:id/cart
router.post("/:id/cart", writeGate, (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    const userId = (req as AuthRequest).user?.userId;
    const newId = getCustomerSessionRepository().addCartItem(id, {
      ...req.body,
      user_id: userId,
    });
    res.json({ success: true, id: newId });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// DELETE /api/sessions/:id/cart — clear the whole cart
router.delete("/:id/cart", writeGate, (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    getCustomerSessionRepository().clearCart(id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// DELETE /api/sessions/:id/cart/:itemId — remove one cart line
router.delete("/:id/cart/:itemId", writeGate, (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    getCustomerSessionRepository().removeCartItem(id, req.params.itemId);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// ── Session by id (parameterized, keep LAST) ────────────────────────────────

// GET /api/sessions/:id — details + linked transactions
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    res.json(await sessionService.getSessionDetails(id));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// PUT /api/sessions/:id — update customer info
router.put("/:id", writeGate, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    const { customer_name, customer_phone, customer_notes } = req.body;
    res.json(
      await sessionService.updateSession(
        id,
        { customer_name, customer_phone, customer_notes },
        (req as AuthRequest).user?.userId,
      ),
    );
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/sessions/:id/close
router.post("/:id/close", writeGate, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    const username = (req as AuthRequest).user?.username || "unknown";
    const result = await sessionService.closeSession(id, username);
    if (result.success) {
      // Mirrors sessionHandlers.ts's session:close audit
      // (update/customer_session).
      auditRest(req as AuthRequest, {
        action: "update",
        entity_type: "customer_session",
        entity_id: String(id),
        summary: `Closed customer session #${id}`,
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// DELETE /api/sessions/:id
router.delete("/:id", writeGate, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid session ID" });
      return;
    }
    const result = await sessionService.deleteSession(id);
    if (result.success) {
      // Mirrors sessionHandlers.ts's session:delete audit
      // (delete/customer_session).
      auditRest(req as AuthRequest, {
        action: "delete",
        entity_type: "customer_session",
        entity_id: String(id),
        summary: `Deleted customer session #${id}`,
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
