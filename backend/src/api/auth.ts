import express from "express";
import {
  getTenantProvisioningService,
  runWithoutTenant,
  signupSchema,
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
  AppError,
  EMAIL_ALREADY_HAS_SHOP,
  EMAIL_ALREADY_HAS_SHOP_MESSAGE,
  SIGNUP_INVITE_INVALID_MESSAGE,
  checkSignupInviteSchema,
  requestSignupLinkSchema,
  getSignupInvitationService,
  hashToken,
  SIGNUP_SELF_SERVE_DAILY_CAP,
  SIGNUP_SELF_SERVE_ENABLED,
  TURNSTILE_SITE_KEY,
  type TenantEntity,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import {
  signupLimiter,
  signupCheckLimiter,
  signupRequestLimiter,
  authLimiter,
} from "../middleware/rateLimit.js";
import { auditRest } from "../middleware/audit.js";
import { provisionTenantDomain } from "../services/tenantDomains.js";
import {
  resolveTenantHost,
  isHostTenancyActive,
  NO_SUCH_REALM,
  type TenantHostResolution,
} from "../middleware/tenantHost.js";
import { authenticateJWT } from "../middleware/auth.js";
import { isPerTenantDbMode } from "../database/tenantDbMode.js";
import { logger } from "../server.js";
import { isEmailConfigured } from "../email/createTransport.js";
import {
  canSendInvites,
  resolveInviteBaseUrl,
  resolveSupportEmail,
  resolveTenantBaseUrl,
} from "../email/emailConfig.js";
import {
  isTurnstileConfigured,
  verifyTurnstile,
} from "../security/turnstile.js";
import { clientIp, resolveClientIp } from "../middleware/clientIp.js";
import jwt from "jsonwebtoken";
// [auth-D] imports: shared web session response + the Google sign-up branch
import {
  accountPictureUrl,
  sendWebLoginResponse,
} from "../services/webLoginSession.js";
import { googleSignupRoute, isGoogleSignupBody } from "./googleSignup.js";

const router = express.Router();

// Validate JWT configuration on startup
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is required. Please set it in your environment variables (min 32 characters).",
  );
}

const jwtSecret: string = JWT_SECRET;

/**
 * Resolve BOTH (a) the realm `authService.login()` should search WITHIN (the
 * LOOKUP realm — since v172 usernames are unique per tenant, not globally)
 * and (b) the database scope the login call itself must run under (plan
 * § 12.1 B-D2) — from the SAME host resolution, in one switch, so the two
 * never drift apart (rule 14: a business predicate defined once).
 *
 * These answer different questions that happen to share one source: (a) is
 * "which tenant_id should the username match", (b) is "which physical
 * connection does `getDatabase()` hand back for every call login() makes"
 * once per-tenant DB routing is live. In `per-tenant` mode they always agree:
 * whichever tenant's users are being searched is also whose file the search
 * must run against — a shop's users only ever exist in that shop's own file.
 *
 * `runInScope`'s generic parameter deliberately allows `Promise<T>`: the
 * caller awaits the returned promise OUTSIDE the synchronous extent of
 * `runWithTenant`/`runWithoutTenant`, exactly the way
 * `middleware/auth.ts`'s `runWithTenant(tenantId, () => next())` already
 * does for the rest of the request — Node's AsyncLocalStorage keeps the
 * store bound to a promise's continuation regardless of where `.then`/
 * `await` is written, not just to the synchronous callback passed to `run`.
 */
