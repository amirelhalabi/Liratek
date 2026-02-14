/**
 * Closing API Endpoints
 *
 * Handles daily opening and closing workflows
 */

import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getClosingService,
  setOpeningBalancesSchema,
  createDailyClosingSchema,
} from "@liratek/core";
import { logger } from "../server.js";

const router = Router();
const closingService = getClosingService();

// GET /api/closing/system-expected-balances
router.get("/system-expected-balances", requireAuth, async (_req, res) => {
  try {
    const balances = closingService.getSystemExpectedBalances();
    res.json({ success: true, balances });
  } catch (error) {
    logger.error({ error }, "Get system expected balances error");
    res.status(500).json({
      success: false,
      error: "Failed to get system expected balances",
    });
  }
});

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
      const result = closingService.setOpeningBalances({
        ...req.body,
        userId: req.body.userId || req.user?.userId,
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
      const result = closingService.createDailyClosing({
        ...req.body,
        userId: req.body.userId || req.user?.userId,
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
      user_id: user_id || req.user?.userId,
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

export default router;
