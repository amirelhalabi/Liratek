import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getCarrierLineService,
  carrierLineCreateSchema,
  carrierLineUpdateSchema,
  carrierLineUpdateBalanceSchema,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { logger } from "../server.js";

const router = express.Router();

// Carrier Lines (LIRA W6.a — shop SIM-line tracking). Informational only:
// no drawer legs, no checkout/closing involvement. All routes require auth.
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

// POST /api/carrier-lines (admin)
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(carrierLineCreateSchema),
  (req, res): void => {
    try {
      const service = getCarrierLineService();
      const result = service.create(req.body);
      res.status(result.success ? 201 : 400).json(result);
    } catch (error) {
      logger.error({ error }, "Create carrier line error");
      res.status(500).json({ success: false, error: "Failed to create" });
    }
  },
);

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
      void _id; // stripped from the payload — the URL param is authoritative
      const service = getCarrierLineService();
      const result = service.updateBalance(id, data);
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
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error({ error }, "Toggle carrier line error");
    res.status(500).json({ success: false, error: "Failed to toggle" });
  }
});

export default router;
