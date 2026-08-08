import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import {
  getPartnerService,
  partnerCreateSchema,
  partnerUpdateSchema,
  partnerRecordTransactionSchema,
  partnerSettleSchema,
  partnerWriteOffSchema,
  type LedgerFilters,
} from "@liratek/core";
import type { AuthRequest } from "../middleware/auth.js";

const router = express.Router();

// All partner routes require auth — a role-free READ route is still not an
// auth-free route: authenticateJWT establishes the tenant context that the
// repositories fail-closed on.
router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);
// CQ-10 (D4): standalone write-offs are admin-ONLY on both transports —
// stricter than the admin+staff settlement paths above.
const adminGate = requireRole(["admin"]);

function uniqueNameError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : "";
  const causeMsg =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  return (
    msg.includes("UNIQUE") ||
    causeMsg.includes("UNIQUE") ||
    msg.includes("SQLITE_CONSTRAINT") ||
    causeMsg.includes("SQLITE_CONSTRAINT")
  );
}

// ── Reads (any authenticated role) ──────────────────────────────────────────

// GET /api/partners?includeInactive=true
router.get("/", (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const partners = getPartnerService().getAllPartners(includeInactive);
  res.json({ success: true, partners });
});

// GET /api/partners/balances?includeInactive=true  (static — before /:id)
router.get("/balances", (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const balances = getPartnerService().getAllBalances(includeInactive);
  res.json({ success: true, balances });
});

// GET /api/partners/:id/balance
router.get("/:id/balance", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid partner id" });
    return;
  }
  const balance = getPartnerService().getPartnerBalance(id);
  res.json({ success: true, balance });
});

// GET /api/partners/:id/ledger — full statement (partner, balance, breakdown, entries)
router.get("/:id/ledger", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid partner id" });
    return;
  }
  const q = req.query;
  const filters: LedgerFilters = {};
  if (typeof q.startDate === "string") filters.startDate = q.startDate;
  if (typeof q.endDate === "string") filters.endDate = q.endDate;
  if (typeof q.type === "string") filters.type = q.type;
  if (q.mode === "FOR" || q.mode === "THROUGH") filters.mode = q.mode;
  if (typeof q.provider === "string") filters.provider = q.provider;
  if (q.direction === "DEBIT" || q.direction === "CREDIT")
    filters.direction = q.direction;

  try {
    const statement = getPartnerService().getPartnerStatement(
      id,
      Object.keys(filters).length ? filters : undefined,
    );
    res.json({ success: true, statement });
  } catch (error) {
    res.json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get partner ledger",
    });
  }
});

// GET /api/partners/:id  (dynamic — last)
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid partner id" });
    return;
  }
  try {
    const partner = getPartnerService().getPartnerById(id);
    res.json({ success: true, partner });
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get partner",
    });
  }
});

// ── Writes (admin, staff) ───────────────────────────────────────────────────

// POST /api/partners — create a partner
router.post(
  "/",
  writeGate,
  validateRequest(partnerCreateSchema),
  (req, res) => {
    try {
      const partner = getPartnerService().createPartner(req.body);
      // Mirrors partnerHandlers.ts's partners:create audit (create/partner).
      auditRest(req, {
        action: "create",
        entity_type: "partner",
        entity_id: String(partner.id),
        summary: `Created partner "${req.body.name}"`,
        metadata: { name: req.body.name, phone: req.body.phone },
      });
      res.json({ success: true, data: partner });
    } catch (error) {
      res.json({
        success: false,
        error: uniqueNameError(error)
          ? "A partner with this name already exists."
          : "Failed to create partner",
      });
    }
  },
);

// POST /api/partners/transactions — record a manual ledger entry.
// partnerId travels in the body (mirrors the IPC payload); userId is injected.
router.post(
  "/transactions",
  writeGate,
  validateRequest(partnerRecordTransactionSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    try {
      const entry = getPartnerService().recordPartnerTransaction({
        ...req.body,
        userId,
      });
      // Mirrors partnerHandlers.ts's partners:record-transaction audit
      // (create/partner_ledger).
      auditRest(req, {
        action: "create",
        entity_type: "partner_ledger",
        summary: `Partner #${req.body.partnerId} ${req.body.direction}: ${req.body.amount} ${req.body.currency} (${req.body.transactionType ?? "MANUAL"})`,
        metadata: {
          partnerId: req.body.partnerId,
          transactionType: req.body.transactionType,
          amount: req.body.amount,
          currency: req.body.currency,
          direction: req.body.direction,
        },
      });
      res.json({ success: true, data: entry });
    } catch (error) {
      res.json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to record partner transaction",
      });
    }
  },
);

