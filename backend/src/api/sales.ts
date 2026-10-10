import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  validateRequest,
  validateParams,
  validateQuery,
} from "../middleware/validation.js";
import {
  getSalesService,
  getTransactionService,
  saleProcessSchema,
  saleIdParamSchema,
  saleUpdateMetadataSchema,
  // LIRA-231 — POS "Refund Sale"/"Refund item" operator-chosen return-method
  // override + refund-preview read, shared with the Electron IPC handlers
  // via packages/core/src/validators/sale.ts (rule 14/19b).
  saleRefundSchema,
  saleRefundItemSchema,
  // LIRA-147 — admin-only "Undo refund" for a per-item refund, shared with
  // the Electron IPC handler via packages/core/src/validators/sale.ts
  // (rule 14/19b).
  saleUndoItemRefundSchema,
  saleRefundPreviewSchema,
  getCurrentTenantId,
  // LIRA-296 SF-1/SF-2 — the picked day and the date-range read.
  todaysSalesQuerySchema,
  salesDateRangeSchema,
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

// DELETE /api/sales/drafts/:id — cancel a draft (POS "cancel order").
// Mirrors salesHandlers.ts's "sales:delete-draft" IPC channel: LIRA-234 gated
// that handler to the SAME roles as "sales:process" (["admin","staff"]) — it
// previously called no requireRole at all — so this route now carries the
// matching `requireRole(["admin","staff"])` for role parity (rule 19c). It
// also calls the SAME SalesService.deleteDraft → SalesRepository.deleteDraft,
// which already refuses anything that isn't `status === 'draft'`
// ("Only draft sales can be deleted") — the completed-sale guard is
// inherited for free, not reimplemented here.
//
// `id` is parsed manually rather than through validateParams(getSaleSchema):
// that schema's `id` is a plain z.number(), which fails against a URL param
// (always a string) — see the identical note in backend/src/api/maintenance.ts
// above its own GET /jobs/:id/history route. Number()+isNaN mirrors the
// proven pattern this same file already uses for POST /:id/refund and
// POST /:id/refund-item, below.
//
// Registered before GET /:id (and before /today, /top-products) so a
// two-segment DELETE path is never at risk of an Express route-ordering
// surprise, per CLAUDE.md's "static paths before /:id".
router.delete("/drafts/:id", requireRole(["admin", "staff"]), (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isFinite(saleId) || saleId < 1) {
    res.json({ success: false, error: "Invalid sale ID" });
    return;
  }
  const service = getSalesService();
  const result = service.deleteDraft(saleId);
  if (result.success) {
    // Mirrors salesHandlers.ts's sales:delete-draft audit (delete/sale).
    // Gated on result.success here — unlike the IPC handler, which logs
    // unconditionally even when the delete was refused (draft not found /
    // not a draft) — so a refused delete doesn't record a phantom "Deleted
    // draft" audit entry. This matches every OTHER write route in this
    // file (refund, refund-item, update-metadata all gate on success).
    auditRest(req, {
      action: "delete",
      entity_type: "sale",
      entity_id: String(saleId),
      summary: `Deleted draft sale #${saleId}`,
    });
  }
  res.json(result);
});

// GET /api/sales/today?date=YYYY-MM-DD — LIRA-296 SF-1: the picked day is
// honoured, as IPC `sales:get-todays-sales` always did. Omitted: today.
router.get("/today", validateQuery(todaysSalesQuerySchema), (req, res) => {
  const service = getSalesService();
  const { date } = req.query as { date?: string };
  const sales = service.getTodaysSales(date);
  res.json({ success: true, sales });
});

// GET /api/sales/by-date-range?from&to — LIRA-296 SF-2: the web twin of IPC
// `sales:get-by-date-range` (same service, same rows; no extra role gate,
// like the IPC channel). Must stay ABOVE `/:id`.
router.get(
  "/by-date-range",
  validateQuery(salesDateRangeSchema),
  (req, res) => {
    const { from, to } = req.query as { from: string; to: string };
    const data = getSalesService().findByDateRange(from, to);
    res.json({ success: true, data });
  },
);

// GET /api/sales/top-products
router.get("/top-products", (_req, res) => {
  const service = getSalesService();
  const products = service.getTopProducts();
  res.json({ success: true, products });
});

