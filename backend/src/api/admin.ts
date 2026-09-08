/**
 * Control-plane API (plan §5, WP5/WP6) — tenant registry CRUD + impersonation.
 *
 * ALL routes sit behind `authenticateJWT` + `requireSuperAdmin`: only a real
 * platform super_admin (role === 'super_admin', tenantId === null, no
 * impersonatorId) reaches any handler here. `requireSuperAdmin` already
 * rejects impersonation tokens (no re-escalation, plan §5 risk #6); the
 * impersonate handler re-checks server-side anyway (defense in depth).
 *
 * Every repository call that reaches across tenants (TenantRepository, the
 * cross-tenant admin lookup) runs inside `runWithoutTenant()` — this router
 * carries no ambient tenant context of its own (super_admin JWTs have
 * `tenantId: null`, so `authenticateJWT` never wraps them in
 * `runWithTenant()`), but wrapping explicitly documents intent and matches
 * plan §5's "TenantRepository + cross-tenant lookups are the only code
 * allowed inside runWithoutTenant()" rule.
 */

import express from "express";
import jwt from "jsonwebtoken";
import {
  getTenantRepository,
  getTenantProvisioningService,
  getSubscriptionService,
  getUserRepository,
  getSessionRepository,
  getAuditRepository,
  runWithoutTenant,
  runWithTenant,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  AppError,
  JWT_SECRET,
  tenantLogger,
  createTenantSchema,
  updateTenantSchema,
} from "@liratek/core";
import {
  authenticateJWT,
  requireSuperAdmin,
  type LiratekJwtPayload,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";
import { randomBytes } from "node:crypto";

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is required. Please set it in your environment variables (min 32 characters).",
  );
}
const jwtSecret: string = JWT_SECRET;

/** Short-lived, no-refresh — plan §5 risk #6. */
const IMPERSONATION_TOKEN_TTL = "2h";

const router = express.Router();

router.use(authenticateJWT, requireSuperAdmin);

// =============================================================================
// GET /api/admin/tenants — list + per-tenant stats
// =============================================================================

router.get("/tenants", (_req, res) => {
  try {
    const tenants = runWithoutTenant(() => getTenantRepository().listAll());
    res.json(createSuccessResponse({ tenants }));
  } catch (error) {
    logger.error({ error }, "GET /api/admin/tenants failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to list tenants",
        ),
      );
  }
});

// =============================================================================
// POST /api/admin/tenants — provision a new tenant
// =============================================================================

router.post("/tenants", validateRequest(createTenantSchema), (req, res) => {
  try {
    const tenant = runWithoutTenant(() =>
      getTenantProvisioningService().provisionTenant({
        name: req.body.name,
        slug: req.body.slug,
        contactName: req.body.contactName,
        contactPhone: req.body.contactPhone,
        notes: req.body.notes,
        adminUsername: req.body.adminUsername,
        adminPassword: req.body.adminPassword,
      }),
    );

    // No IPC precedent (desktop has no tenant-provisioning channel) — new
    // vocabulary per the ticket: action=create, entity_type=tenant. The
    // acting super_admin has tenantId===null (platform realm), so the row
    // is written under the newly-created tenant's own context, same as the
    // impersonate audit below.
    //
    // Routed through `auditRest` (-> AuditService.log(), never throws)
    // rather than calling AuditRepository.log() directly: the tenant is
    // ALREADY committed by this point, so a raw repository call that throws
    // on a write failure would incorrectly turn an already-successful
    // provisioning into a false HTTP 500 (LIRA-104 adversarial-review
    // blocker fix). `runWithTenant` is still required — a super_admin actor
    // has no ambient tenant context of its own.
    runWithTenant(tenant.id, () => {
      auditRest(req, {
        action: "create",
        entity_type: "tenant",
        entity_id: String(tenant.id),
        summary: `Provisioned tenant "${tenant.name}"`,
        new_values: { name: tenant.name, slug: tenant.slug },
      });
    });

    res.status(201).json(createSuccessResponse({ tenant }));
  } catch (error) {
    if (error instanceof AppError) {
      res
        .status(error.statusCode)
        .json(createErrorResponse(error.code, error.message, error.details));
      return;
    }
    logger.error({ error }, "POST /api/admin/tenants failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to provision tenant",
        ),
      );
  }
});

// =============================================================================
// PATCH /api/admin/tenants/:id — update name/status/contact/notes
// =============================================================================

