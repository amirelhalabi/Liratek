import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getCarrierLineService,
  carrierLineCreateSchema,
  carrierLineUpdateSchema,
  carrierLineUpdateBalanceSchema,
  recordCarrierLineUsageSchema,
} from "@liratek/core";
import type { RecordCarrierLineUsageInput } from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const router = express.Router();

// Carrier Lines (LIRA W6.a — shop SIM-line tracking).
//
// Every route here is informational — no drawer legs, no checkout/closing
// involvement — with ONE exception: `POST /record-usage` (LIRA-145) is a
// money write. It books a `Line_Usage` expense, moves the carrier's credit
// drawer, and writes a linked `carrier_line_movements` row. Treat it under
// the money rules (FEATURE_GUIDE §13), not as a balance edit. All routes
// require auth.
router.use(authenticateJWT);

// GET /api/carrier-lines/active/:carrier — active lines for one carrier
// (the Recharge-tab compact panel). Read-only, no role gate.
router.get("/active/:carrier", (req, res): void => {
  const carrier = req.params.carrier;
  if (carrier !== "alfa" && carrier !== "mtc") {
    res.status(400).json({ success: false, error: "Invalid carrier" });
    return;
  }
  try {
    const service = getCarrierLineService();
    const data = service.getActiveByCarrier(carrier);
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Get active carrier lines error");
    res.status(500).json({ success: false, error: "Failed to get lines" });
  }
});

// GET /api/carrier-lines/active — every active line, all carriers.
router.get("/active", (_req, res): void => {
  try {
    const service = getCarrierLineService();
    const data = service.getAllActive();
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Get active carrier lines error");
    res.status(500).json({ success: false, error: "Failed to get lines" });
  }
});

// GET /api/carrier-lines/primary/:carrier — the primary line for a carrier
// (LIRA-090 §3 decision 8). The primary line is the one that receives
// automated Only-Days credit returns and self-charges by default.
// Read-only, no role gate — mirrors the repo usage in FinancialServiceRepository.
router.get("/primary/:carrier", (req, res): void => {
  const { carrier } = req.params;
  if (carrier !== "alfa" && carrier !== "mtc") {
    res.status(400).json({ success: false, error: "Invalid carrier" });
    return;
  }
  try {
    const service = getCarrierLineService();
    const result = service.getPrimary(carrier);
    // HTTP 200 even when no primary line is set (result.success=false) so
    // the adapter can branch on result.success, not the status code (rule 19c).
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Get primary carrier line error");
    res.status(500).json({ success: false, error: "Failed to get primary" });
  }
});

// GET /api/carrier-lines — admin listing (includes archived).
router.get("/", requireRole(["admin"]), (_req, res): void => {
  try {
    const service = getCarrierLineService();
    const data = service.getAllIncludingInactive();
    res.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, "Get carrier lines error");
    res.status(500).json({ success: false, error: "Failed to get lines" });
  }
});

// POST /api/carrier-lines/record-usage (admin/staff — LIRA-145).
//
// Books CONSUMPTION of a shop line's credits as a `Line_Usage` expense: one
// expenses row, its unified EXPENSE transaction, ONE payment leg against the
// carrier credit drawer ("Alfa"/"MTC" — never cash), and the linked
// `carrier_line_movements` row that makes the whole thing reversible through
// the generic void path. Every rule and every write live in
// `CarrierLineRepository.recordUsage` inside ONE db transaction (rule 13) —
// this route is transport only.
//
// STATIC path, registered BEFORE the `POST /` sibling and ahead of any future
// parameterized POST so `/record-usage` can never be swallowed by a `/:id`
// route.
//
// Roles mirror the IPC channel `carrier-lines:record-usage`
// (`requireRole(e.sender.id, ["admin", "staff"])`, itself matched to
// dbHandlers.ts's `expenses:update-metadata`) — staff may record usage.
router.post(
  "/record-usage",
  requireRole(["admin", "staff"]),
  validateRequest(recordCarrierLineUsageSchema),
  (req, res): void => {
    try {
      const data = req.body as RecordCarrierLineUsageInput;
      const service = getCarrierLineService();
      // Actor comes from the verified JWT ONLY — never from the body.
      const result = service.recordUsage(data, req.user!.userId);
      if (result.success) {
        // Mirrors carrierLineHandlers.ts's carrier-lines:record-usage audit.
        auditRest(req, {
          action: "update",
          entity_type: "carrier_line",
          entity_id: String(data.carrierLineId),
          summary: `Recorded $${result.data?.creditsUsed ?? 0} usage on carrier line #${data.carrierLineId}`,
          metadata: {
            expense_id: result.data?.expenseId,
            transaction_id: result.data?.transactionId,
            credits_used: result.data?.creditsUsed,
            new_credits: result.data?.newCredits,
          },
        });
      }
      // HTTP 200 even on a business rejection (line not found/archived, stale
      // `expectedCurrentCredits`, non-positive delta) — rule 19c: the frontend
      // adapter branches on `result.success`, and `requestJson` THROWS on any
      // non-2xx, which would swallow the envelope. The 400-on-failure siblings
      // below predate that contract; do not copy them here.
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Record carrier line usage error");
      res.status(500).json({ success: false, error: "Failed to record usage" });
    }
  },
);

