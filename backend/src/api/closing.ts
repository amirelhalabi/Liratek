/**
 * Closing API Endpoints
 *
 * Handles daily opening and closing workflows
 */

import { Router, type Response } from "express";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import {
  getClosingService,
  createCheckpointSchema,
  hasOpeningBalanceTodayQuerySchema,
  dailyStatsSnapshotQuerySchema,
  sinceLastCountQuerySchema,
  updateDailyClosingSchema,
  type UpdateDailyClosingInput,
  canIncludeProfit,
  type CheckpointFilters,
  // LIRA-252 wave 2 — now barrel-exported from `@liratek/core`'s
  // `repositories/index.ts` (rule 21: the real shared contract, not a
  // `Parameters<...>` derivation off the service's own signature).
  type CarrierLineAdjustmentFilters,
  // LIRA-335 — checkpoint differences (schemas shared with the IPC twins).
  closeCheckpointDifferenceSchema,
  reopenCheckpointDifferenceSchema,
  openDifferencesAfterSchema,
  type OpenDifferencesAfterInput,
  type CloseCheckpointDifferenceInput,
  redactCheckpointDifferencesForRole,
} from "@liratek/core";
import { hasProfitsUnlock } from "../middleware/profitsUnlock.js";
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

// GET /api/closing/has-opening-balance-today?day=YYYY-MM-DD — `day` is the
// CLIENT's own local calendar day (rule 18/23-style fix, sibling of
// createCheckpoint's `closing_date`): the server can't be trusted to know the
// shop's timezone (web runs on a UTC Fly machine, the shop is Beirut UTC+3),
// so the client sends its own day and the server's `localDay()` is only a
// fallback for a caller that omits it.
router.get(
  "/has-opening-balance-today",
  requireAuth,
  validateQuery(hasOpeningBalanceTodayQuerySchema),
  async (req, res) => {
    try {
      const { day } = req.query as unknown as { day?: string };
      const hasOpening = closingService.hasOpeningBalanceToday(day);
      res.json({ success: true, hasOpening });
    } catch (error) {
      logger.error({ error }, "Check opening balance error");
      res
        .status(500)
        .json({ success: false, error: "Failed to check opening balance" });
    }
  },
);

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

// GET /api/closing/since-last-count?drawers=Whish_App,OMT_App (admin) —
// LIRA-289 FR-010: per drawer, its last count time and the sales recorded on
// it since. Mirrors IPC's closing:get-since-last-count envelope
// ({success, data}); HTTP 200 on failure too (rule 19c).
router.get(
  "/since-last-count",
  requireAuth,
  requireRole(["admin"]),
  validateQuery(sinceLastCountQuerySchema),
  async (req, res) => {
    try {
      const { drawers } = req.query as unknown as { drawers: string[] };
      res.json({
        success: true,
        data: closingService.getTransactionsSinceLastCount(drawers),
      });
    } catch (error) {
      logger.error({ error }, "Get since-last-count error");
      res.json({
        success: false,
        error: "Failed to load sales since the last count",
      });
    }
  },
);

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

// GET /api/closing/daily-stats-snapshot?day=YYYY-MM-DD — `day` is the CLIENT's
// own local calendar day (rule 27, same contract as has-opening-balance-today
// above); the service falls back to `clientDay()` when omitted. E-Q6: the
// profit block is included only for an admin OR a live Profits unlock —
// `canIncludeProfit` (the ONE shared predicate, rule 14) is fed this
// request's own role + `hasProfitsUnlock` read, never re-derived here.
// Rule 19c: HTTP 200 on failure too, matching the IPC envelope — this route
// used to answer 500 on failure, which the IPC side never does.
router.get(
  "/daily-stats-snapshot",
  requireAuth,
  validateQuery(dailyStatsSnapshotQuerySchema),
  async (req: AuthRequest, res) => {
    try {
      const { day } = req.query as unknown as { day?: string };
      const includeProfit = canIncludeProfit(
        req.user?.role,
        req.user ? hasProfitsUnlock(req.user.tenantId, req.user.userId) : false,
      );
      const stats = closingService.getDailyStatsSnapshot(
        { day },
        { includeProfit },
      );
      res.json({ success: true, stats });
    } catch (error) {
      logger.error({ error }, "Get daily stats snapshot error");
      res
        .status(200)
        .json({ success: false, error: "Failed to get daily stats" });
    }
  },
);

