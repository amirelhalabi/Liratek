/**
 * Warranty REST routes (LIRA-296 — warranty for any item) — the web twin of
 * electron-app/handlers/warrantyHandlers.ts. Both call the SAME core
 * `WarrantyService` with the SAME shared schemas (rules 14 and 19).
 *
 * Every route: `authenticateJWT` (tenant context) → `requireRole` (the same
 * roles as the IPC handler) → validation → the IPC-identical envelope
 * (`{ success, data?, error? }`, HTTP 200 even on a refusal, rule 19c).
 */
import express from "express";
import {
  getWarrantyService,
  warrantySearchSchema,
  createWarrantyClaimSchema,
  warrantyClaimsForSchema,
  voidWarrantyClaimSchema,
  listDefectiveItemsSchema,
  resolveDefectiveSchema,
  createSupplierReturnSchema,
  closeSupplierReturnSchema,
  listSupplierReturnsSchema,
  warrantyReportSchema,
  warrantyLogger,
  type WarrantySearchQuery,
  type CreateWarrantyClaimData,
  type WarrantyClaimsForInput,
  type ListDefectiveItemsInput,
  type ListSupplierReturnsInput,
  type WarrantyReportInput,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateQuery, validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();
router.use(authenticateJWT);

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

// GET /api/warranty/search?q&from&to&state&client_day&limit — admin, staff.
router.get(
  "/search",
  requireRole(["admin", "staff"]),
  validateQuery(warrantySearchSchema),
  (req, res) => {
    try {
      const data = getWarrantyService().search(
        req.query as unknown as WarrantySearchQuery,
      );
      res.json({ success: true, data });
    } catch (error) {
      warrantyLogger.error({ error }, "GET /api/warranty/search failed");
      res.json({
        success: false,
        error: errorMessage(error, "Failed to search warranties"),
      });
    }
  },
);

/** The acting user, from the JWT — never the body (rule 19c). */
const actorOf = (req: AuthRequest) => ({
  userId: req.user!.userId,
  role: req.user!.role,
});

// POST /api/warranty/claims — start a claim (admin, staff; the service keeps
// REPLACE/REFUND admin-only). Static paths stay above /:id.
router.post(
  "/claims",
  requireRole(["admin", "staff"]),
  validateRequest(createWarrantyClaimSchema),
  (req, res) => {
    const result = getWarrantyService().createClaim(
      req.body as CreateWarrantyClaimData,
      actorOf(req as AuthRequest),
    );
    if (result.success) {
      auditRest(req as AuthRequest, {
        action: "create",
        entity_type: "warranty_claim",
        entity_id: String(result.data.claim.id),
        summary: `Warranty claim #${result.data.claim.id} (${result.data.claim.action})`,
      });
    }
    res.json(result);
  },
);

// GET /api/warranty/claims?sale_item_id=|maintenance_id=|unit_id= — history.
router.get(
  "/claims",
  requireRole(["admin", "staff"]),
  validateQuery(warrantyClaimsForSchema),
  (req, res) => {
    try {
      const data = getWarrantyService().claimsFor(
        req.query as unknown as WarrantyClaimsForInput,
      );
      res.json({ success: true, data });
    } catch (error) {
      res.json({
        success: false,
        error: errorMessage(error, "Failed to load claims"),
      });
    }
  },
);

// POST /api/warranty/claims/:id/void — admin.
router.post("/claims/:id/void", requireRole(["admin"]), (req, res) => {
  const parsed = voidWarrantyClaimSchema.safeParse({ claim_id: req.params.id });
  if (!parsed.success) {
    res.json({ success: false, error: "Invalid claim id" });
    return;
  }
  const result = getWarrantyService().voidClaim(
    parsed.data,
    actorOf(req as AuthRequest),
  );
  if (result.success) {
    auditRest(req as AuthRequest, {
      action: "delete",
      entity_type: "warranty_claim",
      entity_id: String(parsed.data.claim_id),
      summary: `Voided warranty claim #${parsed.data.claim_id}`,
    });
  }
  res.json(result);
});

// GET /api/warranty/defective?status= — admin.
router.get(
  "/defective",
  requireRole(["admin"]),
  validateQuery(listDefectiveItemsSchema),
  (req, res) => {
    try {
      const data = getWarrantyService().listDefective(
        req.query as unknown as ListDefectiveItemsInput,
      );
      res.json({ success: true, data });
    } catch (error) {
      res.json({
        success: false,
        error: errorMessage(error, "Failed to load defective items"),
      });
    }
  },
);

// POST /api/warranty/defective/:id/resolve — admin.
router.post("/defective/:id/resolve", requireRole(["admin"]), (req, res) => {
  const parsed = resolveDefectiveSchema.safeParse({
    defective_item_id: req.params.id,
    outcome: (req.body as { outcome?: unknown })?.outcome,
  });
  if (!parsed.success) {
    res.json({
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }
  const result = getWarrantyService().resolveDefective(
    parsed.data,
    actorOf(req as AuthRequest),
  );
  if (result.success) {
    auditRest(req as AuthRequest, {
      action: "update",
      entity_type: "defective_item",
      entity_id: String(parsed.data.defective_item_id),
      summary: `Defective item #${parsed.data.defective_item_id}: ${parsed.data.outcome}`,
    });
  }
  res.json(result);
});

// ---- P3: supplier returns and the report (admin) --------------------------

// POST /api/warranty/supplier-returns — send a HELD defective item back.
router.post("/supplier-returns", requireRole(["admin"]), (req, res) => {
  const parsed = createSupplierReturnSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.json({
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }
  const result = getWarrantyService().createSupplierReturn(
    parsed.data,
    actorOf(req as AuthRequest),
  );
  if (result.success) {
    auditRest(req as AuthRequest, {
      action: "create",
      entity_type: "supplier_return",
      entity_id: String(result.data.id),
      summary: `Defective item #${parsed.data.defective_item_id} sent to supplier (return #${result.data.id})`,
    });
  }
  res.json(result);
});

// GET /api/warranty/supplier-returns?status= — admin list.
router.get(
  "/supplier-returns",
  requireRole(["admin"]),
  validateQuery(listSupplierReturnsSchema),
  (req, res) => {
    try {
      const data = getWarrantyService().listSupplierReturns(
        req.query as unknown as ListSupplierReturnsInput,
      );
      res.json({ success: true, data });
    } catch (error) {
      res.json({
        success: false,
        error: errorMessage(error, "Failed to load supplier returns"),
      });
    }
  },
);

// POST /api/warranty/supplier-returns/:id/close — record the answer.
router.post(
  "/supplier-returns/:id/close",
  requireRole(["admin"]),
  (req, res) => {
    const parsed = closeSupplierReturnSchema.safeParse({
      ...((req.body as Record<string, unknown>) ?? {}),
      supplier_return_id: req.params.id,
    });
    if (!parsed.success) {
      res.json({
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid request",
      });
      return;
    }
    const result = getWarrantyService().closeSupplierReturn(
      parsed.data,
      actorOf(req as AuthRequest),
    );
    if (result.success) {
      auditRest(req as AuthRequest, {
        action: "update",
        entity_type: "supplier_return",
        entity_id: String(parsed.data.supplier_return_id),
        summary: `Supplier return #${parsed.data.supplier_return_id}: ${parsed.data.outcome}`,
      });
    }
    res.json(result);
  },
);

// GET /api/warranty/report?from&to&client_day — admin.
router.get(
  "/report",
  requireRole(["admin"]),
  validateQuery(warrantyReportSchema),
  (req, res) => {
    try {
      const data = getWarrantyService().report(
        req.query as unknown as WarrantyReportInput,
      );
      res.json({ success: true, data });
    } catch (error) {
      warrantyLogger.error({ error }, "GET /api/warranty/report failed");
      res.json({
        success: false,
        error: errorMessage(error, "Failed to build the warranty report"),
      });
    }
  },
);

export default router;
