/**
 * POST /api/auth/signup — the Google branch (LIRA-280, feature D).
 *
 * Mounted from auth.ts under its `[auth-D]` anchor, ahead of the invite-link
 * route, for bodies that carry `googleTicket`. Google already proved the
 * email (the callback refuses `email_verified !== true`), so the emailed-link
 * step is skipped and the signed sign-up ticket is the proof instead:
 *   - the shop's contact email is the TICKET's email, never the body's, and
 *     the first admin is linked to it VERIFIED at the instant Google
 *     confirmed it;
 *   - the admin still sets a username AND a password (owner decision
 *     2026-10-07), enforced by `googleSignupSchema`;
 *   - "one shop per contact email" (LIRA-267) still holds: provisioning's
 *     unique index throws EMAIL_ALREADY_HAS_SHOP, answered like the invite
 *     route answers it. That index is also what stops one ticket from
 *     creating a second shop;
 *   - after provisioning, the new admin is linked to the Google `sub`, so
 *     "Continue with Google" opens this shop from then on.
 *
 * Provisioning and the identity link are two steps, not one transaction: a
 * failed link leaves a working shop whose admin can connect Google from
 * Settings, which is logged and never turns the sign-up into an error.
 */

import type { Request, Response, RequestHandler } from "express";
import {
  AppError,
  EMAIL_ALREADY_HAS_SHOP,
  ErrorCodes,
  GOOGLE_NOT_CONFIGURED,
  createErrorResponse,
  createSuccessResponse,
  getAuditService,
  getGoogleAuthService,
  getTenantProvisioningService,
  getUserRepository,
  googleSignupSchema,
  runWithTenant,
  runWithoutTenant,
  type TenantEntity,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { provisionTenantDomain } from "../services/tenantDomains.js";
import { resolveTenantBaseUrl } from "../email/emailConfig.js";
import {
  isGoogleSignupOpen,
  readSignupTicket,
  verifyTicket,
} from "../security/googleOAuth.js";
import { logger } from "../server.js";

const GOOGLE_SIGNUP_INVALID =
  "This Google sign-up has expired. Please continue with Google again.";

/** True for a body that chose the Google proof. */
export function isGoogleSignupBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).googleTicket !== undefined
  );
}

interface GoogleSignupBody {
  name: string;
  slug: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  adminUsername: string;
  adminPassword: string;
  googleTicket: string;
}

function handleGoogleSignup(req: Request, res: Response): void {
  // Re-checked here, not only at /start: a ticket minted before the
  // self-serve switch was turned off stays signed for 30 minutes.
  if (!isGoogleSignupOpen()) {
    // Contract envelope: 200 + top-level `code` (GOOGLE_NOT_CONFIGURED).
    res.json({
      success: false,
      error: "Creating a shop with Google is not available right now.",
      code: GOOGLE_NOT_CONFIGURED,
    });
    return;
  }
  const body = req.body as GoogleSignupBody;
  const ticket = readSignupTicket(verifyTicket("signup", body.googleTicket));
  if (!ticket) {
    res.status(403).json(createErrorResponse(ErrorCodes.FORBIDDEN, GOOGLE_SIGNUP_INVALID));
    return;
  }

  try {
    const now = new Date().toISOString();
    // Fields listed explicitly so nothing else in the body (googleTicket,
    // a stray contactEmail) reaches provisioning.
    const tenant = runWithoutTenant(() =>
      getTenantProvisioningService().provisionTenant({
        name: body.name,
        slug: body.slug,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        notes: body.notes,
        adminUsername: body.adminUsername,
        adminPassword: body.adminPassword,
        contactEmail: ticket.email,
        contactEmailVerifiedAt: ticket.verifiedAt,
      }),
    ) as TenantEntity;

    runWithTenant(tenant.id, () => {
      const admin = getUserRepository().findByUsernameInRealm(
        body.adminUsername,
        tenant.id,
      );
      try {
        if (!admin) throw new Error("new admin not found");
        getGoogleAuthService().linkIdentity({
          userId: admin.id,
          subject: ticket.sub,
          email: ticket.email,
          now,
        });
      } catch (error) {
        logger.error(
          { error, tenantId: tenant.id },
          "Google sign-up: shop created but the Google link failed",
        );
      }
      // Same audit row as the invite-link sign-up, `via: "google"`.
      try {
        getAuditService().log({
          user_id: admin?.id ?? 0,
          username: body.adminUsername,
          role: "admin",
          action: "create",
          entity_type: "tenant",
          entity_id: String(tenant.id),
          summary: `Self-service signup created tenant "${tenant.name}"`,
          new_values: { name: tenant.name, slug: tenant.slug },
          metadata: { self_service: true, via: "google" },
        });
      } catch {
        // A failing audit never turns a committed sign-up into an error.
      }
    });

    logger.info(
      { tenantId: tenant.id, slug: tenant.slug, via: "google" },
      "Tenant created via self-service signup",
    );
    void provisionTenantDomain(tenant.slug);

    res.status(201).json(
      createSuccessResponse({
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        loginUrl: resolveTenantBaseUrl(tenant.slug),
      }),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === EMAIL_ALREADY_HAS_SHOP) {
      logger.warn({ slug: body.slug }, "Google sign-up refused: email has a shop");
      res
        .status(400)
        .json(createErrorResponse(EMAIL_ALREADY_HAS_SHOP, "This email already has a shop."));
      return;
    }
    const message = error instanceof Error ? error.message : "Signup failed";
    logger.warn({ error, slug: body.slug }, "Google sign-up failed");
    res.status(400).json(createErrorResponse(ErrorCodes.VALIDATION_ERROR, message));
  }
}

/** Schema check, then the handler. auth.ts adds the gate and the limiter. */
export const googleSignupRoute: RequestHandler[] = [
  validateRequest(googleSignupSchema),
  handleGoogleSignup,
];
