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
  getTenantStatsService,
  getSubscriptionService,
  getUserRepository,
  getSessionRepository,
  getAuditRepository,
  getAuditService,
  runWithoutTenant,
  runWithTenant,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  AppError,
  JWT_SECRET,
  APP_BASE_DOMAIN,
  tenantLogger,
  createTenantSchema,
  updateTenantSchema,
  createSignupInvitationSchema,
  getSignupInvitationService,
  EMAIL_NOT_CONFIGURED,
} from "@liratek/core";
import {
  authenticateJWT,
  requireSuperAdmin,
  type LiratekJwtPayload,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { logger } from "../server.js";
import {
  provisionTenantDomain,
  deprovisionTenantDomain,
} from "../services/tenantDomains.js";
import { randomBytes } from "node:crypto";
import { isEmailConfigured } from "../email/createTransport.js";
import {
  canSendInvites,
  resolveInviteBaseUrl,
  resolveSupportEmail,
} from "../email/emailConfig.js";

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
    // TenantStatsService fans out per-shop in per-tenant mode (each shop's
    // user_count/last_activity now live in ITS OWN file) and falls straight
    // through to TenantRepository.listAll() unchanged in shared mode —
    // see that service's header comment.
    const tenants = runWithoutTenant(() =>
      getTenantStatsService().listAllWithStats(),
    );
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
        // LIRA-267 FR-013b: optional; a duplicate surfaces as
        // EmailAlreadyHasShopError (409 EMAIL_ALREADY_HAS_SHOP) from the
        // unique index, mapped by the AppError branch below.
        contactEmail: req.body.contactEmail,
        adminUsername: req.body.adminUsername,
        adminPassword: req.body.adminPassword,
      }),
    );

    // No IPC precedent (desktop has no tenant-provisioning channel) — new
    // vocabulary per the ticket: action=create, entity_type=tenant.
    //
    // B-D3: `logAdminAction()` never throws (matches the old `auditRest`
    // contract — the tenant is ALREADY committed by this point, so an audit
    // write failure must not turn an already-successful provisioning into a
    // false HTTP 500, LIRA-104) and now writes BOTH the platform's own
    // durable record (`tenant_id NULL`) and a shop-note row inside the new
    // tenant's own file.
    getAuditService().logAdminAction({
      actorUserId: req.user!.userId,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      targetTenantId: tenant.id,
      action: "create",
      entityType: "tenant",
      entityId: String(tenant.id),
      summary: `Provisioned tenant "${tenant.name}"`,
      newValues: { name: tenant.name, slug: tenant.slug },
    });

    // Same automatic subdomain as self-service signup -- a tenant the
    // owner creates by hand should not need different follow-up work.
    void provisionTenantDomain(tenant.slug);

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
// POST /api/admin/signup-invitations — email a single-use sign-up link
// (LIRA-267). Web-only: the desktop app has no platform admin.
// =============================================================================

router.post(
  "/signup-invitations",
  validateRequest(createSignupInvitationSchema),
  (req, res) => {
    try {
      const baseUrl = resolveInviteBaseUrl();
      if (!baseUrl) {
        // Without a base URL the emailed link would point nowhere. Same
        // answer as "no mail transport": the deployment cannot send invites.
        res
          .status(409)
          .json(
            createErrorResponse(
              EMAIL_NOT_CONFIGURED,
              "Invite links are not configured on this server (set SIGNUP_INVITE_BASE_URL or APP_BASE_DOMAIN)",
            ),
          );
        return;
      }

      const invitation = runWithoutTenant(() =>
        getSignupInvitationService().create({
          source: "admin",
          email: req.body.email,
          shopNameHint: req.body.shopNameHint,
          // The actor comes from the JWT, never the body.
          invitedByUserId: req.user!.userId,
          now: new Date().toISOString(),
          baseUrl,
          emailConfigured: isEmailConfigured(),
          supportEmail: resolveSupportEmail(),
        }),
      );

      // A platform action with no shop yet: targetTenantId null writes the
      // platform row only. Never throws (see logAdminAction).
      getAuditService().logAdminAction({
        actorUserId: req.user!.userId,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        targetTenantId: null,
        action: "signup_invitation.create",
        entityType: "signup_invitation",
        entityId: String(invitation.id),
        summary: `Sent a sign-up invite to ${invitation.email}`,
        newValues: {
          email: invitation.email,
          shopNameHint: invitation.shopNameHint,
          expiresAt: invitation.expiresAt,
        },
      });

      // The token is never in the response: it reaches people only by email.
      res.status(201).json(createSuccessResponse({ invitation }));
    } catch (error) {
      if (error instanceof AppError) {
        res
          .status(error.statusCode)
          .json(createErrorResponse(error.code, error.message, error.details));
        return;
      }
      logger.error({ error }, "POST /api/admin/signup-invitations failed");
      res
        .status(500)
        .json(
          createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Failed to create the invitation",
          ),
        );
    }
  },
);