router.patch(
  "/tenants/:id",
  validateRequest(updateTenantSchema),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res
          .status(400)
          .json(
            createErrorResponse(
              ErrorCodes.VALIDATION_ERROR,
              "Invalid tenant id",
            ),
          );
        return;
      }

      const tenant = runWithoutTenant(() =>
        getTenantRepository().update(id, {
          name: req.body.name,
          status: req.body.status,
          contact_name: req.body.contactName,
          contact_phone: req.body.contactPhone,
          notes: req.body.notes,
        }),
      );

      if (!tenant) {
        res
          .status(404)
          .json(
            createErrorResponse(
              ErrorCodes.TENANT_NOT_FOUND,
              "Tenant not found",
            ),
          );
        return;
      }

      // No IPC precedent — new vocabulary per the ticket: action=update,
      // entity_type=tenant. Written under the target tenant's own context
      // (same rationale as the create route above).
      //
      // Routed through `auditRest` (non-throwing) rather than
      // AuditRepository.log() directly — same rationale as POST /tenants
      // above: the update is already committed, so an audit-write failure
      // must not surface as a false HTTP 500.
      runWithTenant(id, () => {
        auditRest(req, {
          action: "update",
          entity_type: "tenant",
          entity_id: String(id),
          summary: `Updated tenant "${tenant.name}"`,
          new_values: req.body,
        });
      });

      res.json(createSuccessResponse({ tenant }));
    } catch (error) {
      if (error instanceof AppError) {
        res
          .status(error.statusCode)
          .json(createErrorResponse(error.code, error.message, error.details));
        return;
      }
      logger.error({ error }, "PATCH /api/admin/tenants/:id failed");
      res
        .status(500)
        .json(
          createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Failed to update tenant",
          ),
        );
    }
  },
);

// =============================================================================
// POST /api/admin/tenants/:id/impersonate — mint a tenant-admin session (WP6)
// =============================================================================

router.post("/tenants/:id/impersonate", (req, res) => {
  try {
    // requireSuperAdmin already guarantees this (role super_admin, tenantId
    // null, no impersonatorId) — re-checked here server-side, defense in
    // depth, per plan §5 step 1.
    if (
      !req.user ||
      req.user.role !== "super_admin" ||
      req.user.tenantId !== null ||
      req.user.impersonatorId !== undefined
    ) {
      res
        .status(403)
        .json(createErrorResponse(ErrorCodes.FORBIDDEN, "Forbidden"));
      return;
    }
    const superAdmin = req.user;

    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      res
        .status(400)
        .json(
          createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid tenant id"),
        );
      return;
    }

    const tenant = runWithoutTenant(() =>
      getTenantRepository().getById(tenantId),
    );
    if (!tenant) {
      res
        .status(404)
        .json(
          createErrorResponse(ErrorCodes.TENANT_NOT_FOUND, "Tenant not found"),
        );
      return;
    }
    if (tenant.status !== "active") {
      res
        .status(409)
        .json(
          createErrorResponse(
            ErrorCodes.TENANT_SUSPENDED,
            `Tenant is ${tenant.status}, not active`,
          ),
        );
      return;
    }

    const tenantAdmin = runWithoutTenant(() =>
      getUserRepository().findFirstActiveAdminByTenant(tenantId),
    );
    if (!tenantAdmin) {
      res
        .status(404)
        .json(
          createErrorResponse(
            ErrorCodes.NO_ACTIVE_TENANT_ADMIN,
            "No active tenant admin found for this tenant",
          ),
        );
      return;
    }

    // Real, revocable DB session for the TENANT ADMIN (not the super admin) —
    // validateSession/logout work exactly like any other session (plan §5
    // step 4). tenant_id is the target tenant, denormalized like every
    // session row.
    const impersonationSession = runWithoutTenant(() =>
      getSessionRepository().createSession({
        user_id: tenantAdmin.id,
        device_type: "impersonation",
        device_info: `impersonated by ${superAdmin.username} (#${superAdmin.userId})`,
        ip_address: req.ip || req.socket.remoteAddress,
        remember_me: false,
        tenant_id: tenantId,
      }),
    );

    const payload: LiratekJwtPayload = {
      userId: tenantAdmin.id,
      role: "admin",
      sessionToken: impersonationSession.token,
      tenantId,
      impersonatorId: superAdmin.userId,
    };
    const token = jwt.sign(payload, jwtSecret, {
      expiresIn: IMPERSONATION_TOKEN_TTL,
    });

    // Audit row lives in the TARGET tenant's realm.
    runWithTenant(tenantId, () => {
      getAuditRepository().log({
        user_id: tenantAdmin.id,
        username: tenantAdmin.username,
        role: tenantAdmin.role,
        action: "IMPERSONATION_START",
        entity_type: "session",
        entity_id: String(impersonationSession.id),
        summary: `Super admin ${superAdmin.username} connected as ${tenantAdmin.username}`,
        impersonator_id: superAdmin.userId,
      });
    });

    tenantLogger.info(
      {
        tenantId,
        tenantAdminId: tenantAdmin.id,
        superAdminId: superAdmin.userId,
      },
      "Impersonation session started",
    );

    res.json(
      createSuccessResponse({
        tenantName: tenant.name,
        username: tenantAdmin.username,
        token,
      }),
    );
  } catch (error) {
    logger.error({ error }, "POST /api/admin/tenants/:id/impersonate failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to start impersonation",
        ),
      );
  }
});

// ===========================================================================
/**
 * A plain, explicitly-named snapshot of a subscription for the audit trail.
 *
 * Never includes license_key: an audit row is readable by the tenant’s OWN
 * admin through the audit viewer, which would hand them the very credential
 * the key exists to control.
 */
