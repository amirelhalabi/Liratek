/**
 * Closing API Endpoints
 *
 * Handles daily opening and closing workflows
 */

import { Router } from "express";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getClosingService,
  setOpeningBalancesSchema,
  createDailyClosingSchema,
  createCheckpointSchema,
  type CheckpointFilters,
} from "@liratek/core";
import { logger } from "../server.js";

const router = Router();
const closingService = getClosingService();
const adminGate = requireRole(["admin"]);

// GET /api/closing/system-expected-balances-dynamic
router.get(
  "/system-expected-balances-dynamic",
  requireAuth,
  async (_req, res) => {
    try {
      const balances = closingService.getSystemExpectedBalancesDynamic();
      res.json({ success: true, balances });
    } catch (error) {
      logger.error({ error }, "Get dynamic system expected balances error");
      res.status(500).json({
        success: false,
        error: "Failed to get system expected balances",
      });
    }
  },
);

// GET /api/closing/has-opening-balance-today
router.get("/has-opening-balance-today", requireAuth, async (_req, res) => {
  try {
    const hasOpening = closingService.hasOpeningBalanceToday();
    res.json({ success: true, hasOpening });
  } catch (error) {
    logger.error({ error }, "Check opening balance error");
    res
      .status(500)
      .json({ success: false, error: "Failed to check opening balance" });
  }
});

// GET /api/closing/daily-stats-snapshot
router.get("/daily-stats-snapshot", requireAuth, async (_req, res) => {
  try {
    const stats = closingService.getDailyStatsSnapshot();
    res.json({ success: true, stats });
  } catch (error) {
    logger.error({ error }, "Get daily stats snapshot error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get daily stats" });
  }
});

// POST /api/closing/opening-balances
router.post(
  "/opening-balances",
  requireAuth,
  validateRequest(setOpeningBalancesSchema),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.userId ?? 1;
      const result = closingService.setOpeningBalances({
        ...req.body,
        userId,
      });

      if (result.success) {
        logger.info(
          { closingDate: req.body.closingDate, userId: req.body.userId },
          "Opening balances set",
        );
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error({ error }, "Set opening balances error");
      res
        .status(500)
        .json({ success: false, error: "Failed to set opening balances" });
    }
  },
);

// POST /api/closing/daily-closing
router.post(
  "/daily-closing",
  requireAuth,
  validateRequest(createDailyClosingSchema),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.userId ?? 1;
      const result = closingService.createDailyClosing({
        ...req.body,
        userId,
      });

      if (result.success) {
        logger.info(
          { closingDate: req.body.closingDate, userId: req.body.userId },
          "Daily closing created",
        );
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error({ error }, "Create daily closing error");
      res
        .status(500)
        .json({ success: false, error: "Failed to create daily closing" });
    }
  },
);

// PUT /api/closing/daily-closing/:id
router.put("/daily-closing/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid closing ID" });
    }

    const {
      physical_usd,
      physical_lbp,
      physical_eur,
      system_expected_usd,
      system_expected_lbp,
      variance_usd,
      notes,
      report_path,
      user_id,
    } = req.body;

    const userId = req.user?.userId ?? 1;

    const result = closingService.updateDailyClosing({
      id,
      physical_usd,
      physical_lbp,
      physical_eur,
      system_expected_usd,
      system_expected_lbp,
      variance_usd,
      notes,
      report_path,
      user_id: userId,
    });

    if (result.success) {
      logger.info({ id, user_id }, "Daily closing updated");
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logger.error({ error }, "Update daily closing error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update daily closing" });
  }
});

// POST /api/closing/checkpoint — create a unified checkpoint (money write:
// reconciles each drawer/currency to its physical count). Admin-only, mirroring
// the IPC handler; user_id injected from the JWT (never trusted from client).
router.post(
  "/checkpoint",
  requireAuth,
  adminGate,
  validateRequest(createCheckpointSchema),
  (req: AuthRequest, res) => {
    try {
      const user_id = req.user!.userId;
      const result = closingService.createCheckpoint({ ...req.body, user_id });
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Create checkpoint error");
      res
        .status(500)
        .json({ success: false, error: "Failed to create checkpoint" });
    }
  },
);

// POST /api/closing/recalculate-drawer-balances — rebuild drawer_balances from
// the payments journal (admin-only, mirrors the IPC handler).
router.post(
  "/recalculate-drawer-balances",
  requireAuth,
  adminGate,
  (_req, res) => {
    try {
      const result = closingService.recalculateDrawerBalances();
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Recalculate drawer balances error");
      res.status(500).json({
        success: false,
        error: "Failed to recalculate drawer balances",
      });
    }
  },
);

// GET /api/closing/checkpoint-timeline — read the checkpoint history (any role).
router.get("/checkpoint-timeline", requireAuth, async (req, res) => {
  try {
    const q = req.query;
    const filters: CheckpointFilters = {};
    if (typeof q.date_from === "string") filters.date_from = q.date_from;
    if (typeof q.date_to === "string") filters.date_to = q.date_to;
    if (
      q.type === "OPENING" ||
      q.type === "CLOSING" ||
      q.type === "CHECKPOINT" ||
      q.type === "ALL"
    ) {
      filters.type = q.type;
    }
    if (typeof q.drawer_name === "string") filters.drawer_name = q.drawer_name;
    const userId = Number(q.user_id);
    if (Number.isFinite(userId)) filters.user_id = userId;

    const result = await closingService.getCheckpointTimeline(filters);
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Get checkpoint timeline error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get checkpoint timeline" });
  }
});

// GET /api/closing/initial-checkpoint-date — the setup checkpoint's date (any role).
router.get("/initial-checkpoint-date", requireAuth, (_req, res) => {
  try {
    const date = closingService.getInitialCheckpointDate();
    res.json({ success: true, date });
  } catch (error) {
    logger.error({ error }, "Get initial checkpoint date error");
    res.status(500).json({
      success: false,
      error: "Failed to get initial checkpoint date",
    });
  }
});

export default router;
