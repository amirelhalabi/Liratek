/**
 * Closing API Endpoints
 *
 * Handles daily opening and closing workflows
 */

import { Router } from "express";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
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

// GET /api/closing/last-checkpoint-per-drawer — drawer status board (staleness
// badges, dashboard). Mirrors IPC's closing:get-last-checkpoint-per-drawer
// envelope exactly: {success:true, data} / {success:false, error}.
router.get("/last-checkpoint-per-drawer", requireAuth, async (_req, res) => {
  try {
    const data = closingService.getLastCheckpointPerDrawer();
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Get last checkpoint per drawer error");
    res.status(500).json({
      success: false,
      error: "Failed to get last checkpoint per drawer",
    });
  }
});

// GET /api/closing/has-initial-balances-set — whether initial drawer amounts
// have ever been set (dashboard setup banner). Mirrors the IPC handler's
// contract: it never throws to the caller, it resolves with a conservative
// default (false) on internal failure — so this route always answers 200
// with {success, isSet}, never a hard error status, keeping the two
// transports byte-identical for this specific read.
router.get("/has-initial-balances-set", requireAuth, async (_req, res) => {
  try {
    const isSet = closingService.hasInitialBalancesSet();
    res.json({ success: true, isSet });
  } catch (error) {
    logger.error({ error }, "Check initial balances set error");
    res.json({ success: false, isSet: false });
  }
});

// GET /api/closing/has-starting-checkpoint — whether a starting checkpoint
// has ever been recorded (session-management setup banner). Same
// never-throws contract as above; the IPC handler's conservative default on
// failure is `true` here (so the setup banner never wrongly fires when
// checkpoints are enabled) — deliberately the OPPOSITE default of
// has-initial-balances-set above, matching dbHandlers.ts:373-389.
router.get("/has-starting-checkpoint", requireAuth, async (_req, res) => {
  try {
    const isSet = closingService.hasStartingCheckpoint();
    res.json({ success: true, isSet });
  } catch (error) {
    logger.error({ error }, "Check starting checkpoint error");
    res.json({ success: false, isSet: true });
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
        // No IPC precedent (setOpeningBalances is never called from any
        // electron-app handler) — new vocabulary per the ticket.
        auditRest(req, {
          action: "create",
          entity_type: "opening_balance",
          summary: `Set opening balances for ${req.body.closingDate}`,
        });
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
        // No IPC precedent (createDailyClosing is never called from any
        // electron-app handler) — new vocabulary per the ticket, distinct
        // from the create_checkpoint/daily_closings action below.
        auditRest(req, {
          action: "create",
          entity_type: "daily_closings",
          summary: `Created daily closing for ${req.body.closingDate}`,
        });
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
      // Mirrors dbHandlers.ts's closing:update-daily-closing audit.
      auditRest(req, {
        action: "update",
        entity_type: "daily_closings",
        entity_id: String(id),
        summary: `Updated daily closing #${id}`,
      });
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
//
// The optional `carrier_lines[]` (per-line MTC/Alfa SIM count, plan Phase 3)
// needs no code here: `{...req.body}` forwards it and it is declared on the
// shared `createCheckpointSchema`. That declaration is load-bearing — with the
// field absent from the schema, `validateRequest` would strip it from the body
// and the count would post on desktop but silently vanish on web.
router.post(
  "/checkpoint",
  requireAuth,
  adminGate,
  validateRequest(createCheckpointSchema),
  (req: AuthRequest, res) => {
    try {
      const user_id = req.user!.userId;
      const result = closingService.createCheckpoint({ ...req.body, user_id });
      if (result.success) {
        // Mirrors dbHandlers.ts's closing:create-checkpoint audit.
        auditRest(req, {
          action: "create_checkpoint",
          entity_type: "daily_closings",
          entity_id: String(result.id ?? ""),
          summary: `Checkpoint created: ${req.body.drawer_name}`,
        });
      }
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
  (req: AuthRequest, res) => {
    try {
      const result = closingService.recalculateDrawerBalances();
      if (result.success) {
        // Mirrors dbHandlers.ts's closing:recalculate-drawer-balances audit.
        auditRest(req, {
          action: "update",
          entity_type: "drawer_balance",
          summary: "Recalculated drawer balances from payments journal",
        });
      }
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
