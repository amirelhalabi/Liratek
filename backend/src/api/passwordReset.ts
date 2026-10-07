/**
 * Forgot / reset password, and the admin's "send reset link" (LIRA-275/276, feature C).
 *
 * Pre-mounted by the v196 foundation commit (server.ts mounts it at
 * `/api/password-reset`). The full contract — paths, auth, envelopes, error
 * codes, link formats — is in
 * docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md,
 * "Contracts (foundation, 2026-10-07)", section C. All logic lives in core's
 * PasswordResetService; this file only resolves the shop from the host,
 * applies the limiters, maps outcomes to envelopes and audits.
 *
 *   POST /forgot          public   { email, shop? }    -> always the same message
 *   POST /check           public   { token }           -> { username, shopName }
 *   POST /reset           public   { token, password } -> { loginUrl }
 *   POST /send/:userId    JWT + admin                  -> { sent: true }
 *
 * Envelopes: business refusals are HTTP 200 + `success:false`. Refusals
 * built with createErrorResponse carry `error: { code, message }` AND the
 * same `code` at the top level (the contract's `{ success:false, code }`
 * shape). Zod failures come from validateRequest (200 + string error).
 * Tokens travel in the BODY, never the path, so they stay out of access
 * logs. Web-only: the desktop app has no email reset (same exception as
 * LIRA-267's sign-up links). Authenticated routes: authenticateJWT, THEN
 * requireRole(...), per route (this router also serves public routes).
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import {
  PASSWORD_RESET_TTL_MINUTES,
  PASSWORD_RESET_CODES,
  PASSWORD_RESET_INVALID_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  checkResetTokenSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  forgotPasswordSchema,
  getAuditService,
  getPasswordResetService,
  getTenantRepository,
  isAppError,
  resetPasswordSchema,
  runWithTenant,
  runWithoutTenant,
  type PasswordResetMailOptions,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  clientIpRateLimitKey,
  resolveClientIp,
} from "../middleware/clientIp.js";
import { auditRest } from "../middleware/audit.js";
import { resolveTenantHost } from "../middleware/tenantHost.js";
import { isEmailConfigured } from "../email/createTransport.js";
import {
  resolveShopLinkBaseUrl,
  resolveSupportEmail,
  resolveTenantBaseUrl,
} from "../email/emailConfig.js";
import { logger } from "../server.js";

const router = express.Router();

// =============================================================================
// Client IP + limiters
// =============================================================================

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function hourlyLimiter(label: string, envName: string, max: number) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: envLimit(envName, max),
    standardHeaders: true,
    legacyHeaders: false,
    // The real client IP (CLIENT_IP_HEADER, else req.ip), IPv6 grouped by
    // its /56 — the one helper every public limiter shares.
    keyGenerator: (req) => clientIpRateLimitKey(req),
    handler: (req, res) => {
      logger.warn(
        { ip: resolveClientIp(req), path: req.path },
        `Rate limit exceeded - ${label}`,
      );
      res.status(429).json({
        success: false,
        error: "Too many requests, please try again later",
      });
    },
  });
}

/** Contract C: 5 "forgot" requests per hour per client IP. Counts every
 * request: a success is exactly what it limits. */
const forgotLimiter = hourlyLimiter(
  "password reset request",
  "PASSWORD_RESET_FORGOT_RATE_LIMIT_MAX",
  5,
);

/** /check runs on every load of the reset page and /reset on every submit;
 * both reveal only "usable or not" for a 256-bit token. A roomier budget,
 * like the sign-up invite check (30/hour). */
const tokenLimiter = hourlyLimiter(
  "password reset link",
  "PASSWORD_RESET_TOKEN_RATE_LIMIT_MAX",
  30,
);

// =============================================================================
// Helpers
// =============================================================================

/** A refusal with its code both inside `error` and at the top level. */
function refusal(code: string, message: string) {
  return { ...createErrorResponse(code, message), code };
}

