import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import {
  getFinancialService,
  getFinancialServiceRepository,
  getTransactionRepository,
  createFinancialServiceSchema,
  getFinancialServicesSchema,
  selfChargeTelecomItemSchema,
  financialUpdateMetadataSchema,
} from "@liratek/core";
import { logger } from "../server.js";
import type { AuthRequest } from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All services routes require auth
router.use(authenticateJWT);

// Normalise the `providers` query param to `string[] | undefined`, matching
// the desktop IPC handler's `providers?: string[]` (electron-app/handlers/
// omtHandlers.ts's `omt:get-analytics`). Express can hand this value to us
// in three shapes:
//   - absent                                → undefined
//   - a single value ("OMT" or "OMT,WHISH") → the frontend adapter
//     (`frontend/src/api/backendApi.ts`'s `getOMTAnalytics`) joins the array
//     with commas into ONE query value, so this is the shape actually used
//     today — split on comma.
//   - a repeated param (?providers=a&providers=b) → Express gives an array;
//     handled too, so either wire convention works.
// Absent/empty MUST resolve to `undefined`, not `[]`: FinancialServiceRepository
// .getAnalytics() treats a non-empty array as an IN(...) filter but only
// skips the filter when `providers` is falsy/empty (`providers && providers
// .length > 0`), so an accidental `[]` here would not merely "match nothing"
// by SQL semantics — it's guarded on the JS side before it ever reaches
// SQL — but we still normalise to `undefined` to keep the "no filter"
// intent explicit and match the IPC handler's passthrough exactly.
function parseProvidersQuery(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const providers = values
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return providers.length > 0 ? providers : undefined;
}

// GET /api/services/history - Get transaction history
router.get(
  "/history",
  validateQuery(getFinancialServicesSchema),
  (req, res): void => {
    try {
      const provider = req.query.provider as string | undefined;
      const financialService = getFinancialService();
      const history = financialService.getHistory(provider);
      res.json({ success: true, history });
    } catch (error) {
      logger.error({ error }, "Get services history error");
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch history" });
    }
  },
);

// GET /api/services/analytics?providers=OMT,WHISH - Get analytics (today &
// month totals), optionally filtered to a set of providers. Mirrors the
// desktop `omt:get-analytics` IPC handler
// (electron-app/handlers/omtHandlers.ts), which forwards its optional
// `providers?: string[]` straight through to the same
// `FinancialService.getAnalytics(providers?)` — LIRA-158 Phase 5a / D16: this
// route previously ignored the query entirely (`_req`) and always returned
// unfiltered analytics, unlike desktop.
router.get("/analytics", (req, res): void => {
  try {
    const providers = parseProvidersQuery(req.query.providers);
    const financialService = getFinancialService();
    const analytics = financialService.getAnalytics(providers);
    res.json({ success: true, analytics });
  } catch (error) {
    logger.error({ error }, "Get services analytics error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch analytics" });
  }
});

// POST /api/services/transactions - Add transaction
// Role-parity with the desktop IPC handler (electron-app/handlers/omtHandlers.ts
// requires ["admin", "staff"] via requireRole before validating/writing) — this
// route previously had no role check at all, so any authenticated web user
// (any role) could post a financial-service transaction the desktop app
// restricts to admin/staff.
router.post(
  "/transactions",
  requireRole(["admin", "staff"]),
  validateRequest(createFinancialServiceSchema),
  async (req, res): Promise<void> => {
    try {
      const financialService = getFinancialService();
      const userId = (req as AuthRequest).user!.userId;
      const result = financialService.addTransaction({
        ...req.body,
        userId,
      });

      if (result.success) {
        // Mirrors omtHandlers.ts's omt:add-transaction audit
        // (create/financial_transaction).
        auditRest(req, {
          action: "create",
          entity_type: "financial_transaction",
          summary: `${req.body.provider} ${req.body.serviceType}: ${req.body.amount} ${req.body.currency || "USD"}`,
          metadata: {
            provider: req.body.provider,
            serviceType: req.body.serviceType,
            amount: req.body.amount,
            currency: req.body.currency || "USD",
          },
        });
      }

      // Match the IPC envelope: HTTP 200 with { success: false, error }
      // even on a business-rule failure (rule 19c) — the frontend adapter
      // branches on result.success, not the status code.
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Add service transaction error");
      res
        .status(500)
        .json({ success: false, error: "Failed to add transaction" });
    }
  },
);

