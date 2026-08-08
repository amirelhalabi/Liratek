import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { getPaymentMethodService } from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All payment method routes require auth
router.use(authenticateJWT);

// GET /api/payment-methods - List all payment methods
router.get("/", (_req, res): void => {
  try {
    const service = getPaymentMethodService();
    const methods = service.listAll();
    res.json({ success: true, methods });
  } catch (error) {
    logger.error({ error }, "List payment methods error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch payment methods" });
  }
});

// GET /api/payment-methods/active - List active payment methods
router.get("/active", (_req, res): void => {
  try {
    const service = getPaymentMethodService();
    const methods = service.listActive();
    res.json({ success: true, methods });
  } catch (error) {
    logger.error({ error }, "List active payment methods error");
    res.status(500).json({
      success: false,
      error: "Failed to fetch active payment methods",
    });
  }
});

// POST /api/payment-methods - Create a payment method
router.post("/", requireRole(["admin"]), (req, res): void => {
  try {
    const service = getPaymentMethodService();
    const result = service.create(req.body);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    // Mirrors paymentMethodHandlers.ts's payment-methods:create audit
    // (create/payment_method).
    auditRest(req, {
      action: "create",
      entity_type: "payment_method",
      summary: `Created payment method "${req.body.code}"`,
    });
    res.status(201).json(result);
  } catch (error) {
    logger.error({ error }, "Create payment method error");
    res
      .status(500)
      .json({ success: false, error: "Failed to create payment method" });
  }
});

// PUT /api/payment-methods/reorder - Reorder payment methods
// (registered before /:id so Express doesn't match "reorder" as an :id param)
router.put("/reorder", requireRole(["admin"]), (req, res): void => {
  try {
    const service = getPaymentMethodService();
    const result = service.reorder(req.body.ids);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    // Mirrors paymentMethodHandlers.ts's payment-methods:reorder audit
    // (update/payment_method, bulk — no single entity_id).
    auditRest(req, {
      action: "update",
      entity_type: "payment_method",
      summary: `Reordered ${req.body.ids.length} payment methods`,
    });
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Reorder payment methods error");
    res
      .status(500)
      .json({ success: false, error: "Failed to reorder payment methods" });
  }
});

// PUT /api/payment-methods/:id - Update a payment method
router.put("/:id", requireRole(["admin"]), (req, res): void => {
  try {
    const service = getPaymentMethodService();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }
    const result = service.update(id, req.body);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    // Mirrors paymentMethodHandlers.ts's payment-methods:update audit
    // (update/payment_method).
    auditRest(req, {
      action: "update",
      entity_type: "payment_method",
      entity_id: String(id),
      summary: `Updated payment method #${id}`,
    });
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Update payment method error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update payment method" });
  }
});

// DELETE /api/payment-methods/:id - Delete a payment method
router.delete("/:id", requireRole(["admin"]), (req, res): void => {
  try {
    const service = getPaymentMethodService();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }
    const result = service.delete(id);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    // Mirrors paymentMethodHandlers.ts's payment-methods:delete audit
    // (delete/payment_method).
    auditRest(req, {
      action: "delete",
      entity_type: "payment_method",
      entity_id: String(id),
      summary: `Deleted payment method #${id}`,
    });
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Delete payment method error");
    res
      .status(500)
      .json({ success: false, error: "Failed to delete payment method" });
  }
});

export default router;
