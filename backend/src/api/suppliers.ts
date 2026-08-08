/**
 * Suppliers API Endpoints
 *
 * Handles supplier management and ledger operations
 */

import { Router } from "express";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getSupplierService,
  getFinancialService,
  supplierLedgerEntrySchema,
  supplierSettleSchema,
  supplierCashflowSchema,
  supplierPurchaseCreateSchema,
  supplierWriteOffSchema,
} from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = Router();
const supplierService = getSupplierService();

// ── Reads (any authenticated role — mirrors the IPC handlers, none of which
// call requireRole for reads) ───────────────────────────────────────────────

// GET /api/suppliers
router.get("/", requireAuth, async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const suppliers = supplierService.listSuppliers(search);
    res.json({ success: true, suppliers });
  } catch (error) {
    logger.error({ error }, "List suppliers error");
    res.status(500).json({ success: false, error: "Failed to list suppliers" });
  }
});

// GET /api/suppliers/balances
router.get("/balances", requireAuth, async (_req, res) => {
  try {
    const balances = supplierService.getSupplierBalances();
    res.json({ success: true, balances });
  } catch (error) {
    logger.error({ error }, "Get supplier balances error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get supplier balances" });
  }
});

// GET /api/suppliers/unsettled?provider=OMT — unsettled transactions for a
// provider (mirrors suppliers:unsettled-transactions → FinancialService).
router.get("/unsettled", requireAuth, async (req, res) => {
  try {
    const provider = req.query.provider as string | undefined;
    if (!provider) {
      res.status(400).json({ success: false, error: "provider is required" });
      return;
    }
    const transactions = getFinancialService().getUnsettledByProvider(provider);
    res.json({ success: true, transactions });
  } catch (error) {
    logger.error({ error }, "Get unsettled supplier transactions error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get unsettled transactions" });
  }
});

// GET /api/suppliers/all-transactions?provider=OMT&limit=50 — full history
// tab (mirrors suppliers:all-transactions → FinancialService.getAllByProvider).
router.get("/all-transactions", requireAuth, async (req, res) => {
  try {
    const provider = req.query.provider as string | undefined;
    if (!provider) {
      res.status(400).json({ success: false, error: "provider is required" });
      return;
    }
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : undefined;
    const transactions = getFinancialService().getAllByProvider(
      provider,
      limit,
    );
    res.json({ success: true, transactions });
  } catch (error) {
    logger.error({ error }, "Get all supplier transactions error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get transactions" });
  }
});

// GET /api/suppliers/unsettled-summary — per-provider summary (dashboard +
// profits pending tab; mirrors suppliers:unsettled-summary).
router.get("/unsettled-summary", requireAuth, async (_req, res) => {
  try {
    const summary = getFinancialService().getUnsettledSummary();
    res.json({ success: true, summary });
  } catch (error) {
    logger.error({ error }, "Get unsettled supplier summary error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get unsettled summary" });
  }
});

// GET /api/suppliers/product-balances — inventory cost minus payments
// (mirrors suppliers:product-balances).
router.get("/product-balances", requireAuth, async (_req, res) => {
  try {
    const balances = supplierService.getProductSupplierBalances();
    res.json({ success: true, balances });
  } catch (error) {
    logger.error({ error }, "Get product supplier balances error");
    res.status(500).json({
      success: false,
      error: "Failed to get product supplier balances",
    });
  }
});

// GET /api/suppliers/:id/ledger
router.get("/:id/ledger", requireAuth, async (req, res) => {
  try {
    const supplierId = parseInt(req.params.id);
    if (isNaN(supplierId)) {
      res.status(400).json({ success: false, error: "Invalid supplier ID" });
      return;
    }

    const limit = req.query.limit
      ? parseInt(req.query.limit as string)
      : undefined;
    const ledger = supplierService.getSupplierLedger(supplierId, limit);
    res.json({ success: true, ledger });
  } catch (error) {
    logger.error({ error }, "Get supplier ledger error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get supplier ledger" });
  }
});

// GET /api/suppliers/:id/product-items — inventory items for a product
// supplier (name, qty, cost, total; mirrors suppliers:product-items).
router.get("/:id/product-items", requireAuth, async (req, res) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    if (isNaN(supplierId)) {
      res.status(400).json({ success: false, error: "Invalid supplier ID" });
      return;
    }
    const items = supplierService.getProductItems(supplierId);
    res.json({ success: true, items });
  } catch (error) {
    logger.error({ error }, "Get supplier product items error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get product items" });
  }
});

