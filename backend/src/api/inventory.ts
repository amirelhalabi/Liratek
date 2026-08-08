import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getInventoryService,
  createProductSchema,
  searchProductsSchema,
  stockAdjustSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
} from "@liratek/core";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All inventory routes require auth
router.use(authenticateJWT);

// GET /api/inventory/products?search=...
router.get("/products", validateQuery(searchProductsSchema), (req, res) => {
  const service = getInventoryService();
  const search =
    typeof req.query.search === "string" ? req.query.search : undefined;
  const products = service.getProducts(search);
  res.json(createSuccessResponse({ products }));
});

// GET /api/inventory/products/:id
router.get("/products/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }

  const service = getInventoryService();
  try {
    const product = service.getProductById(id);
    res.json({ success: true, product });
  } catch {
    res.status(404).json({ success: false, error: "Product not found" });
  }
});

// POST /api/inventory/products (admin)
router.post(
  "/products",
  requireRole(["admin"]),
  validateRequest(createProductSchema),
  (req, res): void => {
    const service = getInventoryService();
    // createProductSchema uses the REST field names (cost_price_usd, stock…);
    // core CreateProductData uses the IPC names (cost_price, stock_quantity…).
    // Passing req.body through unmapped inserted NULL prices.
    const b = req.body;
    const result = service.createProduct({
      barcode: b.barcode ?? null,
      name: b.name,
      category: b.category,
      cost_price: b.cost_price_usd,
      retail_price: b.retail_price_usd,
      stock_quantity: b.stock,
      min_stock_level: b.min_stock_threshold,
      supplier: b.supplier ?? null,
    });

    if (!result.success) {
      const errorMsg = result.error || "Failed to create product";
      const statusCode = errorMsg.includes("already") ? 409 : 400;
      res
        .status(statusCode)
        .json(
          createErrorResponse(
            errorMsg.includes("already")
              ? ErrorCodes.DUPLICATE_BARCODE
              : ErrorCodes.VALIDATION_ERROR,
            errorMsg,
          ),
        );
      return;
    }

    if (result.success) {
      // Mirrors inventoryHandlers.ts's inventory:create-product audit.
      auditRest(req, {
        action: "create",
        entity_type: "product",
        entity_id: String(result.id ?? ""),
        summary: `Created product "${b.name}" (${b.barcode})`,
        new_values: {
          name: b.name,
          barcode: b.barcode,
          cost_price: b.cost_price_usd,
          retail_price: b.retail_price_usd,
        },
      });
    }

    res.status(201).json(createSuccessResponse({ id: result.id }));
  },
);

// PUT /api/inventory/products/:id (admin)
router.put("/products/:id", requireRole(["admin"]), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }

  const service = getInventoryService();
  // Best-effort snapshot for the audit's old_values — getProductById throws
  // NotFoundError for a missing id; updateProduct below is the source of
  // truth for the actual not-found response, so a throw here must not
  // change this route's error behavior.
  let oldProduct: ReturnType<typeof service.getProductById> | undefined;
  try {
    oldProduct = service.getProductById(id);
  } catch {
    oldProduct = undefined;
  }
  const result = service.updateProduct(id, req.body);
  if (result.success) {
    // Mirrors inventoryHandlers.ts's inventory:update-product audit.
    auditRest(req, {
      action: "update",
      entity_type: "product",
      entity_id: String(id),
      summary: `Updated product "${req.body.name}"`,
      old_values: oldProduct
        ? {
            name: oldProduct.name,
            cost_price: oldProduct.cost_price_usd,
            retail_price: oldProduct.selling_price_usd,
          }
        : undefined,
      new_values: {
        name: req.body.name,
        cost_price: req.body.cost_price,
        retail_price: req.body.retail_price,
      },
    });
  }
  res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/inventory/products/:id (admin)
router.delete("/products/:id", requireRole(["admin"]), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }

  const service = getInventoryService();
  const result = service.deleteProduct(id);
  if (result.success) {
    // Mirrors inventoryHandlers.ts's inventory:delete-product audit.
    auditRest(req, {
      action: "delete",
      entity_type: "product",
      entity_id: String(id),
      summary: `Deleted product #${id}`,
    });
  }
  res.status(result.success ? 200 : 400).json(result);
});

// POST /api/inventory/products/:id/stock (admin/staff — matches the IPC
// handler's roles per rule 19b). Validates against the SAME
// `stockAdjustSchema` the IPC handler uses (rule 14/19) by merging the URL
// `:id` param into the body before parsing — REST callers never send `id`
// in the body, only the transport-agnostic {newQuantity|delta, reason}.
// `userId` comes from the JWT (req.user), never the client body (rule 19c).
router.post(
  "/products/:id/stock",
  requireRole(["admin", "staff"]),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }

    const parsed = stockAdjustSchema.safeParse({ ...req.body, id });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({
        success: false,
        error: firstIssue?.message ?? "Invalid stock adjustment payload",
      });
      return;
    }
    const { newQuantity, delta, reason } = parsed.data;
    const userId = req.user!.userId;

    const service = getInventoryService();
    const result =
      delta !== undefined
        ? service.adjustStockDelta(id, delta, reason, userId)
        : service.adjustStock(id, newQuantity as number, reason, userId);

    if (result.success) {
      // Mirrors inventoryHandlers.ts's inventory:adjust-stock audit.
      auditRest(req, {
        action: "update",
        entity_type: "product",
        entity_id: String(id),
        summary:
          delta !== undefined
            ? `Adjusted stock for product #${id} by ${delta > 0 ? "+" : ""}${delta} (${reason})`
            : `Adjusted stock for product #${id} to ${newQuantity} (${reason})`,
        new_values: { newQuantity, delta, reason },
      });
    }

    res.status(result.success ? 200 : 400).json(result);
  },
);

// GET /api/inventory/stock-adjustments?productId=123 — audit history for one
// product, or the most recent adjustments across all products when
// productId is omitted.
router.get("/stock-adjustments", (req, res) => {
  const productIdRaw = req.query.productId;
  let productId: number | undefined;
  if (productIdRaw != null) {
    productId = Number(productIdRaw);
    if (!Number.isFinite(productId)) {
      res.status(400).json({ success: false, error: "Invalid productId" });
      return;
    }
  }

  const service = getInventoryService();
  const adjustments = service.getStockAdjustments(productId);
  res.json(createSuccessResponse({ adjustments }));
});

export default router;
