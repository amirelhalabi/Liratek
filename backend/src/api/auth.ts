import express from "express";
import {
  getTenantProvisioningService,
  runWithoutTenant,
  signupSchema,
  SIGNUP_INVITE_CODE,
  APP_BASE_DOMAIN,
  getAuthService,
  getAuditService,
  getUserRepository,
  runWithTenant,
  loginSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  JWT_SECRET,
  JWT_EXPIRES_IN,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { signupLimiter, authLimiter } from "../middleware/rateLimit.js";
import { auditRest } from "../middleware/audit.js";
import { provisionTenantDomain } from "../services/tenantDomains.js";
import {
  resolveTenantHost,
  isHostTenancyActive,
  NO_SUCH_REALM,
} from "../middleware/tenantHost.js";
import { authenticateJWT, type LiratekJwtPayload } from "../middleware/auth.js";
import { logger } from "../server.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// Validate JWT configuration on startup
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is required. Please set it in your environment variables (min 32 characters).",
  );
}

const jwtSecret: string = JWT_SECRET;
const jwtExpiresIn: string = JWT_EXPIRES_IN;

// POST /api/auth/login
router.post(
  "/login",
  // Throttled HERE rather than on the whole /api/auth mount. The limiter counts
  // failed requests, and `/me` answers 401 on every logged-out page load — so
  // router-level mounting let ordinary visits to the login page exhaust the
  // quota and lock the visitor out of logging in at all.
  authLimiter,
  validateRequest(loginSchema),
  async (req, res): Promise<void> => {
    try {
      const { username, password, rememberMe } = req.body;

      // Use AuthService with database session support
      const authService = getAuthService();
      // Resolve the realm BEFORE authenticating so the lookup itself is
      // scoped: with per-tenant usernames (v172), two shops can both have an
      // 'admin' and only the host says which one is being addressed.
      const realm = resolveTenantHost(req);
      const realmScope: { realm?: number | null } = isHostTenancyActive(realm)
        ? realm.kind === "tenant"
          ? { realm: realm.tenant.id }
          : realm.kind === "platform"
            ? { realm: null }
            : // unknown subdomain: no realm can match, so no lookup should succeed
              { realm: NO_SUCH_REALM }
        : {};

      const result = await authService.login(username, password, {
        ...realmScope,
        rememberMe: rememberMe || false,
        deviceType: "web",
        deviceInfo: req.headers["user-agent"] || "Unknown",
        ipAddress: req.ip || req.socket.remoteAddress,
      });

      if (!result.success || !result.user || !result.token) {
        res
          .status(401)
          .json(
            createErrorResponse(
              ErrorCodes.INVALID_CREDENTIALS,
              result.error || "Invalid credentials",
            ),
          );
        return;
      }

      const user = result.user;

      // ── Subdomain realm check ──────────────────────────────────────────
      //
      // Credentials must belong to the tenant whose host was addressed. This
      // is a no-op until APP_BASE_DOMAIN is set (and on a host outside it),
      // so the current vercel.app/IP deployment is unaffected.
      //
      // Deliberately AFTER authentication and returning the SAME generic
      // error: rejecting earlier, or with a distinct message, would let
      // anyone probe which subdomain a username belongs to.
      if (isHostTenancyActive(realm)) {
        let denied: string | null = null;
        switch (realm.kind) {
          case "unknown":
            denied = `no tenant for slug "${realm.slug}"`;
            break;
          case "platform":
            if (user.role !== "super_admin") {
              denied = "non-super_admin on the platform realm";
            }
            break;
          case "tenant":
            if (user.tenant_id !== realm.tenant.id) {
              denied = "credentials belong to another tenant";
            } else if (realm.tenant.status !== "active") {
              denied = `tenant is ${realm.tenant.status}`;
            }
            break;
        }

        if (denied) {
          // login() already created a DB session; revoke it or the rejected
          // attempt leaves a usable session row behind.
          try {
            await authService.logout(result.token);
          } catch {
            // best effort — the token is never returned to the client
          }
          logger.warn(
            {
              username,
              realm: realm.kind,
              slug: "slug" in realm ? realm.slug : undefined,
              reason: denied,
            },
            "Login refused: wrong realm for these credentials",
          );
          res
            .status(401)
            .json(
              createErrorResponse(
                ErrorCodes.INVALID_CREDENTIALS,
                "Invalid credentials",
              ),
            );
          return;
        }
      }

      // Create JWT v2: session-linked AND tenant-carrying (plan §3).
      // tenantId comes from the user row (null only for super_admin).
      const payload: LiratekJwtPayload = {
        userId: user.id,
        role: user.role,
        sessionToken: result.token, // Link JWT to database session
        tenantId: user.tenant_id ?? null,
      };
      const jwtToken = jwt.sign(payload, jwtSecret, {
        expiresIn: jwtExpiresIn as jwt.SignOptions["expiresIn"],
      });

      logger.info(
        { userId: user.id, username: user.username, rememberMe },
        "User logged in with database session",
      );

      // Mirrors authHandlers.ts's auth:login audit (action=login,
      // entity_type=session, no entity_id). Fire-and-forget — never blocks
      // the response. tenant_id comes from the just-authenticated user; a
      // platform super_admin (tenant_id null) has no tenant to write the
      // row under, so the log call is skipped for that one case rather than
      // silently failing inside AuditRepository.log()'s getCurrentTenantId().
      const loginTenantId = user.tenant_id ?? null;
      if (loginTenantId !== null) {
        runWithTenant(loginTenantId, () => {
          getAuditService().log({
            user_id: user.id,
            username: user.username,
            role: user.role,
            action: "login",
            entity_type: "session",
            summary: `User "${username}" logged in`,
          });
        });
      }

      res.json(
        createSuccessResponse({
          user: {
            id: result.user.id,
            username: result.user.username,
            role: result.user.role,
          },
          token: jwtToken,
          sessionToken: result.token,
        }),
      );
    } catch (error) {
      logger.error({ error }, "Login error");
      res
        .status(500)
        .json(
          createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Internal server error",
          ),
        );
    }
  },
);

