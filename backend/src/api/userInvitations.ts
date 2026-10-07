/**
 * Invite a user into a shop by email (LIRA-281, feature B).
 *
 * Pre-mounted by the v196 foundation commit (server.ts mounts it at
 * `/api/user-invitations`). The full contract — paths, auth, envelopes,
 * error codes, link formats — is in
 * docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md,
 * "Contracts (foundation, 2026-10-07)", section B.
 *
 * Paths below are RELATIVE to `/api/user-invitations`. Every response uses
 * the envelope { success, data?, error? } from createSuccessResponse /
 * createErrorResponse; business refusals are HTTP 200 with a `code`.
 * Authenticated routes: authenticateJWT, THEN requireRole(...), per route
 * (no router-level middleware, because this router also serves public
 * routes). The shop and the actor come from the JWT, never the body.
 *
 * Web-only: the desktop app keeps manual accounts (Settings -> Users ->
 * Create), recorded as a desktop exception like LIRA-267.
 *
 * Static paths (`/check`, `/accept`) are declared before `/:id/...`.
 */

import express from "express";
import {
  acceptUserInvitationSchema,
  checkUserInvitationSchema,
  createSuccessResponse,
  createErrorResponse,
  createUserInvitationSchema,
  getAuditService,
  getUserInvitationService,
  runWithTenant,
  ErrorCodes,
  USER_INVITE_INVALID_MESSAGE,
  USER_INVITE_TTL_HOURS,
  UserInviteShopInactiveError,
  type UserInviteSendContext,
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
  resolveTenantBaseUrl,
} from "../email/emailConfig.js";
import { logger } from "../server.js";
import {
  createPublicLinkLimiter,
  requirePositiveIdParam,
  resolvePublicTokenScope,
  sendFailure,
} from "./userAccountShared.js";

const router = express.Router();

const userInviteLinkLimiter = createPublicLinkLimiter(
  "USER_INVITE_LINK_RATE_LIMIT_MAX",
  "user invite link",
);

function sendContext(): UserInviteSendContext {
  return {
    now: new Date().toISOString(),
    emailConfigured: isEmailConfigured(),
    supportEmail: resolveSupportEmail(),
    resolveLinkBase: (slug) => resolveShopLinkBaseUrl(slug),
    ttlHours: USER_INVITE_TTL_HOURS,
  };
}

function genericRefusal(res: express.Response): void {
  res.json(createErrorResponse(ErrorCodes.FORBIDDEN, USER_INVITE_INVALID_MESSAGE));
}

// =============================================================================
// Public: the /#/join page
// =============================================================================

// POST /check — is this /#/join link usable? Token in the BODY, never the
// path. Every unusable link gets the same 200 + success:false — except an
// otherwise-valid link into a shop whose subscription has lapsed to
// read-only, which says so (SHOP_NOT_ACTIVE): that link is not dead, it
// works again once the shop renews.
router.post(
  "/check",
  userInviteLinkLimiter,
  validateRequest(checkUserInvitationSchema),
  (req, res): void => {
    try {
      const scope = resolvePublicTokenScope(req);
      if (!scope.ok) {
        genericRefusal(res);
        return;
      }
      const now = new Date().toISOString();
      const result = scope.run(() =>
        getUserInvitationService().check(req.body.token, now, scope.requiredTenantId),
      );
      if (!result) {
        genericRefusal(res);
        return;
      }
      res.json(createSuccessResponse(result));
    } catch (error) {
      if (error instanceof UserInviteShopInactiveError) {
        res.json(createErrorResponse(error.code, error.message));
        return;
      }
      logger.error({ error }, "User invite check failed");
      genericRefusal(res);
    }
  },
);

