import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getSalesService,
  saleProcessSchema,
  getSaleSchema,
  getCurrentTenantId,
} from "@liratek/core";
import { emitEvent } from "../websocket/io.js";
import { auditRest } from "../middleware/audit.js";

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
// Validates against saleProcessSchema — the SAME contract the Electron IPC
// handler (sales:process) enforces, passed verbatim to the same
// SalesService.processSale. Staff can process sales, matching the IPC role.
router.post(
  "/process",
  requireRole(["admin", "staff"]),
  validateRequest(saleProcessSchema),
  (req, res) => {
    const service = getSalesService();
    const result = service.processSale(req.body, req.user!.userId);

    if (result.success) {
      // Inside authenticateJWT's runWithTenant() scope (router.use above,
      // this handler is fully synchronous) — getCurrentTenantId() resolves
      // to the requesting tenant, never a guess.
      emitEvent(getCurrentTenantId(), "sales:processed", {
        id: result.id,
        at: new Date().toISOString(),
      });

      // Mirrors salesHandlers.ts's sales:process audit (create/sale) — only
      // a sale that actually committed is audited (a guarded/failed sale,
      // e.g. out of stock, returns { success:false } and is rolled back).
      auditRest(req, {
        action: "create",
        entity_type: "sale",
        entity_id: String(result.id ?? ""),
        summary: `Processed sale (status: ${req.body.status})`,
        metadata: { status: req.body.status, itemCount: req.body.items?.length },
      });
    }

    res.status(result.success ? 200 : 400).json(result);
  },
);

export default router;