// POST /api/carrier-lines (admin)
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(carrierLineCreateSchema),
  (req, res): void => {
    try {
      const service = getCarrierLineService();
      const result = service.create(req.body);
      if (result.success) {
        // Mirrors carrierLineHandlers.ts's carrier-lines:create audit.
        auditRest(req, {
          action: "create",
          entity_type: "carrier_line",
          summary: `Added ${req.body.carrier} carrier line ${req.body.phone_number}`,
        });
      }
      res.status(result.success ? 201 : 400).json(result);
    } catch (error) {
      logger.error({ error }, "Create carrier line error");
      res.status(500).json({ success: false, error: "Failed to create" });
    }
  },
);

// PUT /api/carrier-lines/:id/set-primary (admin) — designate a line as the
// primary for its carrier (LIRA-090 §3 decision 8). Clears the previous
// primary holder for that carrier in a single DB transaction.
router.put("/:id/set-primary", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }
  try {
    const service = getCarrierLineService();
    const result = service.setPrimary(id);
    if (result.success) {
      // Mirrors carrierLineHandlers.ts's carrier-lines:set-primary audit.
      auditRest(req, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Set carrier line #${id} as primary (${result.data?.carrier ?? ""})`,
      });
    }
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Set primary carrier line error");
    res.status(500).json({ success: false, error: "Failed to set primary" });
  }
});

// PUT /api/carrier-lines/:id (admin)
router.put("/:id", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }
  const parsed = carrierLineUpdateSchema.safeParse({ ...req.body, id });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    res.status(400).json({
      success: false,
      error: firstIssue?.message ?? "Invalid carrier line payload",
    });
    return;
  }
  try {
    const { id: _id, ...data } = parsed.data;
    void _id; // stripped from the payload — the URL param is authoritative
    const service = getCarrierLineService();
    const result = service.update(id, data);
    if (result.success) {
      // Mirrors carrierLineHandlers.ts's carrier-lines:update audit.
      auditRest(req, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Updated carrier line #${id}`,
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error({ error }, "Update carrier line error");
    res.status(500).json({ success: false, error: "Failed to update" });
  }
});

// PUT /api/carrier-lines/:id/balance (admin/staff — the Recharge-tab inline
// quick-update: credits and/or a new expiry date).
router.put(
  "/:id/balance",
  requireRole(["admin", "staff"]),
  (req, res): void => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }
    const parsed = carrierLineUpdateBalanceSchema.safeParse({
      ...req.body,
      id,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({
        success: false,
        error: firstIssue?.message ?? "Invalid balance payload",
      });
      return;
    }
    try {
      const { id: _id, ...data } = parsed.data;
      void _id; // stripped from the payload — the URL param is authoritative
      const service = getCarrierLineService();
      const result = service.updateBalance(id, data);
      if (result.success) {
        // Mirrors carrierLineHandlers.ts's carrier-lines:update-balance audit.
        auditRest(req, {
          action: "update",
          entity_type: "carrier_line",
          entity_id: String(id),
          summary: `Updated carrier line #${id} balance`,
        });
      }
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logger.error({ error }, "Update carrier line balance error");
      res.status(500).json({ success: false, error: "Failed to update" });
    }
  },
);

// PUT /api/carrier-lines/:id/archive (admin)
router.put("/:id/archive", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }
  try {
    const service = getCarrierLineService();
    const result = service.archive(id);
    if (result.success) {
      // Mirrors carrierLineHandlers.ts's carrier-lines:archive audit.
      auditRest(req, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Archived carrier line #${id}`,
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error({ error }, "Archive carrier line error");
    res.status(500).json({ success: false, error: "Failed to archive" });
  }
});

// PUT /api/carrier-lines/:id/toggle-active (admin)
router.put("/:id/toggle-active", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }
  try {
    const service = getCarrierLineService();
    const result = service.toggleActive(id);
    if (result.success) {
      // Mirrors carrierLineHandlers.ts's carrier-lines:toggle-active audit.
      auditRest(req, {
        action: "update",
        entity_type: "carrier_line",
        entity_id: String(id),
        summary: `Toggled carrier line #${id}`,
      });
    }
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error({ error }, "Toggle carrier line error");
    res.status(500).json({ success: false, error: "Failed to toggle" });
  }
});

export default router;