// GET /api/suppliers/:id/purchases — delivery batches for a product supplier
// (mirrors suppliers:purchases).
router.get("/:id/purchases", requireAuth, async (req, res) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    if (isNaN(supplierId)) {
      res.status(400).json({ success: false, error: "Invalid supplier ID" });
      return;
    }
    const purchases = supplierService.getSupplierPurchases(supplierId);
    res.json({ success: true, purchases });
  } catch (error) {
    logger.error({ error }, "Get supplier purchases error");
    res.status(500).json({ success: false, error: "Failed to get purchases" });
  }
});

// ── Writes (admin only — mirrors every IPC write handler in
// supplierHandlers.ts, all of which gate on requireRole(["admin"]), no
// staff access) ──────────────────────────────────────────────────────────────

// POST /api/suppliers
router.post("/", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const { name, contact_name, phone, note, module_key, provider } = req.body;

    if (!name) {
      res
        .status(400)
        .json({ success: false, error: "Supplier name is required" });
      return;
    }

    const result = supplierService.createSupplier({
      name,
      contact_name,
      phone,
      note,
      module_key,
      provider,
    });

    if (result.success) {
      logger.info({ name, id: result.id }, "Supplier created");
      // Mirrors supplierHandlers.ts's suppliers:create audit (create/supplier).
      auditRest(req, {
        action: "create",
        entity_type: "supplier",
        summary: `Created supplier "${name}"`,
        metadata: { name, module_key, provider },
      });
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logger.error({ error }, "Create supplier error");
    res
      .status(500)
      .json({ success: false, error: "Failed to create supplier" });
  }
});