// POST /accept — the invitee picks a username and password. Claim ->
// create user (role + VERIFIED email from the invite) -> finalize, or
// release on failure (USERNAME_TAKEN / EMAIL_TAKEN_IN_SHOP keep the link
// usable). Returns `loginUrl`: the shop's own address, or null when host
// tenancy is off (the page then sends the person to /login here).
router.post(
  "/accept",
  userInviteLinkLimiter,
  validateRequest(acceptUserInvitationSchema),
  (req, res): void => {
    try {
      const scope = resolvePublicTokenScope(req);
      if (!scope.ok) {
        genericRefusal(res);
        return;
      }
      const now = new Date().toISOString();
      const outcome = scope.run(() =>
        getUserInvitationService().accept({
          token: req.body.token,
          username: req.body.username,
          password: req.body.password,
          now,
          requiredTenantId: scope.requiredTenantId,
        }),
      );
      if (!outcome.ok) {
        genericRefusal(res);
        return;
      }

      // Public route, so no req.user: the actor is the user just created,
      // audited in their own shop (like POST /api/auth/signup). Never
      // allowed to turn a committed accept into an error.
      runWithTenant(outcome.shop.id, () => {
        try {
          getAuditService().log({
            user_id: outcome.user.id,
            username: outcome.user.username,
            role: outcome.user.role,
            action: "create",
            entity_type: "user",
            entity_id: String(outcome.user.id),
            summary: `Joined by email invite as ${outcome.user.role}`,
            new_values: {
              username: outcome.user.username,
              role: outcome.user.role,
              email: outcome.invite.email,
            },
            metadata: { via: "invite", invitation_id: outcome.invite.id },
          });
        } catch {
          // Deliberately swallowed — see above.
        }
      });

      res.json(
        createSuccessResponse({ loginUrl: resolveTenantBaseUrl(outcome.shop.slug) }),
      );
    } catch (error) {
      sendFailure(res, error, "User invite accept failed", "Could not create the account");
    }
  },
);

// =============================================================================
// Admin: Settings -> Users
// =============================================================================

// GET / — this shop's newest invites, plus whether links can be emailed.
router.get("/", authenticateJWT, requireRole(["admin"]), (req: AuthRequest, res) => {
  try {
    const ctx = sendContext();
    const service = getUserInvitationService();
    res.json(
      createSuccessResponse({
        emailConfigured: service.emailReady(
          req.user!.tenantId!,
          ctx.emailConfigured,
          ctx.resolveLinkBase,
        ),
        invitations: service.list(ctx.now),
      }),
    );
  } catch (error) {
    sendFailure(res, error, "GET /api/user-invitations failed", "Failed to list invitations");
  }
});

// POST / — invite { email, role } into the admin's shop.
router.post(
  "/",
  authenticateJWT,
  requireRole(["admin"]),
  validateRequest(createUserInvitationSchema),
  (req: AuthRequest, res) => {
    try {
      const invitation = getUserInvitationService().create({
        ...sendContext(),
        tenantId: req.user!.tenantId!,
        email: req.body.email,
        role: req.body.role,
        invitedByUserId: req.user!.userId,
      });
      auditRest(req, {
        action: "user_invitation.create",
        entity_type: "user_invitation",
        entity_id: String(invitation.id),
        summary: `Invited ${invitation.email} as ${invitation.role}`,
        new_values: {
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
      });
      // The token is never in the response: it reaches people only by email.
      res.json(createSuccessResponse({ invitation }));
    } catch (error) {
      sendFailure(res, error, "POST /api/user-invitations failed", "Failed to send the invitation");
    }
  },
);

// POST /:id/revoke — repeating it is harmless (returned unchanged, audited once).
router.post(
  "/:id/revoke",
  authenticateJWT,
  requireRole(["admin"]),
  requirePositiveIdParam("id"),
  (req: AuthRequest, res) => {
    try {
      const { invitation, changed } = getUserInvitationService().revoke(
        Number(req.params.id),
        new Date().toISOString(),
      );
      if (changed) {
        auditRest(req, {
          action: "user_invitation.revoke",
          entity_type: "user_invitation",
          entity_id: String(invitation.id),
          summary: `Revoked the invite sent to ${invitation.email}`,
          new_values: { email: invitation.email, revokedAt: invitation.revokedAt },
        });
      }
      res.json(createSuccessResponse({ invitation }));
    } catch (error) {
      sendFailure(res, error, "Revoke user invitation failed", "Failed to revoke the invitation");
    }
  },
);

// POST /:id/resend — a NEW invite with the same email and role; the old
// one (if still pending) is revoked.
router.post(
  "/:id/resend",
  authenticateJWT,
  requireRole(["admin"]),
  requirePositiveIdParam("id"),
  (req: AuthRequest, res) => {
    try {
      const fromId = Number(req.params.id);
      const invitation = getUserInvitationService().resend(fromId, {
        ...sendContext(),
        tenantId: req.user!.tenantId!,
        invitedByUserId: req.user!.userId,
      });
      auditRest(req, {
        action: "user_invitation.create",
        entity_type: "user_invitation",
        entity_id: String(invitation.id),
        summary: `Re-sent the invite to ${invitation.email} as ${invitation.role}`,
        new_values: {
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
        metadata: { resentFrom: fromId },
      });
      res.json(createSuccessResponse({ invitation }));
    } catch (error) {
      sendFailure(res, error, "Resend user invitation failed", "Failed to resend the invitation");
    }
  },
);

export default router;
