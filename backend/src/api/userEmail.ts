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
  getUserEmailService,
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
import {
  createPublicLinkLimiter,
  requirePositiveIdParam,
  resolvePublicTokenScope,
  sendFailure,
} from "./userAccountShared.js";

const router = express.Router();

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
router.delete(
  "/:userId/google",
  authenticateJWT,
  requireRole(["admin"]),
  requirePositiveIdParam("userId"),
  (req: AuthRequest, res) => {
    const userId = Number(req.params.userId);
    try {
      const { user, unlinked } = getUserEmailService().adminUnlinkGoogle(userId, {
        tenantId: req.user!.tenantId!,
        now: new Date().toISOString(),
      });
      if (unlinked) {
        auditRest(req, {
          action: "google_link.remove",
          entity_type: "user",
          entity_id: String(userId),
          summary: "Disconnected this user's Google sign-in",
          metadata: { by: "admin" },
        });
      }
      res.json(createSuccessResponse({ user }));
    } catch (error) {
      sendFailure(res, error, "Admin Google disconnect failed", "Failed to disconnect Google");
    }
  },
);

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
