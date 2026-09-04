import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getInventoryService,
  getCategoryRepository,
  createProductSchema,
  productListQuerySchema,
  type ProductListQuery,
  type ProductListFilters,
  batchDeleteProductsSchema,
  stockAdjustSchema,
  resolveScanCodeSchema,
  createCategorySchema,
  updateCategorySchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
} from "@liratek/core";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

const router = express.Router();

// All inventory routes require auth
router.use(authenticateJWT);

// GET /api/inventory/products?search=…&category=A&category=B&costMin=…
//
// HTTP twin of the `inventory:get-products` IPC channel. The structured
// filters are pushed down into SQL by ProductRepository (rule 19b: ONE core
// service for both transports, ONE shared schema for both).
//
// `productListQuerySchema` parses the RAW query string — every value arrives
// as `string | string[]` — and outputs the real-typed `ProductListFilters`
// shape, folding the repeated wire params `category`/`supplier` into the
// plural `categories`/`suppliers` keys the repository reads. `validateQuery`
// REPLACES `req.query` with that parsed output, so the cast below is to the
// schema's own output type, not a reinterpretation of raw strings.
//
// With NO filter params the parsed object's filter fields are all
// `undefined`, `buildFilterClauses` contributes no SQL, and the response is
// byte-identical to what this route returned before filtering existed.
//
// `barcode`/`activeOnly` are parsed for back-compat with the older
// `searchProductsSchema` (so a stale caller's params still validate) and
// deliberately dropped here — neither was ever applied by this route.
router.get("/products", validateQuery(productListQuerySchema), (req, res) => {
  const service = getInventoryService();
  const q = req.query as unknown as ProductListQuery;
  // Picked field-by-field rather than spread, for two reasons: it keeps
  // `search`/`barcode`/`activeOnly` out of the filter set entirely, and —
  // because this is an object LITERAL annotated as ProductListFilters —
  // TypeScript's excess-property check turns any future core rename of a
  // filter key into a compile error here instead of a silently dropped
  // filter. Same reason the POST route below remaps explicitly.
  const filters: ProductListFilters = {
    categories: q.categories,
    suppliers: q.suppliers,
    addedFrom: q.addedFrom,
    addedTo: q.addedTo,
    costMin: q.costMin,
    costMax: q.costMax,
    retailMin: q.retailMin,
    retailMax: q.retailMax,
    profitPctMin: q.profitPctMin,
    profitPctMax: q.profitPctMax,
    stockMin: q.stockMin,
    stockMax: q.stockMax,
  };
  const products = service.getProducts(q.search, filters);
  res.json(createSuccessResponse({ products }));
});