// POST /api/partners/settle — settle a partner balance (userId injected)
router.post(
  "/settle",
  writeGate,
  validateRequest(partnerSettleSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    try {
      const entry = getPartnerService().settle({ ...req.body, userId });
      // Mirrors partnerHandlers.ts's partners:settle audit (settle/partner_ledger).
      auditRest(req, {
        action: "settle",
        entity_type: "partner_ledger",
        summary: `Settled partner #${req.body.partnerId}: ${req.body.amount} ${req.body.currency} via ${req.body.settlementMethod}`,
        metadata: {
          partnerId: req.body.partnerId,
          amount: req.body.amount,
          currency: req.body.currency,
          settlementMethod: req.body.settlementMethod,
        },
      });
      res.json({ success: true, data: entry });
    } catch (error) {
      res.json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to settle partner",
      });
    }
  },
);

// POST /api/partners/write-off (admin-only, D4) — forgive part of a partner
// balance with NO settlement attached (userId injected).
router.post(
  "/write-off",
  adminGate,
  validateRequest(partnerWriteOffSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getPartnerService().writeOff({ ...req.body, userId });
    if (result.success) {
      // Mirrors partnerHandlers.ts's partners:write-off audit
      // (write_off/partner_write_off).
      auditRest(req, {
        action: "write_off",
        entity_type: "partner_write_off",
        summary: `Partner write-off for #${req.body.partnerId}: $${req.body.amount_usd} + ${req.body.amount_lbp} LBP`,
        metadata: {
          partnerId: req.body.partnerId,
          amount_usd: req.body.amount_usd,
          amount_lbp: req.body.amount_lbp,
        },
      });
    }
    res.json(result);
  },
);

// PUT /api/partners/:id — update a partner
router.put(
  "/:id",
  writeGate,
  validateRequest(partnerUpdateSchema),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "Invalid partner id" });
      return;
    }
    try {
      const partner = getPartnerService().updatePartner(id, req.body);
      // Mirrors partnerHandlers.ts's partners:update audit (update/partner).
      auditRest(req, {
        action: "update",
        entity_type: "partner",
        entity_id: String(id),
        summary: `Updated partner #${id}`,
        new_values: req.body as Record<string, unknown>,
      });
      res.json({ success: true, data: partner });
    } catch (error) {
      res.json({
        success: false,
        error: uniqueNameError(error)
          ? "A partner with this name already exists."
          : "Failed to update partner",
      });
    }
  },
);

// POST /api/partners/:id/deactivate
router.post("/:id/deactivate", writeGate, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid partner id" });
    return;
  }
  try {
    getPartnerService().deactivatePartner(id);
    // Mirrors partnerHandlers.ts's partners:deactivate audit (update/partner).
    auditRest(req, {
      action: "update",
      entity_type: "partner",
      entity_id: String(id),
      summary: `Deactivated partner #${id}`,
      old_values: { is_active: true },
      new_values: { is_active: false },
    });
    res.json({ success: true });
  } catch (error) {
    res.json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to deactivate partner",
    });
  }
});

// POST /api/partners/:id/activate
router.post("/:id/activate", writeGate, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid partner id" });
    return;
  }
  try {
    getPartnerService().activatePartner(id);
    // Mirrors partnerHandlers.ts's partners:activate audit (update/partner).
    auditRest(req, {
      action: "update",
      entity_type: "partner",
      entity_id: String(id),
      summary: `Activated partner #${id}`,
      old_values: { is_active: false },
      new_values: { is_active: true },
    });
    res.json({ success: true });
  } catch (error) {
    res.json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to activate partner",
    });
  }
});

export default router;