function invalidLink(res: Response): void {
  res.json(refusal(ErrorCodes.FORBIDDEN, PASSWORD_RESET_INVALID_MESSAGE));
}

/** Server-side mail settings, read per request. */
function mailOptions(now: string): PasswordResetMailOptions {
  return {
    now,
    linkBaseUrl: (slug) => resolveShopLinkBaseUrl(slug),
    emailConfigured: isEmailConfigured(),
    supportEmail: resolveSupportEmail(),
    ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
  };
}

type HostShop = { ok: true; tenantId: number | null } | { ok: false };

/**
 * Which shop a public token route is on, from the host:
 *   - a shop's own address: that shop (the token must be that shop's);
 *   - a host that names no shop (www, or host tenancy off: dev, preview,
 *     e2e): null — no host check applies;
 *   - an unknown subdomain: not ok — always the generic refusal.
 */
function hostShop(req: Request): HostShop {
  const realm = resolveTenantHost(req);
  if (realm.kind === "unknown") return { ok: false };
  if (realm.kind === "tenant") return { ok: true, tenantId: realm.tenant.id };
  return { ok: true, tenantId: null };
}

/** Run under the host shop's scope when there is one (per-tenant DB mode
 * needs it before the cross-tenant token lookup), else with no tenant. */
function inHostScope<T>(tenantId: number | null, fn: () => T): T {
  return tenantId === null
    ? runWithoutTenant(fn)
    : runWithTenant(tenantId, fn);
}

/** Positive integer path id, strictly (mirrors users.ts). */
function validateUserIdParam(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!/^[1-9]\d*$/.test(req.params.userId ?? "")) {
    res.json(refusal(ErrorCodes.VALIDATION_ERROR, "Invalid user ID"));
    return;
  }
  next();
}

// =============================================================================
// POST /forgot — "Forgot password?" (PUBLIC)
// =============================================================================
//
// The shop is the host's shop. On a host that names none (www, or host
// tenancy off) it is the typed `shop` address; with neither, SHOP_REQUIRED.
// On a shop's address a typed `shop` is ignored: the host decides. An
// unknown shop, an unknown or unverified email, the per-user limit and a
// missing mail setup ALL get the same success message, so the form cannot
// be used to learn which emails have accounts. No audit row: no actor.
router.post(
  "/forgot",
  forgotLimiter,
  validateRequest(forgotPasswordSchema),
  (req, res): void => {
    const sent = (): void => {
      res.json(
        createSuccessResponse({ message: PASSWORD_RESET_REQUEST_MESSAGE }),
      );
    };
    try {
      const body = req.body as { email: string; shop?: string };
      const realm = resolveTenantHost(req);

      let tenantId: number;
      if (realm.kind === "tenant") {
        tenantId = realm.tenant.id;
      } else if (realm.kind === "unknown") {
        sent();
        return;
      } else {
        const slug = body.shop;
        if (!slug) {
          res.json(
            refusal(
              PASSWORD_RESET_CODES.SHOP_REQUIRED,
              "Enter your shop's address.",
            ),
          );
          return;
        }
        const tenant = runWithoutTenant(() =>
          getTenantRepository().getBySlug(slug),
        );
        if (!tenant || tenant.status !== "active") {
          sent();
          return;
        }
        tenantId = tenant.id;
      }

      runWithTenant(tenantId, () =>
        getPasswordResetService().requestByEmail({
          ...mailOptions(new Date().toISOString()),
          tenantId,
          email: body.email,
          requesterIp: resolveClientIp(req) || null,
        }),
      );
      sent();
    } catch (error) {
      // Still the generic answer: an error must not reveal that the email
      // matched an account (only that path does real work).
      logger.error({ error }, "Password reset request failed");
      sent();
    }
  },
);