function resolveLoginRealmAndScope(realm: TenantHostResolution): {
  /** `undefined` here means "omit `realm` from LoginOptions entirely" —
   * `authService.login` treats an OMITTED realm differently from an
   * explicit `null` (platform) (see `resolveWithoutRealm`). */
  loginRealm: number | null | undefined;
  runInScope: <T>(fn: () => T) => T;
} {
  if (!isHostTenancyActive(realm)) {
    // Host-based tenancy is off (or a foreign/preview host) — no realm can
    // be inferred from the host at all. login() falls back to inferring one
    // from the username itself (resolveWithoutRealm), a control-plane-
    // flavoured cross-tenant search, so it runs with no ambient tenant.
    return { loginRealm: undefined, runInScope: (fn) => runWithoutTenant(fn) };
  }

  switch (realm.kind) {
    case "tenant": {
      const tenantId = realm.tenant.id;
      return {
        loginRealm: tenantId,
        runInScope: (fn) => runWithTenant(tenantId, fn),
      };
    }
    case "platform":
      return { loginRealm: null, runInScope: (fn) => runWithoutTenant(fn) };
    case "unknown":
      // No tenant can match this subdomain, so the lookup is doomed
      // regardless of scope — but NO_SUCH_REALM is not a real tenant id, and
      // routing a per-tenant DB connection to it would throw (pool miss)
      // instead of the clean "no such user" outcome. runWithoutTenant() runs
      // the doomed lookup against the platform file, which always exists.
      return {
        loginRealm: NO_SUCH_REALM,
        runInScope: (fn) => runWithoutTenant(fn),
      };
  }
}

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

      // per-tenant DB mode has no cross-tenant username search to fall back
      // on (each shop's users live in that shop's own file — there is no
      // single table to search "every tenant" against). Without a realm the
      // host resolved, refuse up front rather than let login() run
      // resolveWithoutRealm() against whichever file happens to be ambient.
      // Same generic error and no earlier branching than the realm check
      // below already uses, so this adds no new way to probe a username.
      if (isPerTenantDbMode() && !isHostTenancyActive(realm)) {
        logger.warn(
          { username },
          "Login refused: no realm resolved from the host and per-tenant DB mode is active",
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

      const { loginRealm, runInScope } = resolveLoginRealmAndScope(realm);
      const realmScope: { realm?: number | null } =
        loginRealm === undefined ? {} : { realm: loginRealm };

      const result = await runInScope(() =>
        authService.login(username, password, {
          ...realmScope,
          rememberMe: rememberMe || false,
          deviceType: "web",
          deviceInfo: req.headers["user-agent"] || "Unknown",
          ipAddress: clientIp(req) || req.socket.remoteAddress,
        }),
      );

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
          // attempt leaves a usable session row behind. Same DB scope as the
          // login call that created it (per-tenant mode: the session row
          // lives in that same tenant's file).
          const sessionToken = result.token;
          try {
            await runInScope(() => authService.logout(sessionToken));
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

      // [auth-D] JWT + login audit + envelope now live in ONE helper shared
      // with the Google hand-off exchange (LIRA-280), so both hand out the
      // same session shape. Extracted verbatim from here.
      sendWebLoginResponse(res, user, {
        sessionToken: result.token,
        summary: `User "${username}" logged in`,
      });

      logger.info(
        { userId: user.id, username: user.username, rememberMe },
        "User logged in with database session",
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
        // LIRA-294: the account photo (Google link), for the top bar.
        pictureUrl: accountPictureUrl(req.user.tenantId, req.user.userId),
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
          const sessionToken = decoded.sessionToken;
          // Scoped by the JWT's OWN tenantId claim (same rule as
          // authenticateJWT's validateSession scoping, B-D1): the session
          // row this deletes lives in that tenant's own file. `undefined`
          // (a pre-tenantId-claim legacy token) is treated the same as
          // `null` — there is no tenant to route to, so it falls back to the
          // platform file, same as a real platform (super_admin) logout.
          const sessionTenantId = decoded.tenantId ?? null;
          if (sessionTenantId === null) {
            await runWithoutTenant(() => authService.logout(sessionToken));
          } else {
            await runWithTenant(sessionTenantId, () =>
              authService.logout(sessionToken),
            );
          }
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
//   selfServeEnabled  can a visitor ask for a sign-up link by email? The page
//                 shows "Sign up" only then, so it never advertises a door
//                 that is bolted. (LIRA-267 Stage B removed the old `enabled`
//                 key, which meant "the shared invite code is set": a
//                 lingering `true` would make a cached older page offer a code
//                 form that no longer works. Absent reads as false there.)
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
  const selfServeEnabled = isSelfServeAvailable();

  res.json(
    createSuccessResponse({
      // LIRA-267: can the platform email invite links at all? A boolean
      // only, never which transport.
      emailInvitesEnabled: isEmailConfigured(),
      // Can a visitor ask for a sign-up link by email? LIRA-278: the
      // SIGNUP_SELF_SERVE_ENABLED switch plus working email. The Turnstile
      // site key is public (embedded in the page by design) and only sent
      // when the form can be used AND Turnstile is configured — then the
      // page shows the check; otherwise the form has no check at all.
      selfServeEnabled,
      turnstileSiteKey:
        selfServeEnabled && isTurnstileConfigured()
          ? (TURNSTILE_SITE_KEY ?? null)
          : null,
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

// POST /api/auth/signup/invite/check — is this invite link usable? (PUBLIC)
//
// LIRA-267. The sign-up page calls it on load to show the invited email
// (locked) and the shop-name hint. The token travels in the BODY, never the
// path, so it stays out of access logs. Every unusable link — unknown,
// expired, used, revoked, or claimed by a sign-up in progress — gets the
// SAME 200 + success:false answer (FR-009), so the response says nothing
// about why. Has its OWN limiter (signupCheckLimiter, 30/hour/IP): loading
// the sign-up page must not use up the /signup budget.
router.post(
  "/signup/invite/check",
  signupCheckLimiter,
  validateRequest(checkSignupInviteSchema),
  (req, res): void => {
    try {
      const invite = runWithoutTenant(() =>
        getSignupInvitationService().check(
          req.body.token,
          new Date().toISOString(),
        ),
      );
      if (!invite) {
        res.json(
          createErrorResponse(
            ErrorCodes.FORBIDDEN,
            SIGNUP_INVITE_INVALID_MESSAGE,
          ),
        );
        return;
      }
      res.json(createSuccessResponse(invite));
    } catch (error) {
      logger.error({ error }, "Sign-up invite check failed");
      res.json(
        createErrorResponse(
          ErrorCodes.FORBIDDEN,
          SIGNUP_INVITE_INVALID_MESSAGE,
        ),
      );
    }
  },
);

// POST /api/auth/signup/request — "email me a sign-up link" (PUBLIC, US4)
//
// contracts/api.md + LIRA-278. Order: per-IP limiter (5/hour, 429, keyed on
// CLIENT_IP_HEADER when set) -> schema -> self-serve available (switch +
// email)? -> Turnstile ONLY when its keys are configured (fails closed) ->
// bot checks (honeypot, too fast) ->
// requestSelfServe. Past the refusals, the answer is IDENTICAL whether the
// link was sent, a bot check tripped, the per-email limit was hit or the
// daily cap was reached (FR-028), so the form cannot tell which check a bot
// failed. ONE exception (owner decision 2026-10-08, LIRA-290): an address
// that already owns a shop is told so on the page — 200 success:false
// EMAIL_ALREADY_HAS_SHOP, the shop never named, nothing emailed. Bots still
// get the generic reply (their check runs first), and the per-IP limiter
// still caps how many addresses one visitor can test. The address is logged only as hashToken(email). No audit
// row: there is no tenant and no actor.
const SELF_SERVE_NOT_AVAILABLE = "Sign-up is not available right now.";
const SELF_SERVE_TURNSTILE_REJECTED =
  "Please complete the check and try again.";
const SELF_SERVE_TRY_LATER = "Please try again in a few minutes.";
const SELF_SERVE_GENERIC_MESSAGE =
  "If this address can be used, we've emailed a link.";

/** A person needs at least this long to type an email (LIRA-278). Measured
 * by the BROWSER on its own clock (render -> submit), never against the
 * server clock (rule 27). */
const SELF_SERVE_MIN_FORM_MS = 3_000;

/** The ONE definition of "a visitor can ask for a sign-up link" (rule 14),
 * shared by signup-status and the request route: the owner switched it on
 * (SIGNUP_SELF_SERVE_ENABLED) and invite links can be sent (transport + base
 * URL). Turnstile is an optional extra layer, not a requirement (LIRA-278). */
function isSelfServeAvailable(): boolean {
  return canSendInvites() && SIGNUP_SELF_SERVE_ENABLED;
}

/** Why a request looks automated, or null. A filled honeypot (`website`, a
 * field people never see) or a form sent in under 3 seconds. An absent
 * `formElapsedMs` skips the timing check (contract A). */
function selfServeBotReason(body: {
  website?: string;
  formElapsedMs?: number;
}): "honeypot" | "too_fast" | null {
  if (body.website && body.website.trim().length > 0) return "honeypot";
  if (
    typeof body.formElapsedMs === "number" &&
    body.formElapsedMs < SELF_SERVE_MIN_FORM_MS
  ) {
    return "too_fast";
  }
  return null;
}

/** Rule 19c envelope: HTTP 200, plain-string error. */
function selfServeRefusal(res: express.Response, message: string): void {
  res.json({ success: false, error: message });
}

router.post(
  "/signup/request",
  signupRequestLimiter,
  validateRequest(requestSignupLinkSchema),
  async (req, res): Promise<void> => {
    const email: string = req.body.email;
    const emailHash = hashToken(email);
    try {
      const baseUrl = resolveInviteBaseUrl();
      if (!isSelfServeAvailable() || !baseUrl) {
        selfServeRefusal(res, SELF_SERVE_NOT_AVAILABLE);
        return;
      }

      // Turnstile is an optional extra layer (LIRA-278): checked only when
      // its keys are configured. Then a missing token is refused up front,
      // fail closed, without asking Cloudflare about "undefined".
      if (isTurnstileConfigured()) {
        const token: string | undefined = req.body.turnstileToken;
        if (!token) {
          logger.info({ emailHash }, "Self-serve sign-up: no Turnstile token");
          selfServeRefusal(res, SELF_SERVE_TURNSTILE_REJECTED);
          return;
        }
        const verdict = await verifyTurnstile(token, resolveClientIp(req));
        if (verdict !== "passed") {
          logger.info(
            { emailHash, verdict },
            "Self-serve sign-up: Turnstile not passed",
          );
          selfServeRefusal(
            res,
            verdict === "rejected"
              ? SELF_SERVE_TURNSTILE_REJECTED
              : SELF_SERVE_TRY_LATER,
          );
          return;
        }
      }

      // Bot checks answer with the normal success reply and send nothing:
      // a refusal would tell the bot which check it tripped.
      const botReason = selfServeBotReason(req.body);
      if (botReason) {
        logger.info(
          { emailHash, queued: false, reason: botReason },
          "Self-serve sign-up request dropped as automated",
        );
        res.json(
          createSuccessResponse({ message: SELF_SERVE_GENERIC_MESSAGE }),
        );
        return;
      }

      const outcome = runWithoutTenant(() =>
        getSignupInvitationService().requestSelfServe({
          email,
          // Stored on the invite to prefill the form behind the link; the
          // service keeps it out of the email (LIRA-278).
          shopNameHint: req.body.shopNameHint ?? null,
          now: new Date().toISOString(),
          baseUrl,
          supportEmail: resolveSupportEmail(),
          emailConfigured: isEmailConfigured(),
          dailyCap: SIGNUP_SELF_SERVE_DAILY_CAP,
        }),
      );
      logger.info(
        { emailHash, queued: outcome.queued, reason: outcome.reason },
        "Self-serve sign-up request handled",
      );
      if (outcome.reason === "has_shop") {
        res.json({
          success: false,
          code: EMAIL_ALREADY_HAS_SHOP,
          error: EMAIL_ALREADY_HAS_SHOP_MESSAGE,
        });
        return;
      }
      res.json(createSuccessResponse({ message: SELF_SERVE_GENERIC_MESSAGE }));
    } catch (error) {
      logger.error({ error, emailHash }, "Self-serve sign-up request failed");
      selfServeRefusal(res, SELF_SERVE_TRY_LATER);
    }
  },
);

/** The provisionTenant input a sign-up passes on. Fields are listed
 * explicitly so nothing else in the body (inviteToken, or any stray key)
 * leaks into provisioning. */
function signupProvisionFields(body: {
  name: string;
  slug: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  adminUsername: string;
  adminPassword: string;
}) {
  return {
    name: body.name,
    slug: body.slug,
    contactName: body.contactName,
    contactPhone: body.contactPhone,
    notes: body.notes,
    adminUsername: body.adminUsername,
    adminPassword: body.adminPassword,
  };
}

// POST /api/auth/signup — self-service tenant creation (PUBLIC, no token)
//
// Feeds the SAME TenantProvisioningService.provisionTenant() a super admin
// uses, so a self-served tenant is indistinguishable from a hand-made one:
// registry row, full per-tenant config seed and first admin user, in one
// transaction. No logic lives here.
//
// The ONLY proof of invitation is `inviteToken` (LIRA-267 Stage B), a
// single-use emailed link: claimed, then the shop is provisioned with the
// INVITE's email as its contact email, then the invite is marked used — or
// released if provisioning fails (SignupInvitationService.consume). The
// shared SIGNUP_INVITE_CODE is gone; signupSchema requires the token and
// strips any `inviteCode` a stale client still sends.
//
// signupLimiter counts SUCCESSES, not just failures (unlike the login
// limiter), because each success permanently consumes a unique slug. The
// slug charset and reserved-name blocklist are the same ones that guard
// staff-created tenants -- signupSchema extends createTenantSchema rather
// than restating the rules.
// [auth-D] POST /api/auth/signup with `googleTicket` instead of `inviteToken`
// (LIRA-280). Registered BEFORE the invite route: a body without a
// googleTicket skips to it via next("route") before the limiter runs, so no
// request is counted twice and the invite route is untouched.
router.post(
  "/signup",
  (req, _res, next) => (isGoogleSignupBody(req.body) ? next() : next("route")),
  signupLimiter,
  ...googleSignupRoute,
);

router.post(
  "/signup",
  signupLimiter,
  validateRequest(signupSchema),
  (req, res): void => {
    try {
      const now = new Date().toISOString();
      const outcome = runWithoutTenant(() =>
        getSignupInvitationService().consume(
          req.body.inviteToken,
          now,
          // The contact email comes from the invite row ONLY. signupSchema
          // already strips a body contactEmail; this never reads one.
          // Opening the emailed link proved the address, so the first admin
          // is linked to it VERIFIED (v196, owner decision 2026-10-07).
          (invite) =>
            getTenantProvisioningService().provisionTenant({
              ...signupProvisionFields(req.body),
              contactEmail: invite.email,
              contactEmailVerifiedAt: now,
            }),
        ),
      );
      if (!outcome.ok) {
        logger.warn(
          { slug: req.body.slug },
          "Signup rejected: unusable invite link",
        );
        res
          .status(403)
          .json(
            createErrorResponse(
              ErrorCodes.FORBIDDEN,
              SIGNUP_INVITE_INVALID_MESSAGE,
            ),
          );
        return;
      }
      const tenant: TenantEntity = outcome.result;
      const invitationId = outcome.invite.id;
      const via = "invite_link";

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
            metadata: {
              self_service: true,
              via,
              invitation_id: invitationId,
            },
          });
        } catch {
          // Deliberately swallowed — see above.
        }
      });

      logger.info(
        { tenantId: tenant.id, slug: tenant.slug, via },
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
      const loginUrl = resolveTenantBaseUrl(tenant.slug);

      res.status(201).json(
        createSuccessResponse({
          tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
          loginUrl,
        }),
      );
    } catch (error) {
      // The invite's email belongs to a shop already (a race past the admin
      // check, caught by the unique index). The invite was released.
      if (error instanceof AppError && error.code === EMAIL_ALREADY_HAS_SHOP) {
        logger.warn(
          { slug: req.body?.slug },
          "Signup refused: email has a shop",
        );
        res
          .status(400)
          .json(
            createErrorResponse(
              EMAIL_ALREADY_HAS_SHOP,
              "This email already has a shop.",
            ),
          );
        return;
      }
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