// GET /api/inventory/product-filter-options — distinct categories/suppliers
// backing the inventory list's filter dropdowns, drawn from exactly the row
// set the list itself shows. No params, so no request validation.
//
// Static single-segment path; declared here, above every parameterized
// route in this file. It cannot be shadowed by `/products/:id` (different
// first segment) and this router has no root-level `/:param` route, but the
// position keeps it safe if one is ever added.
//
// Reads on this router carry no `requireRole` beyond the router-level
// `authenticateJWT` above — same baseline as GET /products and
// GET /products/:id, and the same as the mirroring IPC channel.
router.get("/product-filter-options", (_req, res) => {
  try {
    res.json(
      createSuccessResponse(getInventoryService().getProductFilterOptions()),
    );
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/inventory/resolve-scan?code=... — barcode first, then an active
// (IN_STOCK) unit IMEI (LIRA-143 Phase 3, owner decision #2). Same no-extra-
// role-gate read as GET /products/:id below — placed before it (static path
// before any parameterized sibling route).
router.get(
  "/resolve-scan",
  validateQuery(resolveScanCodeSchema),
  (req, res) => {
    try {
      const code = req.query.code as unknown as string;
      const data = getInventoryService().resolveScanCode(code);
      res.json({ success: true, data });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

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
      // warranty_months is named identically on both sides — straight
      // through, no remap needed (LIRA-143 v157 decision #4).
      warranty_months: b.warranty_months ?? null,
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

// POST /api/inventory/products/batch-delete (admin/staff — matches the IPC
// handler's roles per rule 19b: inventoryHandlers.ts's `inventory:batch-delete`
// carries `["admin", "staff"]`, not the admin-only gate the singular DELETE
// below has). Static path — declared here, BEFORE every parameterized
// `/products/:id` route below (this file's own convention, see the comments
// at lines 81-84/100-102): otherwise Express would match "batch-delete" as
// the `:id` param on PUT/DELETE /products/:id.
//
// Body `{ ids }` validated against `batchDeleteProductsSchema`
// (packages/core/src/validators/product.ts), which wraps the SAME
// `batchDeleteProductIdsSchema` the IPC channel validates its positional
// `number[]` argument against (rule 14) — one ids rule, two shapes.
router.post(
  "/products/batch-delete",
  requireRole(["admin", "staff"]),
  validateRequest(batchDeleteProductsSchema),
  (req, res) => {
    const service = getInventoryService();
    const result = service.batchDeleteProducts(req.body.ids);
    if (result.success) {
      // Mirrors inventoryHandlers.ts's inventory:batch-delete audit. Actor
      // comes from req.user via auditRest — never a client-supplied id.
      auditRest(req, {
        action: "delete",
        entity_type: "product",
        summary: `Batch deleted ${req.body.ids.length} products`,
        metadata: { ids: req.body.ids },
      });
    }
    // Rule 19c envelope parity: HTTP 200 even on a business-rule failure,
    // same as the IPC channel and this route's PUT/DELETE siblings below.
    res.status(200).json(result);
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
    // Rule 19c envelope parity (LIRA-149 scope extension — see
    // backend/src/middleware/validation.ts's rule-19c comment): a
    // business-rule/validation failure is HTTP 200 + `{success:false}`,
    // never a 4xx, because the frontend adapter branches on `result.success`
    // only. This route's own PUT sibling already gets this right for its
    // OWN "Invalid id" guard's neighbour below.
    res.status(200).json({ success: false, error: "Invalid id" });
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
  // Rule 19c envelope parity (LIRA-149): a service failure used to answer
  // HTTP 400 here, breaking the IPC-identical HTTP-200 + {success:false}
  // envelope every other route in this file (and the frontend adapter)
  // relies on — `result.success` is the only thing callers branch on.
  res.status(200).json(result);
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

// ---------------------------------------------------------------------------
// Category Management (LIRA-143 Phase 5 — Settings manager). Roles mirror
// the IPC category handlers in inventoryHandlers.ts, which carry NO
// requireRole gate of their own beyond an authenticated app session — same
// baseline here (router-level authenticateJWT only, no extra role gate).
// ---------------------------------------------------------------------------

// GET /api/inventory/categories-full — static path, placed before the
// parameterized /categories/:id routes below.
router.get("/categories-full", (_req, res) => {
  try {
    const data = getCategoryRepository().getAll();
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/inventory/categories
router.post(
  "/categories",
  validateRequest(createCategorySchema),
  (req, res) => {
    try {
      const result = getCategoryRepository().create(req.body.name);
      auditRest(req, {
        action: "create",
        entity_type: "category",
        entity_id: String(result.id),
        summary: `Created category "${req.body.name}"`,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// PUT /api/inventory/categories/:id — name and/or tracks_imei_units flag
router.put(
  "/categories/:id",
  validateRequest(updateCategorySchema),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    try {
      const updated = getCategoryRepository().update(id, {
        name: req.body.name,
        tracksImeiUnits: req.body.tracks_imei_units,
      });
      auditRest(req, {
        action: "update",
        entity_type: "category",
        entity_id: String(id),
        summary:
          req.body.name !== undefined
            ? `Updated category #${id} to "${req.body.name}"`
            : `Updated category #${id} (tracks_imei_units=${req.body.tracks_imei_units})`,
        new_values: req.body,
      });
      res.json({ success: true, updated });
    } catch (err) {
      res.json({ success: false, error: errMessage(err) });
    }
  },
);

// DELETE /api/inventory/categories/:id
router.delete("/categories/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.json({ success: false, error: "Invalid id" });
    return;
  }
  try {
    const deleted = getCategoryRepository().delete(id);
    auditRest(req, {
      action: "delete",
      entity_type: "category",
      entity_id: String(id),
      summary: `Deleted category #${id}`,
    });
    res.json({ success: true, deleted });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
