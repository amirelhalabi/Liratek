/**
 * Profits API Endpoints
 *
 * Admin-only analytics: profit summary, by module, by date, by payment method,
 * by user, and by client.
 */

import { Router } from "express";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { getProfitService } from "@liratek/core";
import { logger } from "../server.js";

const router = Router();

// All profit routes require admin role
router.use(requireAuth);
router.use((req: AuthRequest, res, next) =>
  requireRole(["admin"])(req, res, next),
);

// GET /api/profits/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/summary", async (req, res) => {
  try {
    const from = (req.query.from as string) || todayISO();
    const to = (req.query.to as string) || todayISO();
    const data = getProfitService().getSummary(from, to);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits summary error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get profit summary" });
  }
});

// GET /api/profits/by-module?from=...&to=...
router.get("/by-module", async (req, res) => {
  try {
    const from = (req.query.from as string) || todayISO();
    const to = (req.query.to as string) || todayISO();
    const data = getProfitService().getByModule(from, to);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits by-module error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get profit by module" });
  }
});

// GET /api/profits/by-date?from=...&to=...
router.get("/by-date", async (req, res) => {
  try {
    const from = (req.query.from as string) || daysAgoISO(30);
    const to = (req.query.to as string) || todayISO();
    const data = getProfitService().getByDate(from, to);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits by-date error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get profit by date" });
  }
});

// GET /api/profits/by-payment-method?from=...&to=...
router.get("/by-payment-method", async (req, res) => {
  try {
    const from = (req.query.from as string) || todayISO();
    const to = (req.query.to as string) || todayISO();
    const data = getProfitService().getByPaymentMethod(from, to);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits by-payment-method error");
    res.status(500).json({
      success: false,
      error: "Failed to get profit by payment method",
    });
  }
});

// GET /api/profits/by-user?from=...&to=...
router.get("/by-user", async (req, res) => {
  try {
    const from = (req.query.from as string) || todayISO();
    const to = (req.query.to as string) || todayISO();
    const data = getProfitService().getByUser(from, to);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits by-user error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get profit by user" });
  }
});

// GET /api/profits/by-client?from=...&to=...&limit=20
router.get("/by-client", async (req, res) => {
  try {
    const from = (req.query.from as string) || todayISO();
    const to = (req.query.to as string) || todayISO();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const data = getProfitService().getByClient(from, to, limit);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits by-client error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get profit by client" });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

export default router;