// PUT /api/closing/daily-closing/:id — validated against the SAME core schema
// as closing:update-daily-closing (LIRA-297 item 3, rule 14). Every failure is
// the IPC-identical envelope: HTTP 200 + { success: false, error }.
router.put(
  "/daily-closing/:id",
  requireAuth,
  validateRequest(updateDailyClosingSchema),
  async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.json({ success: false, error: "Invalid closing ID" });
        return;
      }

      const body = req.body as UpdateDailyClosingInput;
      const userId = req.user?.userId ?? 1;

      const result = closingService.updateDailyClosing({
        ...body,
        id,
        user_id: userId,
      });

      if (result.success) {
        logger.info({ id, user_id: userId }, "Daily closing updated");
        // Mirrors dbHandlers.ts's closing:update-daily-closing audit.
        auditRest(req, {
          action: "update",
          entity_type: "daily_closings",
          entity_id: String(id),
          summary: `Updated daily closing #${id}`,
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Update daily closing error");
      res
        .status(500)
        .json({ success: false, error: "Failed to update daily closing" });
    }
  },
);

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

// LIRA-335 — checkpoint differences. Twins of the IPC channels
// closing:get-open-differences-after / close-difference / reopen-difference in
// electron-app/handlers/dbHandlers.ts: same roles, same core schemas, the
// IPC-identical envelope (HTTP 200 even on failure), actor from the JWT.

// GET /api/closing/differences/open-after?at=… (admin + staff)
router.get(
  "/differences/open-after",
  requireAuth,
  requireRole(["admin", "staff"]),
  validateQuery(openDifferencesAfterSchema),
  (req: AuthRequest, res) => {
    try {
      const input = req.query as unknown as OpenDifferencesAfterInput;
      const result = closingService.getOpenDifferencesAfter({ at: input.at });
      if (!result.success || !result.data) {
        res.json(result);
        return;
      }
      res.json({
        ...result,
        // Staff see no user names (one rule shared with IPC).
        data: redactCheckpointDifferencesForRole(result.data, req.user?.role),
      });
    } catch (error) {
      logger.error({ error }, "Get open checkpoint differences error");
      res.json({
        success: false,
        error: "Failed to get open checkpoint differences",
      });
    }
  },
);

function differenceWriteRoute(op: "close" | "reopen") {
  return (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as CloseCheckpointDifferenceInput;
      const input = {
        difference_id: body.difference_id,
        userId: req.user!.userId,
      };
      const result =
        op === "close"
          ? closingService.closeCheckpointDifference(input)
          : closingService.reopenCheckpointDifference(input);
      if (result.success) {
        // Mirrors dbHandlers.ts's closing:close-difference / reopen-difference audit.
        auditRest(req, {
          action: `${op}_checkpoint_difference`,
          entity_type: "checkpoint_differences",
          entity_id: String(input.difference_id),
          summary: `Checkpoint difference ${op === "close" ? "closed" : "reopened"}: #${input.difference_id}`,
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, `Checkpoint difference ${op} error`);
      res.json({
        success: false,
        error: `Failed to ${op} checkpoint difference`,
      });
    }
  };
}

// POST /api/closing/differences/close {difference_id} (admin)
router.post(
  "/differences/close",
  requireAuth,
  adminGate,
  validateRequest(closeCheckpointDifferenceSchema),
  differenceWriteRoute("close"),
);

// POST /api/closing/differences/reopen {difference_id} (admin)
router.post(
  "/differences/reopen",
  requireAuth,
  adminGate,
  validateRequest(reopenCheckpointDifferenceSchema),
  differenceWriteRoute("reopen"),
);

// GET /api/closing/checkpoint-timeline — read the checkpoint history. Admin
// only, like the page (owner decision 2026-10-12): counts and variances are
// not for staff. /last-checkpoint-per-drawer stays open — the Dashboard's
// drawer cards read it for every role.
router.get("/checkpoint-timeline", requireAuth, adminGate, async (req, res) => {
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
    // LIRA-335 — only "1"/"true" turn the open-differences filter on.
    if (q.open_only === "1" || q.open_only === "true") filters.open_only = true;

    const result = await closingService.getCheckpointTimeline(filters);
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Get checkpoint timeline error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get checkpoint timeline" });
  }
});

// GET /api/closing/carrier-line-adjustments — read the manual carrier-line
// (MTC/Alfa SIM) drawer-adjustment history (admin only), sibling of
// /checkpoint-timeline above — same manual-query-parsing idiom (rule 14).
router.get(
  "/carrier-line-adjustments",
  requireAuth,
  adminGate,
  async (req, res) => {
    try {
      const q = req.query;
      const filters: CarrierLineAdjustmentFilters = {};
      if (typeof q.date_from === "string") filters.date_from = q.date_from;
      if (typeof q.date_to === "string") filters.date_to = q.date_to;
      if (typeof q.drawer_name === "string")
        filters.drawer_name = q.drawer_name;

      const result = await closingService.getCarrierLineAdjustments(filters);
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Get carrier line adjustments error");
      res.status(500).json({
        success: false,
        error: "Failed to get carrier line adjustments",
      });
    }
  },
);

// GET /api/closing/initial-checkpoint-date — the setup checkpoint's date
// (admin only; read only by the Checkpoint Timeline).
router.get("/initial-checkpoint-date", requireAuth, adminGate, (_req, res) => {
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
