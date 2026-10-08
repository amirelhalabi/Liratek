/**
 * A user's own email: set, send verification, verify (LIRA-279, feature B).
 *
 * Pre-mounted by the v196 foundation commit (server.ts mounts it at
 * `/api/user-email`). The full contract — paths, auth, envelopes, error
 * codes, link formats — is in
 * docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md,
 * "Contracts (foundation, 2026-10-07)", section B.
 *
 * Paths below are RELATIVE to `/api/user-email`. Every response uses the
 * envelope { success, data?, error? } from createSuccessResponse /
 * createErrorResponse; business refusals are HTTP 200 with a `code`.
 * Authenticated routes: authenticateJWT, THEN requireRole(...), per route
 * (no router-level middleware, because this router also serves the public
 * `/verify`). The shop comes from the JWT; a user id from another shop is
 * simply NOT_FOUND (every write is tenant-scoped).
 *
 * Web-only: desktop has the column (the schema is shared) but no email.
 *
 * `/verify` is declared before `/:userId`.
 *
 * LIRA-288: GET / also shows each user's Google link, and an admin can
 * disconnect it (DELETE /:userId/google).
 */

import express from "express";
import {
  createSuccessResponse,
  createErrorResponse,
  getPasswordResetService,
  getUserEmailService,
  isAppError,
  setUserEmailSchema,
  verifyUserEmailSchema,
  ErrorCodes,
  EMAIL_VERIFY_INVALID_MESSAGE,
  type UserEmailSendContext,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import { isEmailConfigured } from "../email/createTransport.js";
import {
  resolveShopLinkBaseUrl,
  resolveSupportEmail,
} from "../email/emailConfig.js";
import { logger } from "../server.js";
import { mailOptions as passwordResetMailOptions } from "./passwordReset.js";
import {
  createPublicLinkLimiter,
  requirePositiveIdParam,
  resolvePublicTokenScope,
  sendFailure,
} from "./userAccountShared.js";

const router = express.Router();

/** Every shop role (a super admin has no shop account here). */
const TENANT_ROLES = ["admin", "staff"];

const verifyLinkLimiter = createPublicLinkLimiter(
  "EMAIL_VERIFY_LINK_RATE_LIMIT_MAX",
  "email verify link",
);

function sendContext(req: AuthRequest): UserEmailSendContext {
  return {
    tenantId: req.user!.tenantId!,
    now: new Date().toISOString(),
    emailConfigured: isEmailConfigured(),
    supportEmail: resolveSupportEmail(),
    resolveLinkBase: (slug) => resolveShopLinkBaseUrl(slug),
  };
}

function genericRefusal(res: express.Response): void {
  res.json(createErrorResponse(ErrorCodes.FORBIDDEN, EMAIL_VERIFY_INVALID_MESSAGE));
}

// POST /verify — PUBLIC: the emailed link. The link's shop is checked
// against the host BEFORE the token is spent, so opening it on the wrong
// address does not burn it.
router.post(
  "/verify",
  verifyLinkLimiter,
  validateRequest(verifyUserEmailSchema),
  (req, res): void => {
    try {
      const scope = resolvePublicTokenScope(req);
      if (!scope.ok) {
        genericRefusal(res);
        return;
      }
      const now = new Date().toISOString();
      const verified = scope.run(() =>
        getUserEmailService().verify(req.body.token, now, scope.requiredTenantId),
      );
      if (!verified) {
        genericRefusal(res);
        return;
      }
      res.json(createSuccessResponse({ verified: true }));
    } catch (error) {
      logger.error({ error }, "Email verification failed");
      genericRefusal(res);
    }
  },
);

// GET /me — LIRA-292: the caller's OWN email and verified stamp, for My
// account → Profile. Every shop role; the user comes from the JWT, never a
// param. Read-only, so an impersonated session may read it. Declared before
// the `/:userId` routes. (No existing route answered this: `/api/auth/me`
// deliberately skips the users table, and `GET /` is admin-only.)
router.get(
  "/me",
  authenticateJWT,
  requireRole(TENANT_ROLES),
  (req: AuthRequest, res) => {
    try {
      res.json(createSuccessResponse(getUserEmailService().getOwn(req.user!.userId)));
    } catch (error) {
      sendFailure(res, error, "GET /api/user-email/me failed", "Failed to load your email");
    }
  },
);

// GET / — every user of this shop with their email and verified stamp.
router.get("/", authenticateJWT, requireRole(["admin"]), (_req: AuthRequest, res) => {
  try {
    res.json(createSuccessResponse({ users: getUserEmailService().list() }));
  } catch (error) {
    sendFailure(res, error, "GET /api/user-email failed", "Failed to load user emails");
  }
});

// PUT /:userId — set (unverified, emails a link when it can) or clear.
router.put(
  "/:userId",
  authenticateJWT,
  requireRole(["admin"]),
  requirePositiveIdParam("userId"),
  validateRequest(setUserEmailSchema),
  (req: AuthRequest, res) => {
    const userId = Number(req.params.userId);
    try {
      const result = getUserEmailService().setEmail(
        userId,
        req.body.email ?? null,
        sendContext(req),
      );
      auditRest(req, {
        action: "update",
        entity_type: "user",
        entity_id: String(userId),
        summary: result.email ? "Set user email" : "Removed user email",
        new_values: { email: result.email, verificationSent: result.verificationSent },
      });
      res.json(createSuccessResponse(result));
    } catch (error) {
      sendFailure(res, error, "Set user email failed", "Failed to save the email");
    }
  },
);

// DELETE /:userId/google — LIRA-288: an admin disconnects a member's Google
// sign-in (e.g. staff who left). This shop only; another shop's user (or a
// super admin) is NOT_FOUND. Repeating it changes nothing and is not audited.
// Linking stays self-only (it needs the person's own Google consent).
//
// LIRA-291: when the member has NO password (joined with Google), Google was
// their only way in. The admin was warned by the confirm step; after the
// disconnect a "Set a password" link is emailed (PasswordResetService set
// mode). `passwordLink: "sent" | "not_sent"` (+ `passwordLinkCode` when not
// sent) reports it. A failed send never undoes the disconnect. An admin with
// no password cannot disconnect their OWN Google (SET_PASSWORD_FIRST).
router.delete(
  "/:userId/google",
  authenticateJWT,
  requireRole(["admin"]),
  requirePositiveIdParam("userId"),
  (req: AuthRequest, res) => {
    const userId = Number(req.params.userId);
    try {
      const tenantId = req.user!.tenantId!;
      const now = new Date().toISOString();
      const { user, unlinked } = getUserEmailService().adminUnlinkGoogle(userId, {
        tenantId,
        now,
        actorUserId: req.user!.userId,
      });
      const link =
        unlinked && !user.hasPassword
          ? sendSetPasswordLink(tenantId, userId, now)
          : null;
      if (unlinked) {
        auditRest(req, {
          action: "google_link.remove",
          entity_type: "user",
          entity_id: String(userId),
          summary: "Disconnected this user's Google sign-in",
          metadata: link
            ? { by: "admin", password_link: link.passwordLink }
            : { by: "admin" },
        });
      }
      res.json(createSuccessResponse({ user, ...(link ?? {}) }));
    } catch (error) {
      sendFailure(res, error, "Admin Google disconnect failed", "Failed to disconnect Google");
    }
  },
);

/** LIRA-291: the "Set a password" link after an admin disconnect. Never
 * throws: a refusal (email off, no / unconfirmed email, rate limit) is
 * reported, never undoes the disconnect. */
function sendSetPasswordLink(
  tenantId: number,
  userId: number,
  now: string,
): { passwordLink: "sent" | "not_sent"; passwordLinkCode?: string } {
  try {
    getPasswordResetService().sendForUser({
      ...passwordResetMailOptions(now),
      tenantId,
      userId,
    });
    return { passwordLink: "sent" };
  } catch (error) {
    if (isAppError(error) && error.isOperational) {
      return { passwordLink: "not_sent", passwordLinkCode: error.code };
    }
    logger.error({ error, userId }, "Set-password link after a Google disconnect failed");
    return { passwordLink: "not_sent" };
  }
}

// POST /:userId/send-verification — a fresh link to the current address.
router.post(
  "/:userId/send-verification",
  authenticateJWT,
  requireRole(["admin"]),
  requirePositiveIdParam("userId"),
  (req: AuthRequest, res) => {
    try {
      const result = getUserEmailService().sendVerification(
        Number(req.params.userId),
        sendContext(req),
      );
      res.json(createSuccessResponse(result));
    } catch (error) {
      sendFailure(
        res,
        error,
        "Send verification email failed",
        "Failed to send the verification email",
      );
    }
  },
);

export default router;