// POST /api/services/self-charge — charge a telecom catalog item to the
// shop's OWN carrier line (LIRA-090 spec §5.2). No customer is debited; the
// shop's carrier-line credits and validity are updated, and an LBP drawer
// debit records the cost.
//
// Carrier-lines-validity plan, Phase 5 / D6 (2026-08-06): relaxed from
// admin-only to ["admin", "staff"] — rule 19 mirrors the IPC handler
// (`financial:self-charge-telecom-item`, which is now ["admin", "staff"]
// too) now that the iPick/Katsh item card gives staff a day-to-day entry
// point onto this same repository method.
//
// `userId` is injected from the JWT (never trusted from the client body).
// HTTP 200 even on business-rule failure per rule 19c.
router.post(
  "/self-charge",
  requireRole(["admin", "staff"]),
  (req, res): void => {
    const parsed = selfChargeTelecomItemSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.json({
        success: false,
        error: firstIssue?.message ?? "Invalid self-charge payload",
      });
      return;
    }
    try {
      const userId = (req as AuthRequest).user!.userId;
      const service = getFinancialService();
      const result = service.selfChargeTelecomItem({
        ...parsed.data,
        userId,
      });
      // NOTE: unlike the IPC twin (electron-app/handlers/omtHandlers.ts),
      // which calls FinancialServiceRepository.selfChargeTelecomItem
      // directly and lets a business-rule failure throw, this REST route
      // calls the FinancialService WRAPPER
      // (packages/core/src/services/FinancialService.ts's
      // selfChargeTelecomItem), which catches that throw and returns
      // { success: false, error } instead of rethrowing. So reaching this
      // line does NOT mean it committed — gate the audit on result.success,
      // same as every other route in this file, or a caught business-rule
      // failure gets recorded as a successful create.
      if (result.success) {
        // Mirrors omtHandlers.ts's financial:self-charge-telecom-item audit
        // (create/financial_transaction).
        auditRest(req, {
          action: "create",
          entity_type: "financial_transaction",
          summary: `Telecom self-charge: item #${parsed.data.mobileServiceItemId}${parsed.data.carrierLineId ? ` → line #${parsed.data.carrierLineId}` : " (primary)"}`,
          metadata: {
            mobileServiceItemId: parsed.data.mobileServiceItemId,
            carrierLineId: parsed.data.carrierLineId,
          },
        });
      }
      res.json(result);
    } catch (error) {
      logger.error({ error }, "Telecom self-charge error");
      res
        .status(500)
        .json({ success: false, error: "Failed to process self-charge" });
    }
  },
);

// GET /api/services/transactions/:transactionId/payments — all payment rows
// for a unified transaction (the debt-detail "eye" button drills into a
// service-backed debt row). Mirrors IPC `omt:get-payments-by-transaction`
// (electron-app/handlers/omtHandlers.ts), which carries no requireRole
// beyond an authenticated app session — same baseline here (router-level
// authenticateJWT only). Static "transactions" prefix, so this can never be
// swallowed by the single-segment `/:id` route below regardless of
// declaration order (different path-segment count).
router.get("/transactions/:transactionId/payments", (req, res): void => {
  const transactionId = Number(req.params.transactionId);
  if (!Number.isFinite(transactionId)) {
    res.json({ success: false, error: "Invalid transaction id" });
    return;
  }
  try {
    const payments =
      getTransactionRepository().getPaymentsByTransactionId(transactionId);
    res.json({ success: true, payments });
  } catch (error) {
    logger.error({ error }, "Get payments by transaction error");
    res.json({ success: false, error: "Failed to fetch payments" });
  }
});

// POST /api/services/update-metadata (admin + staff — matches
// omtHandlers.ts's "financial:update-metadata" IPC gate). `editedBy` comes
// from the JWT's username claim, never the client body.
router.post(
  "/update-metadata",
  requireRole(["admin", "staff"]),
  validateRequest(financialUpdateMetadataSchema),
  (req, res): void => {
    const editedBy = (req as AuthRequest).user!.username;
    const financialService = getFinancialService();
    const result = financialService.updateFinancialServiceMetadata(
      req.body.id,
      {
        client_name: req.body.client_name,
        phone_number: req.body.phone_number,
        sender_name: req.body.sender_name,
        sender_phone: req.body.sender_phone,
        receiver_name: req.body.receiver_name,
        receiver_phone: req.body.receiver_phone,
        note: req.body.note,
      },
      editedBy,
    );

    if (
      result.success &&
      result.oldValues &&
      Object.keys(result.oldValues).length > 0
    ) {
      // Mirrors omtHandlers.ts's financial:update-metadata audit
      // (edit_metadata/financial_service).
      auditRest(req, {
        action: "edit_metadata",
        entity_type: "financial_service",
        entity_id: String(req.body.id),
        summary: `Edited financial service #${req.body.id} metadata`,
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

// GET /api/services/:id — a single financial_services record by id (the
// debt-detail "eye" button). Mirrors IPC `omt:get-by-id`
// (electron-app/handlers/omtHandlers.ts), which carries no requireRole
// beyond an authenticated app session — same baseline here. Declared LAST
// among this router's GETs so its single-segment `:id` pattern can never
// swallow a static sibling route above it (rule 19 convention, matching
// inventory.ts/loto.ts's ordering comments).
router.get("/:id", (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.json({ success: false, error: "Invalid id" });
    return;
  }
  try {
    const record = getFinancialServiceRepository().findById(id);
    res.json({ success: true, record });
  } catch (error) {
    logger.error({ error }, "Get financial service by id error");
    res.json({ success: false, error: "Failed to fetch record" });
  }
});

export default router;
