/**
 * Transactions API Endpoints
 *
 * Unified transaction queries, void/refund operations, analytics.
 */

import { Router } from "express";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import {
  getTransactionService,
  getReportingService,
  voidCheckoutGroupSchema,
  refundLegsSchema,
  refundUnitExtrasSchema,
} from "@liratek/core";
import { validateParams } from "../middleware/validation.js";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = Router();

// GET /api/transactions/recent?limit=50&type=SALE&status=ACTIVE&from=...&to=...
router.get("/recent", requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const filters: Record<string, unknown> = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.user_id)
      filters.user_id = parseInt(req.query.user_id as string);
    if (req.query.client_id)
      filters.client_id = parseInt(req.query.client_id as string);
    if (req.query.source_table) filters.source_table = req.query.source_table;
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;

    const txnService = getTransactionService();
    const transactions = txnService.getRecent(
      limit,
      filters as Parameters<typeof txnService.getRecent>[1],
    );
    res.json({ success: true, transactions });
  } catch (error) {
    logger.error({ error }, "Get recent transactions error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get transactions" });
  }
});

// GET /api/transactions/by-source/:sourceTable/:sourceId
// LIRA-069 W1.c/d: resolve the unified transaction for a module row (the
// History-modal Print button and auto-print-on-success hook only know the
// module's own PK). Static path — placed before /:id so it can never be
// swallowed by that single-segment route.
router.get(
  "/by-source/:sourceTable/:sourceId",
  requireAuth,
  async (req, res) => {
    try {
      const { sourceTable } = req.params;
      const sourceId = parseInt(req.params.sourceId, 10);
      const txnService = getTransactionService();
      const transaction = txnService.getBySourceId(sourceTable, sourceId);
      res.json({ success: true, transaction });
    } catch (error) {
      logger.error({ error }, "Get transaction by source error");
      res
        .status(500)
        .json({ success: false, error: "Failed to get transaction" });
    }
  },
);

// GET /api/transactions/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const txnService = getTransactionService();
    const transaction = txnService.getById(id);
    if (!transaction) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }
    res.json({ success: true, transaction });
  } catch (error) {
    logger.error({ error }, "Get transaction by ID error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get transaction" });
  }
});

// GET /api/transactions/client/:clientId?limit=100
router.get("/client/:clientId", requireAuth, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const txnService = getTransactionService();
    const transactions = txnService.getByClientId(clientId, limit);
    res.json({ success: true, transactions });
  } catch (error) {
    logger.error({ error }, "Get client transactions error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get client transactions" });
  }
});

// POST /api/transactions/:id/void
router.post(
  "/:id/void",
  requireAuth,
  requireRole(["admin"]),
  async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.userId ?? 1;
      const txnService = getTransactionService();
      const reversalId = txnService.voidTransaction(id, userId);
      // Reaching here means the void committed — voidTransaction throws on
      // any business-rule failure (caught below as a 500), it never returns
      // a { success: false } result. Mirrors transactionHandlers.ts's
      // transactions:void audit (void/transaction).
      auditRest(req, {
        action: "void",
        entity_type: "transaction",
        entity_id: String(id),
        summary: `Voided transaction #${id}`,
        metadata: { reversalId },
      });
      res.json({ success: true, reversalId });
    } catch (error) {
      logger.error({ error }, "Void transaction error");
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

// POST /api/transactions/:id/refund
// LIRA-078: an optional `refundLegs` body field lets the operator choose the
// return method(s) instead of the default mirror-verbatim reversal. Validated
// with the SAME core schema the IPC handler uses (rule 14) — but only when
// present: a plain `POST /:id/refund` with no body must still work exactly as
// before (`validateRequest`'s whole-body `schema.parse` would choke on an
// undefined/empty body here, so this validates the field directly instead of
// wrapping the route in that middleware).
//
// LIRA-143 phase 5: an optional `refundUnitExtras` body field rides alongside
// `refundLegs` on the SAME call (rule 16 — one payload, no follow-up call) —
// the phone-refund UI's per-unit defective/warranty-override flags, also
// validated only when present.
router.post(
  "/:id/refund",
  requireAuth,
  requireRole(["admin"]),
  async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.userId ?? 1;

      let refundLegs: ReturnType<typeof refundLegsSchema.parse> | undefined;
      if (req.body?.refundLegs !== undefined) {
        const parsed = refundLegsSchema.safeParse(req.body.refundLegs);
        if (!parsed.success) {
          const firstError = parsed.error.issues[0];
          res.status(400).json({
            success: false,
            error: firstError?.message ?? "Invalid refundLegs",
          });
          return;
        }
        refundLegs = parsed.data;
      }

      let refundUnitExtras:
        | ReturnType<typeof refundUnitExtrasSchema.parse>
        | undefined;
      if (req.body?.refundUnitExtras !== undefined) {
        const parsed = refundUnitExtrasSchema.safeParse(
          req.body.refundUnitExtras,
        );
        if (!parsed.success) {
          const firstError = parsed.error.issues[0];
          res.status(400).json({
            success: false,
            error: firstError?.message ?? "Invalid refundUnitExtras",
          });
          return;
        }
        refundUnitExtras = parsed.data;
      }

      const txnService = getTransactionService();
      const refundId = txnService.refundTransaction(id, userId, {
        refundLegs,
        refundUnitExtras,
      });
      // Mirrors transactionHandlers.ts's transactions:refund audit
      // (refund/transaction) — reaching here means the refund committed
      // (refundTransaction throws on any business-rule failure).
      auditRest(req, {
        action: "refund",
        entity_type: "transaction",
        entity_id: String(id),
        summary: `Refunded transaction #${id}`,
        metadata: { refundId, refundLegs, refundUnitExtras },
      });
      res.json({ success: true, refundId });
    } catch (error) {
      logger.error({ error }, "Refund transaction error");
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

// POST /api/transactions/checkout-group/:groupId/void
// CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): void every non-voided member of
// a multi-unit split checkout in ONE transaction. A single void/refund of one
// member alone is refused by /:id/void and /:id/refund above — this is the
// only legitimate way to reverse one. Static "checkout-group" segment, so
// this can never collide with /:id/void (different segment count, and Express
// routes GET/POST independently regardless).
router.post(
  "/checkout-group/:groupId/void",
  requireAuth,
  requireRole(["admin"]),
  validateParams(voidCheckoutGroupSchema),
  async (req: AuthRequest, res) => {
    try {
      const { groupId } = req.params as unknown as { groupId: string };
      const userId = req.user?.userId ?? 1;
      const txnService = getTransactionService();
      const result = txnService.voidCheckoutGroup(groupId, userId);
      // Mirrors transactionHandlers.ts's void-checkout-group audit
      // (void/transaction_group) — reaching here means it committed
      // (voidCheckoutGroup throws on any business-rule failure).
      auditRest(req, {
        action: "void",
        entity_type: "transaction_group",
        entity_id: groupId,
        summary: `Voided checkout group ${groupId} (${result.memberCount} units)`,
        metadata: {
          memberCount: result.memberCount,
          voidedTransactionIds: result.voidedTransactionIds,
          reversalIds: result.reversalIds,
        },
      });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error({ error }, "Void checkout group error");
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

// GET /api/transactions/analytics/daily-summary?date=2025-01-15
router.get("/analytics/daily-summary", requireAuth, async (req, res) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      res
        .status(400)
        .json({ success: false, error: "date query parameter required" });
      return;
    }
    const txnService = getTransactionService();
    const summary = txnService.getDailySummary(date);
    res.json({ success: true, summary });
  } catch (error) {
    logger.error({ error }, "Daily summary error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get daily summary" });
  }
});

// GET /api/transactions/analytics/debt-aging/:clientId
router.get("/analytics/debt-aging/:clientId", requireAuth, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const txnService = getTransactionService();
    const aging = txnService.getClientDebtAging(clientId);
    res.json({ success: true, aging });
  } catch (error) {
    logger.error({ error }, "Debt aging error");
    res.status(500).json({ success: false, error: "Failed to get debt aging" });
  }
});

