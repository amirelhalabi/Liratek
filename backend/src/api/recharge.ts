import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import {
  getRechargeService,
  createRechargeSchema,
  getRechargeHistorySchema,
  topUpAppSchema,
  topUpFromSupplierSchema,
  topUpFromPartnerSchema,
  topUpFromClientSchema,
  updateRechargeMetadataSchema,
} from "@liratek/core";
import { logger } from "../server.js";
import type { AuthRequest } from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All recharge routes require auth
router.use(authenticateJWT);

// GET /api/recharge/stock - Get virtual stock
// Deliberately NOT role-gated: rule 19c means matching the IPC twin, and
// `recharge:get-stock` (rechargeHandlers.ts:30) has no role check — any
// authenticated session may read stock on desktop. Adding requireRole here
// would make web STRICTER than desktop and 401 staff users on a read.
// If stock should be admin-only, that is a separate decision and must change
// BOTH transports together.
router.get("/stock", (_req, res): void => {
  try {
    const rechargeService = getRechargeService();
    const stock = rechargeService.getStock();
    res.json({ success: true, stock });
  } catch (error) {
    logger.error({ error }, "Get recharge stock error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch recharge stock" });
  }
});

// GET /api/recharge/history - MTC/Alfa recharge history for the history tab
// (Recharge/index.tsx's `loadRechargeHistory`). LIRA-103: this route did not
// exist at all before — the page called raw `window.api.recharge.getHistory`
// with no REST twin, silently yielding an empty history list in the browser.
// Deliberately NOT role-gated: `recharge:get-history` (rechargeHandlers.ts)
// has no requireRole either — same rule-19c rationale as `/stock` above.
// `provider` is validated via `getRechargeHistorySchema` (query, required
// enum) — the IPC handler has no Zod validation to mirror, so this is the
// FIRST schema for it (rules 14 + 19b: the one to reuse if that ever
// changes).
router.get(
  "/history",
  validateQuery(getRechargeHistorySchema),
  (req, res): void => {
    try {
      const provider = req.query.provider as "MTC" | "Alfa";
      const rechargeService = getRechargeService();
      const history = rechargeService.getHistory(provider);
      res.json({ success: true, history });
    } catch (error) {
      logger.error({ error }, "Get recharge history error");
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch recharge history" });
    }
  },
);

// POST /api/recharge/process - Process recharge transaction
// Role-parity with the desktop IPC handler (recharge:process requires
// requireRole(["admin"]) — rechargeHandlers.ts:51); this route previously had
// no role check at all, so any authenticated web user (any role) could move
// the MTC/Alfa drawers.
//
// `createRechargeSchema` is THE shared contract (rules 14 + 19b): the IPC
// handler validates against the same object, re-exported as `RechargeSchema`
// from electron-app/schemas/index.ts. That matters here because
// `validateRequest` REPLACES the body with the parse result, so anything the
// schema doesn't declare is dropped before the service sees it — which is how
// this route used to lose every split payment leg (CARRIER_LINES_VALIDITY_PLAN.md
// Phase 6a; guarded by __tests__/recharge.api.test.ts). Add new recharge fields
// to the core schema, never to a local copy.
router.post(
  "/process",
  requireRole(["admin"]),
  validateRequest(createRechargeSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const userId = (req as AuthRequest).user!.userId;
      const result = rechargeService.processRecharge({
        ...req.body,
        userId,
      });

      if (result.success) {
        // Mirrors rechargeHandlers.ts's recharge:process audit
        // (create/recharge). Gated on success (rule 19c non-negotiable) —
        // the IPC handler itself audits unconditionally, a pre-existing
        // asymmetry noted in the implementation report.
        auditRest(req, {
          action: "create",
          entity_type: "recharge",
          summary: `Recharge ${req.body.provider} ${req.body.type}: ${req.body.amount}`,
          metadata: {
            provider: req.body.provider,
            type: req.body.type,
            amount: req.body.amount,
          },
        });
      }

      // Match the IPC envelope: HTTP 200 with { success: false, error }
      // even on a business-rule failure (rule 19c) — the frontend adapter
      // branches on result.success, not the status code.
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Process recharge error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process recharge" });
    }
  },
);

