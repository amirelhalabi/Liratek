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
import { getTransactionService, getReportingService } from "@liratek/core";
import { logger } from "../server.js";

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
  requireRole(["admin"]),
  async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.userId ?? 1;
      const txnService = getTransactionService();
      const reversalId = txnService.voidTransaction(id, userId);
      res.json({ success: true, reversalId });
    } catch (error) {
      logger.error({ error }, "Void transaction error");
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

// POST /api/transactions/:id/refund
router.post(
  "/:id/refund",
  requireRole(["admin"]),
  async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.userId ?? 1;
      const txnService = getTransactionService();
      const refundId = txnService.refundTransaction(id, userId);
      res.json({ success: true, refundId });
    } catch (error) {
      logger.error({ error }, "Refund transaction error");
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