// GET /api/transactions/analytics/overdue-debts
router.get("/analytics/overdue-debts", requireAuth, async (_req, res) => {
  try {
    const txnService = getTransactionService();
    const overdueDebts = txnService.getOverdueDebts();
    res.json({ success: true, overdueDebts });
  } catch (error) {
    logger.error({ error }, "Overdue debts error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get overdue debts" });
  }
});

// GET /api/transactions/analytics/revenue-by-type?from=...&to=...
router.get("/analytics/revenue-by-type", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) {
      res.status(400).json({
        success: false,
        error: "from and to query parameters required",
      });
      return;
    }
    const txnService = getTransactionService();
    const revenue = txnService.getRevenueByType(from, to);
    res.json({ success: true, revenue });
  } catch (error) {
    logger.error({ error }, "Revenue by type error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get revenue by type" });
  }
});

// GET /api/transactions/analytics/revenue-by-user?from=...&to=...
router.get("/analytics/revenue-by-user", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) {
      res.status(400).json({
        success: false,
        error: "from and to query parameters required",
      });
      return;
    }
    const txnService = getTransactionService();
    const revenue = txnService.getRevenueByUser(from, to);
    res.json({ success: true, revenue });
  } catch (error) {
    logger.error({ error }, "Revenue by user error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get revenue by user" });
  }
});

// ==================== REPORTING ====================

// GET /api/transactions/reports/daily-summaries?from=...&to=...
router.get("/reports/daily-summaries", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) {
      res.status(400).json({
        success: false,
        error: "from and to query parameters required",
      });
      return;
    }
    const reporting = getReportingService();
    const summaries = reporting.getDailySummaries(from, to);
    res.json({ success: true, summaries });
  } catch (error) {
    logger.error({ error }, "Daily summaries report error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get daily summaries" });
  }
});

// GET /api/transactions/reports/client-history/:clientId?limit=500
router.get(
  "/reports/client-history/:clientId",
  requireAuth,
  async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 500;
      const reporting = getReportingService();
      const history = reporting.getClientHistory(clientId, limit);
      res.json({ success: true, history });
    } catch (error) {
      logger.error({ error }, "Client history report error");
      res
        .status(500)
        .json({ success: false, error: "Failed to get client history" });
    }
  },
);

// GET /api/transactions/reports/revenue-by-module?from=...&to=...
router.get("/reports/revenue-by-module", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) {
      res.status(400).json({
        success: false,
        error: "from and to query parameters required",
      });
      return;
    }
    const reporting = getReportingService();
    const revenue = reporting.getRevenueByModule(from, to);
    res.json({ success: true, revenue });
  } catch (error) {
    logger.error({ error }, "Revenue by module report error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get revenue by module" });
  }
});

// GET /api/transactions/reports/overdue-debts
router.get("/reports/overdue-debts", requireAuth, async (_req, res) => {
  try {
    const reporting = getReportingService();
    const overdueDebts = reporting.getOverdueDebts();
    res.json({ success: true, overdueDebts });
  } catch (error) {
    logger.error({ error }, "Overdue debts report error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get overdue debts" });
  }
});

export default router;
