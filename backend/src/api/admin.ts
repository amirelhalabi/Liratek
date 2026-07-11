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

export default router;