function auditSnapshot(
  view: {
    status: string;
    plan: string;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    entitledModules: string[] | null;
  } | null,
): Record<string, unknown> | undefined {
  if (!view) return undefined;
  return {
    status: view.status,
    plan: view.plan,
    currentPeriodEnd: view.currentPeriodEnd,
    graceEndsAt: view.graceEndsAt,
    entitledModules: view.entitledModules,
  };
}

// Subscriptions (control plane)
// ===========================================================================
//
// The owner's plan-management surface. Everything here is behind the
// router-level `authenticateJWT + requireSuperAdmin`, which is the point: a
// tenant must never be able to widen its own entitlements. That is why the
// module allowlist lives on the subscription and not in the `modules` table,
// which a tenant's OWN admin can edit.

// GET /api/admin/subscriptions — every tenant's standing, one query
router.get("/subscriptions", (_req, res) => {
  try {
    const service = getSubscriptionService();
    const rows = runWithoutTenant(() => service.listAll());
    // Shipped WITH the rows rather than as a second endpoint: the plan
    // editor cannot render a checkbox list without it, so two requests
    // would only add a way for the page to half-load.
    const sellableModules = runWithoutTenant(() =>
      service.listSellableModules(),
    );
    res.json(createSuccessResponse({ subscriptions: rows, sellableModules }));
  } catch (error) {
    logger.error({ error }, "List subscriptions error");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to list subscriptions",
        ),
      );
  }
});

// PATCH /api/admin/subscriptions/:tenantId
//
// One route for the three things the owner does: record a payment, change
// which modules a customer pays for, and issue or revoke a desktop licence
// key. Each field is applied ONLY if present, so setting a period cannot
// silently clear an allowlist -- which, NULL meaning 'every module', would
// hand a customer the whole app by accident.
router.patch("/subscriptions/:tenantId", (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      res
        .status(400)
        .json(
          createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid tenant id"),
        );
      return;
    }

    const service = getSubscriptionService();
    const before = runWithoutTenant(() => service.statusFor(tenantId));
    if (!before) {
      res
        .status(404)
        .json(
          createErrorResponse(
            ErrorCodes.NOT_FOUND,
            "That tenant has no subscription record",
          ),
        );
      return;
    }

    runWithoutTenant(() => {
      if ("periodEnd" in req.body) {
        // Recording a payment, which also clears any grace deadline --
        // see SubscriptionService.markPaid for why that matters on a
        // SECOND lapse.
        service.markPaid(tenantId, req.body.periodEnd ?? null);
      }
      if ("entitledModules" in req.body) {
        // null restores 'every module'; an array restricts. An EMPTY
        // array is a real choice (nothing but the ungateable chassis),
        // so it must not be coerced to null here.
        const mods = req.body.entitledModules;
        service.setEntitledModules(
          tenantId,
          Array.isArray(mods) ? mods.map(String) : null,
        );
      }
      if ("licenseKey" in req.body) {
        service.setLicenseKey(tenantId, req.body.licenseKey ?? null);
      }
    });

    const after = runWithoutTenant(() => service.statusFor(tenantId));

    auditRest(req, {
      action: "update",
      entity_type: "subscription",
      entity_id: String(tenantId),
      summary: `Updated subscription for tenant ${tenantId}`,
      // Explicit snapshots rather than the view object: auditRest stores
      // Record<string, unknown>, and naming the fields also keeps the audit
      // row stable if the view type later grows something that should not be
      // written to a trail the tenant's own admin can read.
      old_values: auditSnapshot(before),
      new_values: auditSnapshot(after),
    });

    res.json(createSuccessResponse({ subscription: after }));
  } catch (error) {
    logger.error({ error }, "Update subscription error");
    const message = error instanceof Error ? error.message : "Failed to update";
    res
      .status(400)
      .json(createErrorResponse(ErrorCodes.VALIDATION_ERROR, message));
  }
});

// POST /api/admin/subscriptions/:tenantId/license-key
//
// Generates and stores a fresh key, returning it ONCE. Generated here
// rather than typed by the owner so it is long and random by construction;
// 32 hex characters of crypto randomness, prefixed so it is recognisable in
// a support conversation.
//
// Issuing a new key REVOKES the old one, because the column holds exactly
// one -- which is the intended way to cut off an install whose machine was
// sold or whose key leaked.
router.post("/subscriptions/:tenantId/license-key", (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      res
        .status(400)
        .json(
          createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid tenant id"),
        );
      return;
    }

    const key = `lsk_${randomBytes(16).toString("hex")}`;
    runWithoutTenant(() =>
      getSubscriptionService().setLicenseKey(tenantId, key),
    );

    auditRest(req, {
      action: "update",
      entity_type: "subscription",
      entity_id: String(tenantId),
      summary: `Issued a new licence key for tenant ${tenantId}`,
      // The KEY ITSELF is never audited -- an audit row is readable by
      // the tenant's own admin through the audit viewer, which would hand
      // them the credential this is meant to control.
      new_values: { licenseKeyIssued: true },
    });

    res.json(createSuccessResponse({ licenseKey: key }));
  } catch (error) {
    logger.error({ error }, "Issue licence key error");
    res
      .status(400)
      .json(
        createErrorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Failed to issue a licence key",
        ),
      );
  }
});

export default router;