// GET /api/recharge/drawer-balances - Funding-source balances for the
// top-up modal `handleTopUpClick` opens (Recharge/index.tsx), feeding all
// four top-up arms below. Deliberately NOT role-gated, mirroring
// `recharge:get-drawer-balances` (rechargeHandlers.ts) which has no
// requireRole — same rule-19c rationale as `/stock` above: any authenticated
// session may read balances on desktop, so gating this route would make web
// stricter than desktop. This route closes the review finding that
// `handleTopUpClick` called the raw, unguarded
// `window.api.recharge.getDrawerBalances()` with no REST twin — in the
// browser that throws before `setShowTopUpModal(true)`, so the top-up modal
// for all four arms never opened on web even though their submit routes
// were already wired.
router.get("/drawer-balances", (_req, res): void => {
  try {
    const rechargeService = getRechargeService();
    const balances = rechargeService.getDrawerBalances();
    res.json({ success: true, balances });
  } catch (error) {
    logger.error({ error }, "Get recharge drawer balances error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch drawer balances" });
  }
});

// POST /api/recharge/top-up-app - Top up a provider drawer from another
// drawer (CARRIER_LINES_VALIDITY_PLAN.md Phase 8.4). Role-parity with the
// desktop IPC handler (`recharge:top-up-app` requires
// requireRole(["admin", "staff"]) — rechargeHandlers.ts). `topUpAppSchema`
// is THE shared contract (rules 14 + 19b) — the IPC handler validates
// against the same object, re-exported as `TopUpAppSchema` from
// electron-app/schemas/index.ts.
router.post(
  "/top-up-app",
  requireRole(["admin", "staff"]),
  validateRequest(topUpAppSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const userId = (req as AuthRequest).user!.userId;
      const result = rechargeService.topUpApp({ ...req.body, userId });
      if (result.success) {
        // Mirrors rechargeHandlers.ts's recharge:top-up-app audit
        // (create/recharge_topup).
        auditRest(req, {
          action: "create",
          entity_type: "recharge_topup",
          summary: `App top-up ${req.body.provider}: ${req.body.amount} ${req.body.currency} from ${req.body.sourceDrawer}`,
          metadata: {
            provider: req.body.provider,
            amount: req.body.amount,
            currency: req.body.currency,
            sourceDrawer: req.body.sourceDrawer,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "App top-up error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process app top-up" });
    }
  },
);

// POST /api/recharge/top-up-from-supplier - Top up Katsh/iPick via supplier
// credit (Phase 8.4). Role-parity with `recharge:top-up-from-supplier`
// (requireRole(["admin", "staff"])).
router.post(
  "/top-up-from-supplier",
  requireRole(["admin", "staff"]),
  validateRequest(topUpFromSupplierSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const userId = (req as AuthRequest).user!.userId;
      const result = rechargeService.topUpFromSupplier({
        ...req.body,
        userId,
      });
      if (result.success) {
        // Mirrors rechargeHandlers.ts's recharge:top-up-from-supplier audit
        // (create/recharge_topup).
        auditRest(req, {
          action: "create",
          entity_type: "recharge_topup",
          summary: `Supplier top-up ${req.body.provider}: ${req.body.amount} ${req.body.currency}`,
          metadata: {
            provider: req.body.provider,
            amount: req.body.amount,
            currency: req.body.currency,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Supplier top-up error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process supplier top-up" });
    }
  },
);

// POST /api/recharge/top-up-from-partner - Top up Whish App via a partner's
// credit (Phase 8.4). Role-parity with `recharge:top-up-from-partner`
// (requireRole(["admin", "staff"])).
router.post(
  "/top-up-from-partner",
  requireRole(["admin", "staff"]),
  validateRequest(topUpFromPartnerSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const userId = (req as AuthRequest).user!.userId;
      const result = rechargeService.topUpFromPartner({
        ...req.body,
        userId,
      });
      if (result.success) {
        // Mirrors rechargeHandlers.ts's recharge:top-up-from-partner audit
        // (create/recharge_topup).
        auditRest(req, {
          action: "create",
          entity_type: "recharge_topup",
          summary: `Partner top-up ${req.body.provider}: ${req.body.amount} ${req.body.currency}`,
          metadata: {
            provider: req.body.provider,
            partnerId: req.body.partnerId,
            amount: req.body.amount,
            currency: req.body.currency,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Partner top-up error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process partner top-up" });
    }
  },
);

// POST /api/recharge/top-up-from-client - Top up Whish App with credits a
// client transfers, cash paid out in exchange (Phase 8.4). Role-parity with
// `recharge:top-up-from-client` (requireRole(["admin", "staff"])).
router.post(
  "/top-up-from-client",
  requireRole(["admin", "staff"]),
  validateRequest(topUpFromClientSchema),
  async (req, res): Promise<void> => {
    try {
      const rechargeService = getRechargeService();
      const userId = (req as AuthRequest).user!.userId;
      const result = rechargeService.topUpFromClient({
        ...req.body,
        userId,
      });
      if (result.success) {
        // Mirrors rechargeHandlers.ts's recharge:top-up-from-client audit
        // (create/recharge_topup).
        auditRest(req, {
          action: "create",
          entity_type: "recharge_topup",
          summary: `Client top-up: ${req.body.amount} ${req.body.currency}`,
          metadata: {
            amount: req.body.amount,
            cashPaid: req.body.cashPaid,
            currency: req.body.currency,
            clientName: req.body.clientName,
            clientId: req.body.clientId,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Client top-up error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process client top-up" });
    }
  },
);

// POST /api/recharge/update-metadata - Edit non-financial metadata (phone
// number / client name / note) on a recharge row, driven from the History
// modal's inline edit (LIRA-109). Role-parity with the desktop IPC handler
// (`recharge:update-metadata` requires requireRole(["admin", "staff"]) —
// rechargeHandlers.ts). `updateRechargeMetadataSchema` is THE shared contract
// (rules 14 + 19b) — the IPC handler had NO Zod validation at all before this
// ticket, so this closes that gap on both transports at once (same pattern
// `topUpAppSchema` used in Phase 8.4). `id` is carried IN the body (not a
// `:id` path param) to match this file's existing POST-with-body convention
// (every other write route here does the same) and the IPC payload shape.
//
// `editedBy` is derived from the JWT (`req.user.username`), never trusted
// from the client body — mirrors the IPC handler's server-side username
// resolution (which looks the user up by `auth.userId`; the JWT already
// carries the resolved username, so no repository round-trip is needed here).
router.post(
  "/update-metadata",
  requireRole(["admin", "staff"]),
  validateRequest(updateRechargeMetadataSchema),
  (req, res): void => {
    try {
      const rechargeService = getRechargeService();
      const editedBy = (req as AuthRequest).user!.username;
      const result = rechargeService.updateRechargeMetadata(
        req.body.id,
        {
          phone_number: req.body.phone_number,
          client_name: req.body.client_name,
          note: req.body.note,
        },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        // Mirrors rechargeHandlers.ts's recharge:update-metadata audit
        // (edit_metadata/recharge) — only when something actually changed
        // (a no-op update returns success with no oldValues).
        auditRest(req, {
          action: "edit_metadata",
          entity_type: "recharge",
          entity_id: String(req.body.id),
          summary: `Edited recharge #${req.body.id} metadata`,
          old_values: result.oldValues,
          new_values: req.body,
        });
      }

      // Match the IPC handler's envelope reshaping exactly: { success: true,
      // data: entity } / { success: false, error } (rule 19c) — HTTP 200
      // even on a business-rule failure (e.g. "Recharge not found").
      res.json(
        result.success
          ? { success: true, data: result.entity }
          : { success: false, error: result.error },
      );
    } catch (error) {
      logger.error({ error }, "Update recharge metadata error");
      res
        .status(500)
        .json({ success: false, error: "Failed to update recharge metadata" });
    }
  },
);

export default router;
