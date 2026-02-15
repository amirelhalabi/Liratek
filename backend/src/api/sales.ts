import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getSalesService,
  createSaleSchema,
  getSaleSchema,
} from "@liratek/core";
import { emitEvent } from "../websocket/io.js";

const router = express.Router();

// All sales routes require auth
router.use(authenticateJWT);

// GET /api/sales/drafts
router.get("/drafts", (_req, res) => {
  const service = getSalesService();
  const drafts = service.getDrafts();
  res.json({ success: true, drafts });
});

// GET /api/sales/today
router.get("/today", (_req, res) => {
  const service = getSalesService();
  const sales = service.getTodaysSales();
  res.json({ success: true, sales });
});

// GET /api/sales/top-products
router.get("/top-products", (_req, res) => {
  const service = getSalesService();
  const products = service.getTopProducts();
  res.json({ success: true, products });
});

// GET /api/sales/:id
router.get("/:id", validateParams(getSaleSchema), (req, res) => {
  const service = getSalesService();
  const saleId = req.params.id as unknown as number;

  try {
    const sale = service.getSale(saleId);
    return res.json({ success: true, sale });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not found";
    return res.status(404).json({ success: false, error: message });
  }
});

// GET /api/sales/:id/items
router.get("/:id/items", (req, res) => {
  const service = getSalesService();
  const saleId = parseInt(req.params.id, 10);

  if (isNaN(saleId)) {
    return res.status(400).json({ success: false, error: "Invalid sale ID" });
  }

  try {
    const items = service.getSaleItems(saleId);
    return res.json({ success: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not found";
    return res.status(404).json({ success: false, error: message });
  }
});

// POST /api/sales/process
router.post(
  "/process",
  requireRole(["admin"]),
  validateRequest(createSaleSchema),
  (req, res) => {
    const service = getSalesService();
    const result = service.processSale(req.body);

    if (result.success) {
      emitEvent("sales:processed", {
        saleId: result.saleId,
        at: new Date().toISOString(),
      });
    }

    res.status(result.success ? 200 : 400).json(result);
  },
);

export default router;
