/**
 * Product Unit REST routes — HTTP twin of
 * electron-app/handlers/productUnitHandlers.ts (LIRA-143 Phase 5 — phone
 * IMEI units & warranty).
 *
 * Read/intake API surface over the per-IMEI phone unit tracker
 * (`ProductUnitService`/`ProductUnitRepository`). Auth mirrors the IPC
 * handler: reads (`for-product`, `summary`, `story`, `for-sale-items`)
 * require only `authenticateJWT` — no extra role gate, same as
 * `inventory:get-products`/`inventory:get-product-by-barcode` have none on
 * the desktop side; `register`/`delete` are stock-adjacent writes and
 * mirror `POST /api/inventory/products/:id/stock`'s admin-or-staff gate.
 * Envelope mirrors IPC exactly — HTTP 200 even on failure, `{ success,
 * data?, error? }`. Tenant-scoped via authenticateJWT -> runWithTenant.
 */
import express from "express";
import {
  getProductUnitService,
  registerProductUnitsSchema,
  productUnitsForProductSchema,
  productUnitsSummarySchema,
  productUnitIdSchema,
  unitStoryQuerySchema,
  unitsForSaleItemsSchema,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import {
  validateRequest,
  validateParams,
  validateQuery,
} from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

router.use(authenticateJWT);
const writeGate = requireRole(["admin", "staff"]);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// POST /api/product-units/register — intake, admin/staff only
router.post(
  "/register",
  writeGate,
  validateRequest(registerProductUnitsSchema),
  (req, res) => {
    try {
      const result = getProductUnitService().registerUnits(
        req.body.product_id,
        req.body.imeis,
      );
      auditRest(req as AuthRequest, {
        action: "create",
        entity_type: "product_unit",
        entity_id: String(req.body.product_id),
        summary: `Registered ${result.units.length} IMEI unit(s) for product #${req.body.product_id}`,
        metadata: { drift: result.drift },
      });
      res.json({ success: true, data: result });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// GET /api/product-units/for-product/:productId?status=IN_STOCK|SOLD
router.get("/for-product/:productId", (req, res) => {
  try {
    const parsed = productUnitsForProductSchema.safeParse({
      productId: req.params.productId,
      status: req.query.status,
    });
    if (!parsed.success) {
      res.json({
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid request",
      });
      return;
    }
    const data = getProductUnitService().getUnitsForProduct(
      parsed.data.productId,
      parsed.data.status,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/product-units/summary — body { product_ids }
router.post(
  "/summary",
  validateRequest(productUnitsSummarySchema),
  (req, res) => {
    try {
      const data = getProductUnitService().getSummaryForProducts(
        req.body.product_ids,
      );
      res.json({ success: true, data });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// GET /api/product-units/story?imei=...
router.get("/story", validateQuery(unitStoryQuerySchema), (req, res) => {
  try {
    const imei = req.query.imei as unknown as string;
    const data = getProductUnitService().getUnitStory(imei);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/product-units/for-sale-items — body { sale_item_ids } — Phase 6
// refund UI: the units linked to a sale being refunded.
router.post(
  "/for-sale-items",
  validateRequest(unitsForSaleItemsSchema),
  (req, res) => {
    try {
      const data = getProductUnitService().getUnitsForSaleItems(
        req.body.sale_item_ids,
      );
      res.json({ success: true, data });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// DELETE /api/product-units/:id — admin/staff only
router.delete(
  "/:id",
  writeGate,
  validateParams(productUnitIdSchema),
  (req, res) => {
    try {
      const id = req.params.id as unknown as number;
      getProductUnitService().deleteUnit(id);
      auditRest(req as AuthRequest, {
        action: "delete",
        entity_type: "product_unit",
        entity_id: String(id),
        summary: `Deleted product unit #${id}`,
      });
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

export default router;