// GET /api/sales/:id — was rejecting EVERY request: `validateParams` parses
// the URL param (always a string, e.g. "67") against a schema; the old
// `getSaleSchema` (`z.number()`) never matches a string, so this route 200'd
// `{success:false}` with no `sale` key before `SalesService.getSale` was
// ever reached, and the POS/Debts UI read that as "Sale not found" for
// every id. `saleIdParamSchema` coerces the string first — same pattern as
// `productUnitIdSchema`/`lotBreakdownSchema` elsewhere in this codebase.
// `SalesService.getSale` returns `null` (not a throw) for an unknown id, so
// that case still reaches here as `{success:true, sale:null}` — the
// frontend's `!sale` check keeps rendering "Sale not found" for it, just via
// the real not-found path instead of a validation rejection.
router.get("/:id", validateParams(saleIdParamSchema), (req, res) => {
  const service = getSalesService();
  const saleId = req.params.id as unknown as number;

  try {
    const sale = service.getSale(saleId);
    return res.json({ success: true, sale });
  } catch (error) {
    // Rule 19c: HTTP 200 even on failure — the adapter branches on
    // `result.success`, never on status code.
    const message = error instanceof Error ? error.message : "Not found";
    return res.status(200).json({ success: false, error: message });
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

    // Rule 19c: HTTP 200 even on a business-rule failure (e.g. out of stock)
    // — the adapter branches on `result.success`, never on status code. This
    // route used to answer a real 400 on failure, which made `requestJson`
    // (web transport) THROW an ApiError instead of resolving the envelope —
    // POS/index.tsx's `handleCompleteSale` reads `result.error` on the
    // resolved value, so a business-rule refusal was swallowed into a
    // generic "unexpected error" toast on web while desktop (which never
    // throws on IPC) showed the real reason.
    res.json(result);
  },
);

// POST /api/sales/:id/refund (admin only — matches salesHandlers.ts's
// "sales:refund" IPC gate, rule 19c). Refunds the WHOLE sale via the same
// TransactionRepository reversal path the IPC channel uses
// (getTransactionService().refundBySaleId), never a bespoke REST-only code
// path. `userId` comes from the JWT, never the client body.
//
// LIRA-231: an optional `refundLegs` body field carries the operator's
// chosen return method(s) — the SAME LIRA-078 contract the Transactions
// page's `/api/transactions/:id/refund` route validates with
// (`saleRefundSchema` reuses `refundLegsSchema` — rule 14). Validated only
// when present, same as that route, so a plain `POST /:id/refund` with no
// body keeps working exactly as before.
//
// 2026-09-26: an optional `unitExtras` body field carries the POS "Returned
// phones" per-unit defective/warranty-override flags — same "Returned
// phones" UI the Transactions page's refund modal has always had, forwarded
// to `TransactionRepository.refundBySaleId`'s `opts.refundUnitExtras`.
router.post("/:id/refund", requireRole(["admin"]), (req, res) => {
  const saleId = Number(req.params.id);
  const parsed = saleRefundSchema.safeParse({
    saleId,
    refundLegs: req.body?.refundLegs,
    unitExtras: req.body?.unitExtras,
    exchangeRate: req.body?.exchangeRate,
    // Owner decision 2026-10-07 — refund kept change (same schema as IPC).
    keptChange: req.body?.keptChange ?? undefined,
  });
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.json({
      success: false,
      error: firstError?.message ?? "Invalid refund request",
    });
    return;
  }
  try {
    const userId = req.user!.userId;
    const txnService = getTransactionService();
    const refundId = txnService.refundBySaleId(parsed.data.saleId, userId, {
      refundLegs: parsed.data.refundLegs,
      refundUnitExtras: parsed.data.unitExtras,
      exchangeRate: parsed.data.exchangeRate,
      keptChange: parsed.data.keptChange
        ? {
            usd: parsed.data.keptChange.kept_change_usd,
            lbp: parsed.data.keptChange.kept_change_lbp,
          }
        : undefined,
    });
    // Mirrors salesHandlers.ts's sales:refund audit (refund/sale).
    auditRest(req, {
      action: "refund",
      entity_type: "sale",
      entity_id: String(parsed.data.saleId),
      summary: `Refunded sale #${parsed.data.saleId}`,
      metadata: {
        refundId,
        refundLegs: parsed.data.refundLegs,
        unitExtras: parsed.data.unitExtras,
        exchangeRate: parsed.data.exchangeRate,
        keptChange: parsed.data.keptChange,
      },
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
// "sales:refund-item" IPC gate). Body: { saleItemId, refundQuantity,
// refundLegs? }. LIRA-231: `refundLegs` is the same optional override,
// validated against THIS ITEM's proportional share by the repository.
//
// 2026-09-26: same optional `unitExtras` body field, validated by
// `SalesRepository.refundSaleItem` against THIS ITEM's own linked units
// only.
router.post("/:id/refund-item", requireRole(["admin"]), (req, res) => {
  const saleId = Number(req.params.id);
  const parsed = saleRefundItemSchema.safeParse({
    saleId,
    saleItemId: req.body?.saleItemId,
    refundQuantity: req.body?.refundQuantity,
    refundLegs: req.body?.refundLegs,
    unitExtras: req.body?.unitExtras,
    exchangeRate: req.body?.exchangeRate,
    // Owner decision 2026-10-07 — refund kept change (same field the IPC
    // channel takes; built field by field here, so it must be named).
    keptChange: req.body?.keptChange ?? undefined,
  });
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.json({
      success: false,
      error: firstError?.message ?? "Invalid refund-item request",
    });
    return;
  }
  try {
    const userId = req.user!.userId;
    const service = getSalesService();
    const result = service.refundSaleItem({
      saleId: parsed.data.saleId,
      saleItemId: parsed.data.saleItemId,
      refundQuantity: parsed.data.refundQuantity,
      refundLegs: parsed.data.refundLegs,
      unitExtras: parsed.data.unitExtras,
      exchangeRate: parsed.data.exchangeRate,
      keptChange: parsed.data.keptChange
        ? {
            usd: parsed.data.keptChange.kept_change_usd,
            lbp: parsed.data.keptChange.kept_change_lbp,
          }
        : undefined,
      userId,
    });
    // Mirrors salesHandlers.ts's sales:refund-item audit (refund/sale_item)
    // — unconditional, same as the IPC handler (not gated on result.success).
    auditRest(req, {
      action: "refund",
      entity_type: "sale_item",
      entity_id: String(parsed.data.saleItemId),
      summary: `Refunded ${parsed.data.refundQuantity}x item #${parsed.data.saleItemId} from sale #${parsed.data.saleId}`,
      metadata: {
        saleId: parsed.data.saleId,
        refundQuantity: parsed.data.refundQuantity,
        refundLegs: parsed.data.refundLegs,
        unitExtras: parsed.data.unitExtras,
        exchangeRate: parsed.data.exchangeRate,
        keptChange: parsed.data.keptChange,
      },
    });
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

// POST /api/sales/undo-item-refund (admin only — matches salesHandlers.ts's
// "sales:undo-item-refund" IPC gate). Body: { refundTransactionId }.
// LIRA-147: everything else the undo needs is read back server-side from
// that REFUND row's own metadata — a single top-level static path (not
// nested under `:id`), so it never collides with the `GET /:id` route above.
router.post("/undo-item-refund", requireRole(["admin"]), (req, res) => {
  const parsed = saleUndoItemRefundSchema.safeParse({
    refundTransactionId: req.body?.refundTransactionId,
  });
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.json({
      success: false,
      error: firstError?.message ?? "Invalid undo-item-refund request",
    });
    return;
  }
  try {
    const userId = req.user!.userId;
    const service = getSalesService();
    const result = service.undoItemRefund({
      refundTransactionId: parsed.data.refundTransactionId,
      userId,
    });
    if (result.success) {
      auditRest(req, {
        action: "refund",
        entity_type: "transaction",
        entity_id: String(parsed.data.refundTransactionId),
        summary: `Undid refund #${parsed.data.refundTransactionId}`,
        metadata: { refundTransactionId: parsed.data.refundTransactionId },
      });
    }
    // Rule 19c envelope parity: HTTP 200 even on a business-rule failure.
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /api/sales/:id/refund-preview?saleItemId=&refundQuantity= (admin only
// — matches the refund actions' own gate). LIRA-231: read-only preview for
// the POS refund flow — the sale's (or, with both query params present, one
// item's proportional share of the sale's) own customer-facing payment
// legs, plus whether the sale is session-linked. Static-enough placement:
// registered after the two POST refund routes and before update-metadata,
// never collides with `/:id` (different path segment count).
router.get(
  "/:id/refund-preview",
  requireRole(["admin"]),
  (req, res) => {
    const saleId = Number(req.params.id);
    const rawSaleItemId = req.query.saleItemId;
    const rawRefundQuantity = req.query.refundQuantity;
    const item =
      rawSaleItemId !== undefined && rawRefundQuantity !== undefined
        ? {
            saleItemId: Number(rawSaleItemId),
            refundQuantity: Number(rawRefundQuantity),
          }
        : undefined;
    const parsed = saleRefundPreviewSchema.safeParse({ saleId, item });
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.json({
        success: false,
        error: firstError?.message ?? "Invalid refund-preview request",
      });
      return;
    }
    const service = getSalesService();
    const result = service.getRefundPreview(
      parsed.data.saleId,
      parsed.data.item,
    );
    res.json(result);
  },
);

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