// POST /api/suppliers/:id/ledger
// CQ-9 validation retrofit: was hand-rolled field checks — now validates
// against the core `supplierLedgerEntrySchema` (rule 14), the same schema
// suppliers:add-ledger-entry validates against. `supplier_id` is sourced from
// the URL (not the client-supplied body) before validation, since the schema
// requires it at the top level. Path and envelope are unchanged.
router.post(
  "/:id/ledger",
  requireAuth,
  requireRole(["admin"]),
  (req: AuthRequest, _res, next) => {
    req.body = { ...req.body, supplier_id: Number(req.params.id) };
    next();
  },
  validateRequest(supplierLedgerEntrySchema),
  (req: AuthRequest, res) => {
    try {
      const result = supplierService.addLedgerEntry({
        ...req.body,
        created_by: req.user?.userId || 1,
      });

      if (result.success) {
        logger.info(
          {
            supplier_id: req.body.supplier_id,
            entry_type: req.body.entry_type,
          },
          "Supplier ledger entry added",
        );
        // Mirrors supplierHandlers.ts's suppliers:add-ledger-entry audit
        // (create/supplier_ledger).
        auditRest(req, {
          action: "create",
          entity_type: "supplier_ledger",
          summary: `Supplier ledger ${req.body.entry_type}: $${req.body.amount_usd} + ${req.body.amount_lbp} LBP`,
          metadata: {
            supplier_id: req.body.supplier_id,
            entry_type: req.body.entry_type,
          },
        });
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error({ error }, "Add supplier ledger entry error");
      res
        .status(500)
        .json({ success: false, error: "Failed to add ledger entry" });
    }
  },
);

// POST /api/suppliers/:id/settle — settle a batch of financial_services
// transactions with a supplier (mirrors suppliers:settle-transactions).
// `supplier_id` is sourced from the URL, same pattern as /:id/ledger above.
router.post(
  "/:id/settle",
  requireAuth,
  requireRole(["admin"]),
  (req: AuthRequest, _res, next) => {
    req.body = { ...req.body, supplier_id: Number(req.params.id) };
    next();
  },
  validateRequest(supplierSettleSchema),
  (req: AuthRequest, res) => {
    try {
      const result = supplierService.settleTransactions({
        ...req.body,
        created_by: req.user!.userId,
      });
      if (result.success) {
        // Mirrors supplierHandlers.ts's suppliers:settle-transactions audit
        // (settle/supplier_settlement).
        auditRest(req, {
          action: "settle",
          entity_type: "supplier_settlement",
          summary: `Settled ${req.body.financial_service_ids.length} transactions for supplier #${req.body.supplier_id}`,
          metadata: {
            supplier_id: req.body.supplier_id,
            count: req.body.financial_service_ids.length,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Settle supplier transactions error");
      res
        .status(500)
        .json({ success: false, error: "Failed to settle transactions" });
    }
  },
);

// POST /api/suppliers/:id/cashflow — pay a supplier down / record a supplier
// paying us, via payment-method legs (mirrors suppliers:record-cashflow).
router.post(
  "/:id/cashflow",
  requireAuth,
  requireRole(["admin"]),
  (req: AuthRequest, _res, next) => {
    req.body = { ...req.body, supplier_id: Number(req.params.id) };
    next();
  },
  validateRequest(supplierCashflowSchema),
  (req: AuthRequest, res) => {
    try {
      const result = supplierService.recordSupplierCashflow({
        ...req.body,
        created_by: req.user!.userId,
      });
      if (result.success) {
        // Mirrors supplierHandlers.ts's suppliers:record-cashflow audit
        // (action="pay"|"receive" / supplier_cashflow).
        auditRest(req, {
          action: req.body.direction === "PAY" ? "pay" : "receive",
          entity_type: "supplier_cashflow",
          summary: `Supplier #${req.body.supplier_id} ${req.body.direction === "PAY" ? "paid" : "paid us"} (${req.body.payments.length} leg${req.body.payments.length === 1 ? "" : "s"})`,
          metadata: {
            supplier_id: req.body.supplier_id,
            direction: req.body.direction,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Record supplier cashflow error");
      res
        .status(500)
        .json({ success: false, error: "Failed to record cashflow" });
    }
  },
);

// POST /api/suppliers/:id/purchases — log a delivery batch for a product
// supplier (mirrors suppliers:purchase-create). Envelope matches the IPC
// handler exactly: either the raw SupplierPurchase entity (no `success` key)
// or { success: false, error }.
router.post(
  "/:id/purchases",
  requireAuth,
  requireRole(["admin"]),
  (req: AuthRequest, _res, next) => {
    req.body = { ...req.body, supplier_id: Number(req.params.id) };
    next();
  },
  validateRequest(supplierPurchaseCreateSchema),
  (req: AuthRequest, res) => {
    try {
      const result = supplierService.createPurchase({
        ...req.body,
        created_by: req.user!.userId,
      });
      // createPurchase returns the raw created SupplierPurchase entity on
      // success (no `success` key at all) or `{ success: false, error }` on
      // a business-rule failure — "not explicitly false" is therefore the
      // correct success test here, not `result.success === true`.
      if (!("success" in result && result.success === false)) {
        // Mirrors supplierHandlers.ts's suppliers:purchase-create audit
        // (create/supplier_purchase).
        auditRest(req, {
          action: "create",
          entity_type: "supplier_purchase",
          summary: `Logged purchase of $${Number(req.body.total_usd).toFixed(2)} for supplier #${req.body.supplier_id}`,
          metadata: {
            supplier_id: req.body.supplier_id,
            total_usd: req.body.total_usd,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Create supplier purchase error");
      res
        .status(500)
        .json({ success: false, error: "Failed to create purchase" });
    }
  },
);

// POST /api/suppliers/:id/write-off (admin-only, D4) — forgive part of what
// the shop owes a supplier, with NO cashflow attached (mirrors
// suppliers:write-off). `supplier_id` is sourced from the URL, same pattern
// as /:id/ledger, /:id/settle, /:id/cashflow above.
router.post(
  "/:id/write-off",
  requireAuth,
  requireRole(["admin"]),
  (req: AuthRequest, _res, next) => {
    req.body = { ...req.body, supplier_id: Number(req.params.id) };
    next();
  },
  validateRequest(supplierWriteOffSchema),
  (req: AuthRequest, res) => {
    try {
      const result = supplierService.writeOffSupplierDebt({
        ...req.body,
        created_by: req.user!.userId,
      });
      if (result.success) {
        // Mirrors supplierHandlers.ts's suppliers:write-off audit
        // (write_off/supplier_write_off).
        auditRest(req, {
          action: "write_off",
          entity_type: "supplier_write_off",
          summary: `Supplier write-off for #${req.body.supplier_id}: $${req.body.amount_usd} + ${req.body.amount_lbp} LBP`,
          metadata: {
            supplier_id: req.body.supplier_id,
            amount_usd: req.body.amount_usd,
            amount_lbp: req.body.amount_lbp,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Write off supplier debt error");
      res
        .status(500)
        .json({ success: false, error: "Failed to write off supplier debt" });
    }
  },
);

export default router;
