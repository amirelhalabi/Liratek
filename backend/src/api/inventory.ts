import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getInventoryService,
  createProductSchema,
  searchProductsSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
} from "@liratek/core";
import { validateRequest, validateQuery } from "../middleware/validation.js";

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
  } catch (e) {
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
    const result = service.createProduct(req.body);

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
  const result = service.updateProduct(id, req.body);
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
  res.status(result.success ? 200 : 400).json(result);
});

// POST /api/inventory/products/:id/stock (admin)
router.post("/products/:id/stock", requireRole(["admin"]), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return;
  }

  const quantity = Number(req.body?.quantity);
  const delta = req.body?.delta != null ? Number(req.body.delta) : null;

  const service = getInventoryService();
  const result =
    delta != null && Number.isFinite(delta)
      ? service.adjustStockDelta(id, delta)
      : service.adjustStock(id, quantity);

  res.status(result.success ? 200 : 400).json(result);
});

export default router;