// GET /api/auth/me
// Behind authenticateJWT: (a) closes the same signature-only legacy hole the
// middleware closed (this route used to accept any signed JWT without a DB
// session), and (b) answers from the middleware-validated identity instead of
// a user-table read — which, post multi-tenancy, would require tenant context
// this pre-navigation probe doesn't need.
router.get("/me", authenticateJWT, async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      // authenticateJWT always sets req.user before calling next()
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    res.json({
      success: true,
      user: {
        id: req.user.userId,
        username: req.user.username,
        role: req.user.role,
        tenantId: req.user.tenantId,
      },
    });
  } catch (error) {
    logger.error({ error }, "Get current user error");
    res.status(401).json({ error: "Invalid token" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res): Promise<void> => {
  try {
    // Extract session token from JWT
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, jwtSecret) as {
          userId: number;
          role: string;
          sessionToken?: string;
          tenantId?: number | null;
        };

        // Delete session from database if sessionToken exists
        if (decoded.sessionToken) {
          const authService = getAuthService();
          await authService.logout(decoded.sessionToken);
          logger.info(
            { userId: decoded.userId },
            "User logged out, session deleted",
          );

          // Mirrors authHandlers.ts's auth:logout audit (action=logout,
          // entity_type=session). The verified JWT has no username claim
          // (only login mints usernames into the response, not the token),
          // so resolve it the same way auditFromAuth does on IPC — a
          // best-effort repository lookup, falling back to "user-{id}".
          // Skipped for a null tenantId (platform super_admin) for the same
          // reason as login: there's no tenant to write the row under.
          if (decoded.tenantId != null) {
            const tenantId = decoded.tenantId;
            runWithTenant(tenantId, () => {
              let username = `user-${decoded.userId}`;
              try {
                const user = getUserRepository().findById(decoded.userId);
                if (user?.username) username = user.username;
              } catch {
                // keep the fallback
              }
              getAuditService().log({
                user_id: decoded.userId,
                username,
                role: decoded.role,
                action: "logout",
                entity_type: "session",
                summary: "User logged out",
              });
            });
          }
        }
      } catch (error) {
        logger.warn({ error }, "Failed to decode JWT during logout");
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Logout error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Signed-in devices (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2) ──────
//
// Own-sessions-only for v1 (scope decision in the plan). Every route below:
//   - sits behind authenticateJWT, and reads userId/the comparison token
//     EXCLUSIVELY from req.user (set by authenticateJWT from the verified
//     JWT/session) — never from req.body or req.params. A client has no
//     legitimate way to name whose sessions it is listing or revoking; the
//     only "whose" is always the caller making the request.
//   - returns SafeSession, which NEVER carries `token` (see
//     SessionRepository.toSafeSession) — leaking the bearer credential
//     itself would be strictly worse than the visibility problem this
//     solves.
//   - audits via auditRest (req.user-sourced actor), mirroring /logout's
//     session-ending audit shape (action + entity_type: "session"). Unlike
//     /logout, these routes already sit behind authenticateJWT with a real
//     req.user, so there's no need for /logout's manual JWT-decode dance.

// GET /api/auth/sessions — the caller's OWN active sessions ("signed-in
// devices" list). `is_current` is computed server-side (AuthService ->
// SessionRepository.toSafeSession) by comparing against req.user.sessionToken
// — the client has no token for any session but the one it's calling with,
// so it could never compute this itself.
router.get("/sessions", authenticateJWT, async (req, res): Promise<void> => {
  if (!req.user) {
    // authenticateJWT always sets req.user before calling next()
    res
      .status(401)
      .json(createErrorResponse(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
    return;
  }

  try {
    const authService = getAuthService();
    const sessions = await authService.listUserSessions(
      req.user.userId,
      req.user.sessionToken,
    );
    res.json(createSuccessResponse(sessions));
  } catch (error) {
    logger.error({ error, userId: req.user.userId }, "Failed to list sessions");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to list sessions",
        ),
      );
  }
});

// POST /api/auth/sessions/revoke-others — "sign out everywhere else".
//
// A STATIC path, registered BEFORE the /:id route below (existing
// convention — see clients.ts's /import-debts ahead of its /:id): Express
// matches routes in registration order within the same HTTP method, and a
// literal "revoke-others" segment must never risk being read as an :id.
// (Here it's additionally a different HTTP method (POST vs DELETE) than the
// :id route, so there's no real collision either way — the ordering is kept
// anyway to match the codebase's stated convention.)
//
// AuthService.revokeOtherSessions is built to skip the row whose token
// matches the caller's own (matched by TOKEN, not id) — this route never
// tells it which session to spare, so the caller cannot lock itself out by
// clicking this button.
router.post(
  "/sessions/revoke-others",
  authenticateJWT,
  async (req, res): Promise<void> => {
    if (!req.user) {
      res
        .status(401)
        .json(
          createErrorResponse(ErrorCodes.UNAUTHORIZED, "Not authenticated"),
        );
      return;
    }

    try {
      const authService = getAuthService();
      const revoked = await authService.revokeOtherSessions(
        req.user.userId,
        req.user.sessionToken,
      );

      auditRest(req, {
        action: "revoke_other_sessions",
        entity_type: "session",
        summary: `Signed out of ${revoked} other session${revoked === 1 ? "" : "s"}`,
      });

      res.json(createSuccessResponse({ revoked }));
    } catch (error) {
      logger.error(
        { error, userId: req.user.userId },
        "Failed to revoke other sessions",
      );
      res
        .status(500)
        .json(
          createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Failed to revoke other sessions",
          ),
        );
    }
  },
);

// DELETE /api/auth/sessions/:id — revoke ONE of the caller's own sessions
// ("Revoke" on a single device row).
//
// Revocation is by id, never by token: the client has no token to send for
// any session but its own. AuthService.revokeUserSession delegates the
// ownership check entirely to SessionRepository.deleteByIdForUser, which
// scopes the DELETE by id AND user_id AND tenant_id in one WHERE clause — an
// id belonging to another user or another tenant simply doesn't match and
// comes back `false`, the SAME outcome as an id that never existed. That is
// deliberate: the response must never let a caller distinguish "not yours"
// from "doesn't exist".
//
// No special-casing of the caller's own CURRENT session here — the plan
// (Part 2, "scope decisions") leaves "what happens if you revoke yourself"
// to the UI layer to decide and surface, not this route.
router.delete(
  "/sessions/:id",
  authenticateJWT,
  async (req, res): Promise<void> => {
    if (!req.user) {
      res
        .status(401)
        .json(
          createErrorResponse(ErrorCodes.UNAUTHORIZED, "Not authenticated"),
        );
      return;
    }

    // Positive integer only, and strictly so: match the canonical digit
    // string BEFORE parsing rather than trusting `Number()` + `isInteger()`
    // on the raw param — `Number()` happily accepts "1e3" (exponential
    // notation) and "  5" (leading whitespace) as valid integers, neither of
    // which is a positive-integer id a URL segment should ever legitimately
    // contain. Also rejects "0", negatives, fractions, and non-numeric input.
    const idParam = req.params.id;
    if (!/^[1-9]\d*$/.test(idParam)) {
      // Handled failure, not a framework/thrown error — envelope parity
      // (CLAUDE.md, rule 19c) says REST answers HTTP 200 with
      // {success:false,error} so the adapter's write functions can branch on
      // result.success the same way the IPC side does. A non-2xx here makes
      // requestJson reject before the caller ever sees an envelope at all.
      res.json(
        createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid session ID"),
      );
      return;
    }
    const id = Number(idParam);

    try {
      const authService = getAuthService();
      const revoked = await authService.revokeUserSession(id, req.user.userId);

      if (!revoked) {
        // Same envelope-parity reasoning as the id check above: "not found /
        // not yours" is a handled outcome this route already deliberately
        // makes indistinguishable (see the comment on this route above), not
        // a thrown error — so it gets 200 + {success:false}, not 404.
        res.json(
          createErrorResponse(ErrorCodes.NOT_FOUND, "Session not found"),
        );
        return;
      }

      auditRest(req, {
        action: "revoke_session",
        entity_type: "session",
        entity_id: String(id),
        summary: `Revoked session ${id}`,
      });

      res.json(createSuccessResponse(undefined));
    } catch (error) {
      logger.error(
        { error, userId: req.user.userId, sessionId: id },
        "Failed to revoke session",
      );
      res
        .status(500)
        .json(
          createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Failed to revoke session",
          ),
        );
    }
  },
);

// GET /api/auth/signup-status — what a logged-OUT visitor needs to render the
// login page for this host. (PUBLIC)
//
// Two questions, one request, because the login page asks both on mount:
//
//   enabled       is self-service signup switched on? Exists so the page does
//                 not advertise a door that is bolted. Never the code itself;
//                 it reveals nothing a single POST to /signup would not, and
//                 guessing "enabled" gets nobody closer to the invite code.
//
//   platformHost  is this the shared platform hostname, where only super
//                 admins may sign in? The page needs it to tell a shop's staff
//                 where they SHOULD be signing in. Login itself deliberately
//                 answers every refusal with the same generic error so that
//                 subdomains cannot be probed, which means the hint cannot
//                 come from a failed attempt — it has to be known up front.
//
// Answering only "is this the platform host" (rather than the full realm)
// leaks nothing: which hostname is the platform is public by construction.
router.get("/signup-status", (req, res): void => {
  const realm = resolveTenantHost(req);
  const platformHost = realm.kind === "platform";

  res.json(
    createSuccessResponse({
      enabled: Boolean(SIGNUP_INVITE_CODE),
      platformHost,
      // Only alongside platformHost, and only so the page can spell out the
      // address format ("<your-shop>.liratek.shop"). Null everywhere else.
      baseDomain: platformHost ? APP_BASE_DOMAIN : null,
      // The shop's own name, for the login page header on its subdomain.
      //
      // The header used to read "LiraTek" for everyone, because the name came
      // from a tenant-scoped settings read that cannot work before login --
      // there is no JWT, so there is no tenant. But the HOST already names the
      // tenant, which is the whole point of per-shop subdomains, so the answer
      // is available here without authenticating anyone.
      //
      // Only for a resolved tenant: null on the platform host and on an
      // unknown slug. That does let someone learn which subdomains exist by
      // asking -- accepted deliberately, because a shop's name on its own
      // login page is the thing being asked for, and the slug is already
      // public to anyone who can resolve the DNS name.
      shopName: realm.kind === "tenant" ? realm.tenant.name : null,
    }),
  );
});

// POST /api/auth/signup — self-service tenant creation (PUBLIC, no token)
//
// Feeds the SAME TenantProvisioningService.provisionTenant() a super admin
// uses, so a self-served tenant is indistinguishable from a hand-made one:
// registry row, full per-tenant config seed and first admin user, in one
// transaction. No logic lives here.
//
// Three things make a public write path on a POS platform acceptable:
//   1. It is DISABLED unless SIGNUP_INVITE_CODE is set. Unset is the safe
//      default -- forgetting to configure something cannot expose it.
//   2. signupLimiter counts SUCCESSES, not just failures (unlike the login
//      limiter), because each success permanently consumes a unique slug.
//   3. The slug charset and reserved-name blocklist are the same ones that
//      guard staff-created tenants -- signupSchema extends createTenantSchema
//      rather than restating the rules.
router.post(
  "/signup",
  signupLimiter,
  validateRequest(signupSchema),
  (req, res): void => {
    try {
      const expected = SIGNUP_INVITE_CODE;
      if (!expected) {
        // Not an error the caller can fix, and deliberately not 404: a clear
        // answer is more useful than pretending the route is absent, and it
        // leaks nothing an attacker could not learn by trying.
        res
          .status(403)
          .json(
            createErrorResponse(
              ErrorCodes.FORBIDDEN,
              "Signup is disabled on this deployment",
            ),
          );
        return;
      }

      if (req.body.inviteCode !== expected) {
        logger.warn(
          { slug: req.body.slug },
          "Signup rejected: bad invite code",
        );
        res
          .status(403)
          .json(
            createErrorResponse(ErrorCodes.FORBIDDEN, "Invalid invite code"),
          );
        return;
      }

      // runWithoutTenant: creating a tenant is control-plane work with no
      // ambient tenant of its own, and the registry is not tenant-scoped.
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

      // Audited under the NEW tenant, matching the admin provisioning route.
      //
      // NOT via auditRest: that helper takes the actor from req.user, and a
      // public signup has no authenticated actor at all, so it would silently
      // write nothing. The right actor is the admin this signup just created —
      // resolved in the new tenant's own realm, which is exactly what
      // findByUsernameInRealm exists for now that usernames are per-tenant.
      //
      // Wrapped so a failing audit cannot turn an already-committed signup into
      // a 500, the same reason the admin route routes through auditRest.
      runWithTenant(tenant.id, () => {
        try {
          const admin = getUserRepository().findByUsernameInRealm(
            req.body.adminUsername,
            tenant.id,
          );
          getAuditService().log({
            user_id: admin?.id ?? 0,
            username: req.body.adminUsername,
            role: "admin",
            action: "create",
            entity_type: "tenant",
            entity_id: String(tenant.id),
            summary: `Self-service signup created tenant "${tenant.name}"`,
            new_values: { name: tenant.name, slug: tenant.slug },
            metadata: { self_service: true },
          });
        } catch {
          // Deliberately swallowed — see above.
        }
      });

      logger.info(
        { tenantId: tenant.id, slug: tenant.slug },
        "Tenant created via self-service signup",
      );

      // Give the shop its own subdomain, WITHOUT making it wait.
      //
      // Not awaited: two third-party API calls would add seconds to a
      // form submission, and the response does not depend on them --
      // the tenant is already committed and works on the shared host.
      // provisionTenantDomain never throws, so an unhandled rejection
      // is not possible; `void` says the omission is deliberate.
      void provisionTenantDomain(tenant.slug);

      // No token is issued. The caller is sent to its own subdomain to log in,
      // which is the only place its credentials work once APP_BASE_DOMAIN is
      // set -- and minting a token for a realm the browser is not yet on would
      // contradict that.
      //
      // The URL is built HERE rather than in the page because the base domain
      // is server config: the browser has no way to know whether host-based
      // tenancy is on, and a page that guessed `<slug>.<current host>` would
      // hand out a dead link on liratek.vercel.app or a bare IP. null means
      // "not configured", and the page then shows the slug alone.
      const loginUrl = APP_BASE_DOMAIN
        ? `https://${tenant.slug}.${APP_BASE_DOMAIN}`
        : null;

      res.status(201).json(
        createSuccessResponse({
          tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
          loginUrl,
        }),
      );
    } catch (error) {
      // provisionTenant throws ConflictError for a taken slug or username and
      // ValidationError for a weak password; surface the message so the form
      // can show which field to fix.
      const message = error instanceof Error ? error.message : "Signup failed";
      logger.warn({ error, slug: req.body?.slug }, "Signup failed");
      res
        .status(400)
        .json(createErrorResponse(ErrorCodes.VALIDATION_ERROR, message));
    }
  },
);

export default router;
