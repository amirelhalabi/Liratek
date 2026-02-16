import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import { getPaymentMethodService } from "@liratek/core";
import { logger } from "../server.js";

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
router.post("/", (req, res): void => {
  try {
    const service = getPaymentMethodService();
    const result = service.create(req.body);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (error) {
    logger.error({ error }, "Create payment method error");
    res
      .status(500)
      .json({ success: false, error: "Failed to create payment method" });
  }
});

// PUT /api/payment-methods/:id - Update a payment method
router.put("/:id", (req, res): void => {
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
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Update payment method error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update payment method" });
  }
});

// DELETE /api/payment-methods/:id - Delete a payment method
router.delete("/:id", (req, res): void => {
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
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Delete payment method error");
    res
      .status(500)
      .json({ success: false, error: "Failed to delete payment method" });
  }
});

// PUT /api/payment-methods/reorder - Reorder payment methods
router.put("/reorder", (req, res): void => {
  try {
    const service = getPaymentMethodService();
    const result = service.reorder(req.body.ids);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Reorder payment methods error");
    res
      .status(500)
      .json({ success: false, error: "Failed to reorder payment methods" });
  }
});

export default router;