// =============================================================================
// GET /api/admin/signup-invitations — the newest 200 invites (LIRA-267, US2)
// =============================================================================

router.get("/signup-invitations", (_req, res) => {
  try {
    const now = new Date().toISOString();
    const invitations = runWithoutTenant(() =>
      getSignupInvitationService().list(now),
    );
    res.json(
      createSuccessResponse({
        emailConfigured: canSendInvites(),
        invitations,
      }),
    );
  } catch (error) {
    logger.error({ error }, "GET /api/admin/signup-invitations failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to list invitations",
        ),
      );
  }
});

// =============================================================================
// POST /api/admin/signup-invitations/:id/revoke — refuse an invite's link
// (LIRA-267, US2). Repeating it is harmless: an already-revoked invite comes
// back 200 unchanged and is not audited again.
// =============================================================================

router.post("/signup-invitations/:id/revoke", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res
        .status(400)
        .json(
          createErrorResponse(
            ErrorCodes.VALIDATION_ERROR,
            "Invalid invitation id",
          ),
        );
      return;
    }

    const { invitation, changed } = runWithoutTenant(() =>
      getSignupInvitationService().revoke(id, new Date().toISOString()),
    );

    if (changed) {
      // Platform action, no shop: platform row only. Never throws.
      getAuditService().logAdminAction({
        actorUserId: req.user!.userId,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        targetTenantId: null,
        action: "signup_invitation.revoke",
        entityType: "signup_invitation",
        entityId: String(invitation.id),
        summary: `Revoked the sign-up invite sent to ${invitation.email}`,
        newValues: { email: invitation.email, revokedAt: invitation.revokedAt },
      });
    }

    res.json(createSuccessResponse({ invitation }));
  } catch (error) {
    if (error instanceof AppError) {
      res
        .status(error.statusCode)
        .json(createErrorResponse(error.code, error.message, error.details));
      return;
    }
    logger.error(
      { error },
      "POST /api/admin/signup-invitations/:id/revoke failed",
    );
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to revoke the invitation",
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
      // entity_type=tenant. Same B-D3 rationale as POST /tenants above: the
      // update is already committed, so a non-throwing write is required,
      // and both a platform row and a shop note are written.
      getAuditService().logAdminAction({
        actorUserId: req.user!.userId,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        targetTenantId: id,
        action: "update",
        entityType: "tenant",
        entityId: String(id),
        summary: `Updated tenant "${tenant.name}"`,
        newValues: req.body,
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

    // The shop admin lives in the TARGET SHOP's own file (per-tenant mode),
    // not the platform file — `findFirstActiveAdminByTenant`'s explicit
    // `tenant_id = ?` predicate stays as a second fence either way.
    const tenantAdmin = runWithTenant(tenantId, () =>
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
    // step 4). B-D1: the session lives in the SHOP's own file (the JWT's
    // signed `tenantId` claim is what routes the later session check there),
    // so this write must land in the shop scope, not the platform bypass.
    // tenant_id is still denormalized onto the row, like every session row.
    const impersonationSession = runWithTenant(tenantId, () =>
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

    // B-D3: two rows, same as every other admin action.
    //
    // Platform row — the durable control-plane record, actor = the super
    // admin's OWN (valid, platform-file) identity, target shop folded into
    // metadata.
    runWithoutTenant(() => {
      getAuditRepository().log({
        user_id: superAdmin.userId,
        username: superAdmin.username,
        role: "super_admin",
        action: "IMPERSONATION_START",
        entity_type: "tenant",
        entity_id: String(tenantId),
        summary: `Super admin ${superAdmin.username} connected as ${tenantAdmin.username}`,
        metadata: {
          targetTenantId: tenantId,
          tenantAdminId: tenantAdmin.id,
          tenantAdminUsername: tenantAdmin.username,
        },
      });
    });

    // Shop-note row — lives in the TARGET tenant's own file, recorded under
    // the tenant admin's OWN (valid, shop-file) identity, same as before.
    // `impersonator_id` is now ALWAYS NULL (never the super admin's platform
    // id, which does not exist as a `users` row in the shop's file and would
    // violate the FK the moment this runs against a real per-tenant
    // database) — the impersonator's identity is preserved in `metadata`
    // instead, so a future audit viewer can still show "impersonated by X"
    // without an FK.
    runWithTenant(tenantId, () => {
      getAuditRepository().log({
        user_id: tenantAdmin.id,
        username: tenantAdmin.username,
        role: tenantAdmin.role,
        action: "IMPERSONATION_START",
        entity_type: "session",
        entity_id: String(impersonationSession.id),
        summary: `Super admin ${superAdmin.username} connected as ${tenantAdmin.username}`,
        impersonator_id: null,
        metadata: {
          impersonatedBy: superAdmin.username,
          impersonatorUserId: superAdmin.userId,
        },
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

    // Which ORIGIN this session should be opened on.
    //
    // "Connect as admin" used to open a relative URL, so the impersonated
    // session landed on whatever host the control plane was being served
    // from -- `www`, i.e. the platform host. That is now the one host no
    // tenant user ever signs in on, so a super admin would be exercising the
    // app somewhere real users never are, and could not catch anything
    // specific to a tenant's own subdomain.
    //
    // Same shape as the signup response's `loginUrl`, and null for the same
    // reason: with no APP_BASE_DOMAIN there is no per-tenant origin, and
    // inventing one would open a dead tab. The caller falls back to a
    // relative URL, which is the old behaviour.
    const targetOrigin = APP_BASE_DOMAIN
      ? `https://${tenant.slug}.${APP_BASE_DOMAIN}`
      : null;

    res.json(
      createSuccessResponse({
        tenantName: tenant.name,
        username: tenantAdmin.username,
        token,
        targetOrigin,
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

    // B-D3 + the pre-existing dropped-audit bug: this call used to go through
    // `auditRest` with NO scope wrapping at all, so `AuditRepository.log()`'s
    // `getCurrentTenantId()` threw and `AuditService.log()` silently
    // swallowed it -- the row was NEVER written. `logAdminAction()` wraps its
    // platform write in `runWithoutTenant()` explicitly, so it now lands.
    getAuditService().logAdminAction({
      actorUserId: req.user!.userId,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      targetTenantId: tenantId,
      action: "update",
      entityType: "subscription",
      entityId: String(tenantId),
      summary: `Updated subscription for tenant ${tenantId}`,
      // Explicit snapshots rather than the view object: naming the fields
      // keeps the audit row stable if the view type later grows something
      // that should not be written to a trail the tenant's own admin can
      // read.
      oldValues: auditSnapshot(before),
      newValues: auditSnapshot(after),
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

    // Same dropped-audit bug and B-D3 fix as PATCH /subscriptions/:tenantId
    // above -- this write used to be silently lost.
    getAuditService().logAdminAction({
      actorUserId: req.user!.userId,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      targetTenantId: tenantId,
      action: "update",
      entityType: "subscription",
      entityId: String(tenantId),
      summary: `Issued a new licence key for tenant ${tenantId}`,
      // The KEY ITSELF is never audited -- an audit row is readable by
      // the tenant's own admin through the audit viewer, which would hand
      // them the credential this is meant to control.
      newValues: { licenseKeyIssued: true },
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

// ===========================================================================
// Tenant lifecycle: rename and delete
// ===========================================================================

// PATCH /api/admin/tenants/:id/slug — change a tenant's public address
//
// Separate from PATCH /tenants/:id because a slug is not an attribute: it is
// where the tenant's staff log in. Folding it into the general update would
// let a rename ride along with an innocuous edit to a contact name.
//
// The new subdomain is provisioned and the OLD one removed, both fail-soft:
// the registry change is what matters, and DNS that lags behind is fixable
// while a half-applied rename is not.
router.patch("/tenants/:id/slug", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res
        .status(400)
        .json(
          createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid tenant id"),
        );
      return;
    }

    const nextSlug = String(req.body?.slug ?? "").trim();
    const before = runWithoutTenant(() => getTenantRepository().getById(id));
    if (!before) {
      res
        .status(404)
        .json(
          createErrorResponse(ErrorCodes.TENANT_NOT_FOUND, "Tenant not found"),
        );
      return;
    }

    const tenant = runWithoutTenant(() =>
      getTenantProvisioningService().changeTenantSlug(id, nextSlug),
    );

    // Old host first: if the same record were re-created below under a new
    // name, deleting afterwards could remove the one just made.
    if (before.slug !== tenant.slug) {
      await deprovisionTenantDomain(before.slug);
    }
    const domain = await provisionTenantDomain(tenant.slug);

    getAuditService().logAdminAction({
      actorUserId: req.user!.userId,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      targetTenantId: id,
      action: "update",
      entityType: "tenant",
      entityId: String(id),
      summary: `Renamed tenant slug "${before.slug}" to "${tenant.slug}"`,
      oldValues: { slug: before.slug },
      newValues: { slug: tenant.slug },
    });

    res.json(createSuccessResponse({ tenant, domain }));
  } catch (error) {
    if (error instanceof AppError) {
      res
        .status(error.statusCode)
        .json(createErrorResponse(error.code, error.message, error.details));
      return;
    }
    logger.error({ error }, "PATCH /api/admin/tenants/:id/slug failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to change the tenant slug",
        ),
      );
  }
});

// DELETE /api/admin/tenants/:id — permanent, with everything it owns
//
// Requires `confirmSlug` in the body to match the tenant's slug. Enforced
// HERE and not only in a dialog: an id off by one is an easy mistake to make
// against an API, and this is the one operation with no undo.
//
// The audit row is written BEFORE the delete. Afterwards there is no tenant
// to write it under -- runWithTenant would target rows that no longer exist,
// and the record of the deletion is the one thing that must survive it.
router.delete("/tenants/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res
        .status(400)
        .json(
          createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid tenant id"),
        );
      return;
    }

    const tenant = runWithoutTenant(() => getTenantRepository().getById(id));
    if (!tenant) {
      res
        .status(404)
        .json(
          createErrorResponse(ErrorCodes.TENANT_NOT_FOUND, "Tenant not found"),
        );
      return;
    }

    getAuditService().logAdminAction({
      actorUserId: req.user!.userId,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      targetTenantId: id,
      action: "delete",
      entityType: "tenant",
      entityId: String(id),
      summary: `Permanently deleted tenant "${tenant.name}" (${tenant.slug})`,
      oldValues: { name: tenant.name, slug: tenant.slug },
    });

    const result = runWithoutTenant(() =>
      getTenantProvisioningService().deleteTenant(
        id,
        String(req.body?.confirmSlug ?? ""),
      ),
    );

    // Fail-soft: the tenant is gone either way, and a leftover DNS record is
    // a tidy-up, not a failure to report as one.
    const domain = await deprovisionTenantDomain(tenant.slug);

    res.json(
      createSuccessResponse({ deleted: tenant.slug, ...result, domain }),
    );
  } catch (error) {
    if (error instanceof AppError) {
      res
        .status(error.statusCode)
        .json(createErrorResponse(error.code, error.message, error.details));
      return;
    }
    logger.error({ error }, "DELETE /api/admin/tenants/:id failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to delete tenant",
        ),
      );
  }
});

export default router;
