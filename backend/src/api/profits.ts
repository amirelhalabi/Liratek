/**
 * Profits API Endpoints
 *
 * Password-gated analytics, any authenticated role: the `profits` module is
 * visible to both `admin` and `staff` (migration v163), but `/profits` and
 * its 7 data endpoints below sit behind a per-page password instead of a
 * role check — admin included (PROFITS_GATE_CONTRACT.md). The four gate
 * routes (password-status / password / unlock / lock) are mounted BEFORE
 * `requireProfitsUnlock` on purpose: they are what let a caller in, so they
 * can never themselves require the thing they grant.
 */

import { Router } from "express";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import {
  requireProfitsUnlock,
  grantProfitsUnlock,
  revokeProfitsUnlock,
} from "../middleware/profitsUnlock.js";
import { profitsUnlockLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import {
  getProfitService,
  getProfitsAccessService,
  localDay,
  localDaysAgo,
  PROFITS_PASSWORD_SETTING_KEY,
  SetProfitsPasswordSchema,
  UnlockProfitsSchema,
} from "@liratek/core";
import { logger } from "../server.js";

const router = Router();

// Every profits route requires SOME authenticated user.
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Password gate — mounted ABOVE requireProfitsUnlock (these are what let a
// caller earn the unlock; they cannot themselves sit behind it).
// ---------------------------------------------------------------------------

// GET /api/profits/password-status — admin+staff, no password needed to ask
// whether one has been set (the lock screen needs this to decide between
// "enter password" and "ask an admin to set one in Settings").
router.get("/password-status", (_req: AuthRequest, res) => {
  try {
    const isSet = getProfitsAccessService().isPasswordSet();
    res.json({ success: true, data: { isSet } });
  } catch (error) {
    logger.error({ error }, "Profits password-status error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get profits password status" });
  }
});

// PUT /api/profits/password — admin only. Sets/replaces the profits password.
router.put(
  "/password",
  requireRole(["admin"]),
  validateRequest(SetProfitsPasswordSchema),
  (req: AuthRequest, res) => {
    try {
      const result = getProfitsAccessService().setPassword(req.body.password);
      if (result.success) {
        // Mirrors settings.ts's PUT /:key audit — action/entity_type match
        // the generic "setting" shape; entity_id is the setting key, never
        // the password or its hash.
        auditRest(req, {
          action: "update",
          entity_type: "setting",
          entity_id: PROFITS_PASSWORD_SETTING_KEY,
          summary: "Set profits page password",
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Profits set-password error");
      res
        .status(500)
        .json({ success: false, error: "Failed to set profits password" });
    }
  },
);

// POST /api/profits/unlock — admin+staff. Rate-limited on FAILED attempts
// only (profitsUnlockLimiter, not strictLimiter — see rateLimit.ts).
router.post(
  "/unlock",
  profitsUnlockLimiter,
  validateRequest(UnlockProfitsSchema),
  (req: AuthRequest, res) => {
    try {
      // ProfitsAccessService.verify() is already fail-closed: it returns
      // false when no password has been set yet, so "no password set" and
      // "wrong password" both land here with no grant — never log the
      // attempted password itself, only who/where.
      const ok = getProfitsAccessService().verify(req.body.password);
      if (!ok) {
        logger.warn(
          { userId: req.user?.userId, ip: req.ip },
          "Profits unlock failed",
        );
        res.json({ success: false, error: "Incorrect password" });
        return;
      }

      // req.user is guaranteed set here (router.use(requireAuth) above ran
      // first), guarded explicitly rather than asserted for type safety.
      if (!req.user) {
        res.status(401).json({ success: false, error: "Not authenticated" });
        return;
      }

      grantProfitsUnlock(req.user.tenantId, req.user.userId);
      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, "Profits unlock error");
      res
        .status(500)
        .json({ success: false, error: "Failed to unlock profits" });
    }
  },
);

// POST /api/profits/lock — admin+staff. Revokes the caller's own unlock
// (client unmount of /profits calls this immediately).
router.post("/lock", (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    revokeProfitsUnlock(req.user.tenantId, req.user.userId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Profits lock error");
    res.status(500).json({ success: false, error: "Failed to lock profits" });
  }
});

// ---------------------------------------------------------------------------
// Everything below requires a live profits unlock — role no longer gates
// these on its own (fail-closed 403 "Profits locked" via requireProfitsUnlock,
// same status code the neighbouring requireRole uses).
// ---------------------------------------------------------------------------
router.use(requireProfitsUnlock);

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

// GET /api/profits/pending?from=...&to=...
router.get("/pending", async (req, res) => {
  try {
    const from = (req.query.from as string) || todayISO();
    const to = (req.query.to as string) || todayISO();
    const data = getProfitService().getPendingProfit(from, to);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Profits pending error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get pending profit" });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return localDay();
}

function daysAgoISO(n: number): string {
  return localDaysAgo(n);
}

export default router;
