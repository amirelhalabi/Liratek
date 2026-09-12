import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateParams } from "../middleware/validation.js";
import {
  getSalesService,
  getTransactionService,
  saleProcessSchema,
  getSaleSchema,
  saleUpdateMetadataSchema,
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
        metadata: {
          status: req.body.status,
          itemCount: req.body.items?.length,
        },
      });
    }

    res.status(result.success ? 200 : 400).json(result);
  },
);

// POST /api/sales/:id/refund (admin only — matches salesHandlers.ts's
// "sales:refund" IPC gate, rule 19c). Refunds the WHOLE sale via the same
// TransactionRepository reversal path the IPC channel uses
// (getTransactionService().refundBySaleId), never a bespoke REST-only code
// path. `userId` comes from the JWT, never the client body.
router.post("/:id/refund", requireRole(["admin"]), (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isFinite(saleId) || saleId < 1) {
    res.json({ success: false, error: "Invalid sale ID" });
    return;
  }
  try {
    const userId = req.user!.userId;
    const txnService = getTransactionService();
    const refundId = txnService.refundBySaleId(saleId, userId);
    // Mirrors salesHandlers.ts's sales:refund audit (refund/sale).
    auditRest(req, {
      action: "refund",
      entity_type: "sale",
      entity_id: String(saleId),
      summary: `Refunded sale #${saleId}`,
      metadata: { refundId },
    });
    res.json({ success: true, refundId });
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/sales/:id/refund-item (admin only — matches salesHandlers.ts's
// "sales:refund-item" IPC gate). Body: { saleItemId, refundQuantity }.
router.post("/:id/refund-item", requireRole(["admin"]), (req, res) => {
  const saleId = Number(req.params.id);
  const saleItemId = Number(req.body?.saleItemId);
  const refundQuantity = Number(req.body?.refundQuantity);
  if (!Number.isFinite(saleId) || saleId < 1) {
    res.json({ success: false, error: "Invalid sale ID" });
    return;
  }
  if (!Number.isFinite(saleItemId) || saleItemId < 1) {
    res.json({ success: false, error: "Invalid sale item ID" });
    return;
  }
  if (!Number.isFinite(refundQuantity) || refundQuantity < 1) {
    res.json({ success: false, error: "Invalid refund quantity" });
    return;
  }
  try {
    const userId = req.user!.userId;
    const service = getSalesService();
    const result = service.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity,
      userId,
    });
    if (result.success) {
      // Mirrors salesHandlers.ts's sales:refund-item audit
      // (refund/sale_item).
      auditRest(req, {
        action: "refund",
        entity_type: "sale_item",
        entity_id: String(saleItemId),
        summary: `Refunded ${refundQuantity}x item #${saleItemId} from sale #${saleId}`,
        metadata: { saleId, refundQuantity },
      });
    }
    // Rule 19c envelope parity: HTTP 200 even on a business-rule failure —
    // the frontend adapter branches on result.success, not the status code.
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/sales/update-metadata (admin + staff — matches salesHandlers.ts's
// "sales:update-metadata" IPC gate). `editedBy` comes from the JWT's
// username claim, never the client body — the IPC handler resolves the same
// value via a DB lookup off the authenticated userId; the JWT already
// carries it, so no extra lookup is needed here.
router.post(
  "/update-metadata",
  requireRole(["admin", "staff"]),
  validateRequest(saleUpdateMetadataSchema),
  (req, res) => {
    const editedBy = req.user!.username;
    const service = getSalesService();
    const result = service.updateSaleMetadata(
      req.body.id,
      {
        ...(req.body.note !== undefined ? { note: req.body.note } : {}),
        ...(req.body.client_name !== undefined
          ? { client_name: req.body.client_name }
          : {}),
        ...(req.body.client_phone !== undefined
          ? { client_phone: req.body.client_phone }
          : {}),
      },
      editedBy,
    );

    if (
      result.success &&
      result.oldValues &&
      Object.keys(result.oldValues).length > 0
    ) {
      // Mirrors salesHandlers.ts's sales:update-metadata audit
      // (edit_metadata/sale).
      auditRest(req, {
        action: "edit_metadata",
        entity_type: "sale",
        entity_id: String(req.body.id),
        summary: `Edited sale #${req.body.id} metadata`,
        old_values: result.oldValues,
        new_values: req.body,
      });
    }

    res.json(
      result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error },
    );
  },
);

export default router;