// =============================================================================
// POST /check — is this reset link usable? (PUBLIC)
// =============================================================================
router.post(
  "/check",
  tokenLimiter,
  validateRequest(checkResetTokenSchema),
  (req, res): void => {
    try {
      const host = hostShop(req);
      if (!host.ok) {
        invalidLink(res);
        return;
      }
      const { token } = req.body as { token: string };
      const result = inHostScope(host.tenantId, () =>
        getPasswordResetService().check(
          token,
          new Date().toISOString(),
          host.tenantId,
        ),
      );
      if (!result) {
        invalidLink(res);
        return;
      }
      res.json(createSuccessResponse(result));
    } catch (error) {
      logger.error({ error }, "Password reset link check failed");
      invalidLink(res);
    }
  },
);

// =============================================================================
// POST /reset — choose the new password (PUBLIC)
// =============================================================================
//
// The schema checks the password policy BEFORE anything else, so a weak
// password never uses up the link. The service then consumes the link,
// writes the password, burns the user's other links and deletes ALL of the
// user's sessions in one transaction. Audited in the user's own shop with
// the user as the actor (auditRest needs a JWT this request does not have).
router.post(
  "/reset",
  tokenLimiter,
  validateRequest(resetPasswordSchema),
  (req, res): void => {
    try {
      const host = hostShop(req);
      if (!host.ok) {
        invalidLink(res);
        return;
      }
      const { token, password } = req.body as {
        token: string;
        password: string;
      };
      const done = inHostScope(host.tenantId, () =>
        getPasswordResetService().reset(
          token,
          password,
          new Date().toISOString(),
          host.tenantId,
        ),
      );
      if (!done) {
        invalidLink(res);
        return;
      }

      runWithTenant(done.tenantId, () => {
        // AuditService.log never throws (it logs its own failure).
        getAuditService().log({
          user_id: done.userId,
          username: done.username,
          role: done.role,
          action: "update",
          entity_type: "user",
          entity_id: String(done.userId),
          summary: "Password reset by emailed link",
          metadata: {
            via: "password_reset_link",
            sessions_revoked: done.sessionsRevoked,
          },
        });
      });

      res.json(
        createSuccessResponse({
          loginUrl: resolveTenantBaseUrl(done.tenantSlug),
        }),
      );
    } catch (error) {
      if (isAppError(error) && error.code === ErrorCodes.VALIDATION_ERROR) {
        res.json(refusal(ErrorCodes.VALIDATION_ERROR, error.message));
        return;
      }
      logger.error({ error }, "Password reset failed");
      invalidLink(res);
    }
  },
);

// =============================================================================
// POST /send/:userId — the shop admin emails a user a reset link (LIRA-276)
// =============================================================================
//
// The shop and the actor come from the JWT, never the body. The target must
// be an ACTIVE user of the admin's own shop with a VERIFIED email.
router.post(
  "/send/:userId",
  authenticateJWT,
  requireRole(["admin"]),
  validateUserIdParam,
  (req: AuthRequest, res): void => {
    const userId = Number(req.params.userId);
    const tenantId = req.user?.tenantId;
    try {
      if (tenantId === null || tenantId === undefined) {
        res.json(refusal(PASSWORD_RESET_CODES.NOT_FOUND, "User not found"));
        return;
      }
      const result = getPasswordResetService().sendForUser({
        ...mailOptions(new Date().toISOString()),
        tenantId,
        userId,
      });
      auditRest(req, {
        action: "update",
        entity_type: "user",
        entity_id: String(userId),
        summary: "Sent a password reset link",
        metadata: { via: "password_reset_link" },
      });
      res.json(createSuccessResponse(result));
    } catch (error) {
      if (isAppError(error) && error.isOperational) {
        res.json(refusal(error.code, error.message));
        return;
      }
      logger.error({ error, userId }, "Send password reset link failed");
      res
        .status(500)
        .json(
          refusal(ErrorCodes.INTERNAL_ERROR, "Failed to send the reset link"),
        );
    }
  },
);

export default router;
