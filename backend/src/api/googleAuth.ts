/**
 * Continue with Google + the www -> shop sign-in hand-off (LIRA-280, feature D).
 * Dormant unless GOOGLE_CLIENT_ID (and GOOGLE_CLIENT_SECRET, and a www base
 * URL) are set — see `googleConfig()` in security/googleOAuth.ts.
 *
 * Mounted at `/api/auth/google` (server.ts, before authRoutes). Contract:
 * docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md, "Contracts
 * (foundation, 2026-10-07)", section D. Envelope: `{ success, data?, error?,
 * code? }`; business refusals are HTTP 200 with `success:false` (+ `code`),
 * zod failures 400, missing JWT 401, wrong role / impersonation 403.
 * Authenticated routes: authenticateJWT, THEN requireRole(...), per route —
 * no router-level middleware, because this router also serves public routes.
 *
 * The flow (all of it on the platform host, www):
 *   GET  /start     -> Google (authorization code + PKCE S256; state, nonce
 *                      and the verifier in a signed httpOnly cookie, 10 min)
 *   POST /start     the same, for linking and joining: the link / join
 *                   ticket comes in a form body (never a URL)
 *   GET  /callback  -> verify state, exchange the code, verify the ID token
 *                      (core GoogleAuthService), then by intent:
 *     login   on a shop -> that shop's user (or error=no_account)
 *             one shop  -> https://<slug>.<base>/#/login?sso=<60 s token>
 *             several   -> https://www.<base>/#/auth/google?choose=<ticket>
 *             none      -> https://www.<base>/#/auth/google?error=no_account
 *     signup            -> https://www.<base>/#/signup?google=<ticket>
 *             the Gmail already owns a shop (LIRA-290)
 *                       -> https://www.<base>/#/auth/google?error=email_has_shop
 *     link              -> https://<slug>.<base>/#/account?google=…
 *     join (LIRA-288)   -> user created + linked -> the shop's /#/login?sso=
 *             refused   -> https://<slug>.<base>/#/join?invite=…&google=…
 *   POST /choose        the chooser's pick -> { redirectUrl } (hand-off)
 *   POST /sso-exchange  on the shop's host: hand-off -> the SAME session
 *                       response as /api/auth/login
 *
 * Sign-in matches ONLY by the linked Google `sub` — never by email (owner
 * decision 2026-10-07); accounts are linked from Settings (link/start), a
 * Google sign-up, or "Join with Google" on an invite.
 *
 * ONE GOOGLE ACCOUNT = ONE USER PER SHOP (LIRA-288, owner decision
 * 2026-10-08): linking an account already linked in another shop succeeds;
 * another user of THIS shop holding it is `google=already_linked`. A Google
 * sign-up is open to an account linked in other shops.
 *
 * Where shops come from (LIRA-288):
 *   - login started on a shop's own address (`shop=`): that shop's OWN
 *     records, in its scope — that shop's user, or `error=no_account`;
 *   - login on www: the platform sign-in directory (one shop -> hand-off,
 *     several -> chooser, none -> no_account);
 *   - the chooser's pick: re-checked in the chosen shop's own scope.
 * So the answers are the same whether shops share one file or each has its
 * own, and directory drift can never block sign-in on a shop's address.
 */

import express, { type Request, type Response } from "express";
import {
  GOOGLE_NOT_CONFIGURED,
  GoogleAuthService,
  GoogleTokenError,
  IdentityAlreadyLinkedError,
  LastSigninMethodError,
  createSuccessResponse,
  generateToken,
  getAuditService,
  getGoogleAuthService,
  getTenantRepository,
  getUserInvitationService,
  googleChooseSchema,
  googleStartFormSchema,
  googleStartQuerySchema,
  runWithTenant,
  runWithoutTenant,
  safeEqual,
  ssoExchangeSchema,
  type GoogleAuthErrorCode,
  type GoogleIdentityClaims,
  type JoinWithGoogleResult,
  type TenantEntity,
  EmailTakenInShopError,
  JoinGoogleEmailMismatchError,
  UserInviteShopInactiveError,
  UsernameTakenError,
} from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { clientIp } from "../middleware/clientIp.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import {
  isHostTenancyActive,
  resolveTenantHost,
} from "../middleware/tenantHost.js";
import { isPerTenantDbMode } from "../database/tenantDbMode.js";
import { resolveShopLinkBaseUrl } from "../email/emailConfig.js";
import {
  GOOGLE_START_PATH,
  clearStateCookie,
  googleConfig,
  readChooseTicket,
  readJoinTicket,
  readLinkTicket,
  readStateCookie,
  readStateTicket,
  setStateCookie,
  signTicket,
  verifyTicket,
  type ChooseShop,
  type GoogleConfig,
  type GoogleIntent,
  type JoinTicket,
  type StateTicket,
} from "../security/googleOAuth.js";
import { sendWebLoginResponse } from "../services/webLoginSession.js";
import { googleEmailOwnsShop, isGoogleSignupCapReached } from "./googleSignup.js";
import { logger } from "../server.js";

const router = express.Router();

/** Every tenant role may connect their OWN account. */
const TENANT_ROLES = ["admin", "staff"];

const NOT_CONFIGURED_MESSAGE = "Google sign-in is not available.";
const SSO_INVALID_MESSAGE =
  "This sign-in link is not valid. Please sign in again.";
const CHOOSE_INVALID_MESSAGE =
  "This Google sign-in has expired. Please continue with Google again.";

/** Contract refusal: HTTP 200, `success:false`, a plain message, a code. */
function refuse(res: Response, code: string, message: string): void {
  res.json({ success: false, error: message, code });
}

function refuseNotConfigured(res: Response): void {
  refuse(res, GOOGLE_NOT_CONFIGURED, NOT_CONFIGURED_MESSAGE);
}

/** `${origin}/#/${page}?${params}` — every browser landing is a hash route. */
function pageUrl(
  origin: string,
  page: string,
  params: Record<string, string>,
): string {
  return `${origin}/#/${page}?${new URLSearchParams(params).toString()}`;
}

/** A www landing for an error; relative when no www origin is configured. */
function errorUrl(
  config: GoogleConfig | null,
  error: GoogleAuthErrorCode,
): string {
  return pageUrl(config?.platformBaseUrl ?? "", "auth/google", { error });
}

/** Only the platform host (or a deployment with host tenancy off) runs the
 * Google flow; a shop subdomain is not a registered origin. */
function isPlatformHost(req: Request): boolean {
  const realm = resolveTenantHost(req);
  return !isHostTenancyActive(realm) || realm.kind === "platform";
}

function activeTenant(tenantId: number): TenantEntity | null {
  const tenant = runWithoutTenant(() =>
    getTenantRepository().getById(tenantId),
  );
  return tenant && tenant.status === "active" ? tenant : null;
}

function activeTenantBySlug(slug: string): TenantEntity | null {
  const tenant = runWithoutTenant(() => getTenantRepository().getBySlug(slug));
  return tenant && tenant.status === "active" ? tenant : null;
}

// ── GET /status ──────────────────────────────────────────────────────────

router.get("/status", (req, res): void => {
  const config = googleConfig();
  const realm = resolveTenantHost(req);
  res.json(
    createSuccessResponse({
      enabled: config !== null,
      // Additive to the contract's `{ enabled }`: a shop subdomain cannot
      // know the www origin, and the button must navigate there; `shop` is
      // this host's shop (public by construction — it is the subdomain), so
      // a sign-in started here comes back here when the account has several.
      startUrl: config ? `${config.platformBaseUrl}${GOOGLE_START_PATH}` : null,
      shop: config && realm.kind === "tenant" ? realm.tenant.slug : null,
      // No separate sign-up switch (owner decision 2026-10-07): creating a
      // shop with Google is open whenever Google is configured, inside the
      // one public sign-up daily cap.
    }),
  );
});

// ── GET /start (login, sign-up) and POST /start (link, from Settings) ────

/** Sets the signed state cookie and sends the browser to Google. */
function beginGoogleFlow(
  req: Request,
  res: Response,
  config: GoogleConfig,
  input: {
    intent: GoogleIntent;
    shop?: string;
    link?: { userId: number; tenantId: number };
    join?: JoinTicket;
  },
): void {
  const { verifier, challenge } = GoogleAuthService.createPkcePair();
  const state: Omit<StateTicket, "join"> = {
    state: generateToken(),
    verifier,
    nonce: generateToken(),
    intent: input.intent,
    ...(input.shop ? { shop: input.shop } : {}),
    ...(input.link
      ? { linkUserId: input.link.userId, linkTenantId: input.link.tenantId }
      : {}),
  };
  // The join fields travel flat in the signed, httpOnly state cookie
  // (readStateTicket reads them back into `join`).
  const payload = input.join
    ? {
        ...state,
        joinToken: input.join.token,
        joinUsername: input.join.username,
        joinTenantId: input.join.tenantId,
      }
    : state;
  setStateCookie(req, res, signTicket("state", payload));
  res.redirect(
    302,
    getGoogleAuthService().buildAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state: state.state,
      nonce: state.nonce,
      codeChallenge: challenge,
    }),
  );
}

router.get("/start", (req, res): void => {
  const config = googleConfig();
  if (!config) {
    res.redirect(302, errorUrl(null, "not_configured"));
    return;
  }
  // Started on a shop subdomain: hop to the www start with the same query,
  // so the state cookie lands on the host the callback will read it from.
  if (!isPlatformHost(req)) {
    const at = req.originalUrl.indexOf("?");
    const query = at >= 0 ? req.originalUrl.slice(at) : "";
    res.redirect(302, `${config.platformBaseUrl}${GOOGLE_START_PATH}${query}`);
    return;
  }
  // safeParse by hand: validateRequest reads the body only.
  const parsed = googleStartQuerySchema.safeParse(req.query);
  // Linking and joining are POST-only: their ticket must never sit in a URL
  // (access logs, history), where anyone holding it could attach THEIR
  // Google account (link) or join with the invite (join).
  if (
    !parsed.success ||
    parsed.data.intent === "link" ||
    parsed.data.intent === "join"
  ) {
    res.redirect(302, errorUrl(config, "expired"));
    return;
  }
  beginGoogleFlow(req, res, config, {
    intent: parsed.data.intent,
    ...(parsed.data.shop ? { shop: parsed.data.shop } : {}),
  });
});

router.post("/start", (req, res): void => {
  const config = googleConfig();
  if (!config) {
    res.redirect(302, errorUrl(null, "not_configured"));
    return;
  }
  // 307 keeps the method and the form body on the hop to www.
  if (!isPlatformHost(req)) {
    res.redirect(307, `${config.platformBaseUrl}${GOOGLE_START_PATH}`);
    return;
  }
  const parsed = googleStartFormSchema.safeParse(req.body);
  if (!parsed.success) {
    res.redirect(302, errorUrl(config, "failed"));
    return;
  }
  const { intent, shop, ticket } = parsed.data;
  const link =
    intent === "link" ? readLinkTicket(verifyTicket("link", ticket)) : null;
  const join =
    intent === "join" ? readJoinTicket(verifyTicket("join", ticket)) : null;
  if ((intent === "link" && !link) || (intent === "join" && !join)) {
    res.redirect(302, errorUrl(config, "expired"));
    return;
  }
  beginGoogleFlow(req, res, config, {
    intent,
    ...(shop ? { shop } : {}),
    ...(link ? { link } : {}),
    ...(join ? { join } : {}),
  });
});

// ── GET /callback ────────────────────────────────────────────────────────

type LinkResult = "linked" | "already_linked" | "error" | "cancelled";

/** Where the browser goes when a LINK attempt ends: the shop's "My account"
 * page, which hosts the Google panel and which every role can open
 * (LIRA-291; Settings is admin-only). */
function linkResultUrl(
  config: GoogleConfig,
  tenantId: number | undefined,
  result: LinkResult,
): string {
  const tenant = tenantId !== undefined ? activeTenant(tenantId) : null;
  const origin = tenant ? resolveShopLinkBaseUrl(tenant.slug) : null;
  if (!origin) return errorUrl(config, "failed");
  return pageUrl(origin, "account", { google: result });
}

/** Mints the 60-second hand-off and builds the shop's `/#/login?sso=`. */
function handoffUrl(
  target: { tenantId: number; slug: string; userId: number },
  now: string,
): string | null {
  const origin = resolveShopLinkBaseUrl(target.slug);
  if (!origin) return null;
  const token = runWithoutTenant(() =>
    getGoogleAuthService().createHandoff({
      userId: target.userId,
      tenantId: target.tenantId,
      now,
    }),
  );
  return pageUrl(origin, "login", { sso: token });
}

function signInRedirect(
  config: GoogleConfig,
  claims: GoogleIdentityClaims,
  preferredShop: string | undefined,
  now: string,
): string {
  const service = getGoogleAuthService();

  // Started from a shop's own login page (FR-004): THAT shop's user, read
  // from the shop's own records in its own scope, or a refusal — never
  // another shop, and never the www directory.
  if (preferredShop) {
    const tenant = activeTenantBySlug(preferredShop);
    const match = tenant
      ? runWithTenant(tenant.id, () =>
          service.findMatchInTenant(claims.sub, tenant.id),
        )
      : null;
    if (!tenant || !match) return errorUrl(config, "no_account");
    return (
      handoffUrl(
        { tenantId: tenant.id, slug: tenant.slug, userId: match.user_id },
        now,
      ) ?? errorUrl(config, "failed")
    );
  }

  // On www: every active shop the sign-in directory lists for this account.
  const shops: Array<ChooseShop & { userId: number }> = [];
  for (const match of runWithoutTenant(() =>
    service.findSignInMatches(claims.sub),
  )) {
    const tenant = activeTenant(match.tenant_id);
    if (tenant) {
      shops.push({
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        userId: match.user_id,
      });
    }
  }
  if (shops.length === 0) return errorUrl(config, "no_account");
  if (shops.length === 1) {
    return handoffUrl(shops[0]!, now) ?? errorUrl(config, "failed");
  }

  const ticket = signTicket("choose", {
    sub: claims.sub,
    shops: shops.map(({ tenantId, name, slug }) => ({ tenantId, name, slug })),
  });
  return pageUrl(config.platformBaseUrl, "auth/google", { choose: ticket });
}

function linkIdentity(
  config: GoogleConfig,
  state: StateTicket,
  claims: GoogleIdentityClaims,
  now: string,
): string {
  const userId = state.linkUserId;
  const tenantId = state.linkTenantId;
  if (
    userId === undefined ||
    tenantId === undefined ||
    !activeTenant(tenantId)
  ) {
    return errorUrl(config, "failed");
  }
  try {
    runWithTenant(tenantId, () => {
      getGoogleAuthService().linkIdentity({
        userId,
        subject: claims.sub,
        email: claims.email,
        now,
      });
      try {
        getAuditService().log({
          user_id: userId,
          username: `user-${userId}`,
          role: "user",
          action: "google_link",
          entity_type: "user",
          entity_id: String(userId),
          summary: "Connected a Google account for sign-in",
          metadata: { google_email: claims.email },
        });
      } catch {
        // never blocks the link
      }
    });
    return linkResultUrl(config, tenantId, "linked");
  } catch (error) {
    if (error instanceof IdentityAlreadyLinkedError) {
      return linkResultUrl(config, tenantId, "already_linked");
    }
    logger.error({ error, tenantId }, "Google link failed");
    return linkResultUrl(config, tenantId, "error");
  }
}

/** Where the browser goes when "Join with Google" did not join (LIRA-288):
 * back to the invite page on the shop's address, with the invite and the
 * reason. The invite stays usable unless it is `invite_invalid`. */
function joinResultUrl(
  config: GoogleConfig,
  join: JoinTicket | undefined,
  result: JoinWithGoogleResult,
): string {
  const tenant = join
    ? runWithoutTenant(() => getTenantRepository().getById(join.tenantId))
    : null;
  const origin = tenant ? resolveShopLinkBaseUrl(tenant.slug) : null;
  if (!join || !origin) return errorUrl(config, "failed");
  return pageUrl(origin, "join", { invite: join.token, google: result });
}

/** The refusal each core error means on the join page. */
function joinRefusal(error: unknown): JoinWithGoogleResult {
  if (error instanceof JoinGoogleEmailMismatchError) return "email_mismatch";
  if (error instanceof IdentityAlreadyLinkedError) return "already_linked";
  if (error instanceof UsernameTakenError) return "username_taken";
  if (error instanceof UserInviteShopInactiveError) return "shop_not_active";
  if (error instanceof EmailTakenInShopError) return "email_taken";
  return "error";
}

/**
 * "Join with Google" (LIRA-288): create the invited user AND link this
 * Google account in the invite's shop (core `acceptWithGoogle`, in that
 * shop's scope), then hand off into the shop signed in.
 */
function joinWithGoogle(
  config: GoogleConfig,
  state: StateTicket,
  claims: GoogleIdentityClaims,
  now: string,
): string {
  const join = state.join;
  if (!join) return errorUrl(config, "failed");
  try {
    const outcome = runWithTenant(join.tenantId, () =>
      getUserInvitationService().acceptWithGoogle({
        token: join.token,
        username: join.username,
        // verifyIdToken refuses anything but email_verified === true.
        google: { sub: claims.sub, email: claims.email, emailVerified: true },
        now,
        requiredTenantId: join.tenantId,
      }),
    );
    if (!outcome.ok) return joinResultUrl(config, join, "invite_invalid");

    // Public flow, so no req.user: the actor is the user just created,
    // audited in their own shop (as POST /api/user-invitations/accept).
    runWithTenant(outcome.shop.id, () => {
      try {
        getAuditService().log({
          user_id: outcome.user.id,
          username: outcome.user.username,
          role: outcome.user.role,
          action: "create",
          entity_type: "user",
          entity_id: String(outcome.user.id),
          summary: `Joined by email invite with Google as ${outcome.user.role}`,
          new_values: {
            username: outcome.user.username,
            role: outcome.user.role,
            email: outcome.invite.email,
          },
          metadata: { via: "invite_google", invitation_id: outcome.invite.id },
        });
      } catch {
        // A failing audit never turns a committed join into an error.
      }
    });

    return (
      handoffUrl(
        {
          tenantId: outcome.shop.id,
          slug: outcome.shop.slug,
          userId: outcome.user.id,
        },
        now,
      ) ?? errorUrl(config, "failed")
    );
  } catch (error) {
    const result = joinRefusal(error);
    if (result === "error") {
      logger.error({ error, tenantId: join.tenantId }, "Join with Google failed");
    }
    return joinResultUrl(config, join, result);
  }
}

router.get("/callback", async (req, res): Promise<void> => {
  const config = googleConfig();
  const stateCookie = readStateCookie(req);
  // Cleared on EVERY outcome: a state is single-use.
  clearStateCookie(req, res);
  if (!config) {
    res.redirect(302, errorUrl(null, "not_configured"));
    return;
  }

  const state = readStateTicket(verifyTicket("state", stateCookie));
  if (!state) {
    res.redirect(302, errorUrl(config, "expired"));
    return;
  }
  const query = req.query as Record<string, unknown>;
  if (typeof query.error === "string") {
    res.redirect(
      302,
      state.intent === "link"
        ? linkResultUrl(config, state.linkTenantId, "cancelled")
        : state.intent === "join"
          ? joinResultUrl(config, state.join, "cancelled")
          : errorUrl(config, "cancelled"),
    );
    return;
  }
  const code = typeof query.code === "string" ? query.code : "";
  const returnedState = typeof query.state === "string" ? query.state : "";
  if (!code || !safeEqual(returnedState, state.state)) {
    logger.warn(
      { intent: state.intent },
      "Google callback: state mismatch or no code",
    );
    res.redirect(302, errorUrl(config, "failed"));
    return;
  }

  let claims: GoogleIdentityClaims;
  try {
    claims = await getGoogleAuthService().exchangeCodeForClaims({
      code,
      codeVerifier: state.verifier,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      nonce: state.nonce,
      nowMs: Date.now(),
    });
  } catch (error) {
    logger.warn(
      {
        reason: error instanceof GoogleTokenError ? error.reason : "unexpected",
        error,
      },
      "Google callback: ID token refused",
    );
    res.redirect(
      302,
      state.intent === "link"
        ? linkResultUrl(config, state.linkTenantId, "error")
        : state.intent === "join"
          ? joinResultUrl(config, state.join, "error")
          : errorUrl(config, "failed"),
    );
    return;
  }

  const now = new Date().toISOString();
  try {
    switch (state.intent) {
      case "login":
        res.redirect(302, signInRedirect(config, claims, state.shop, now));
        return;
      case "signup": {
        // The one public sign-up daily cap (email requests + Google
        // sign-ups). Checked here so nobody fills in the form for nothing;
        // the authoritative check is when the shop is created.
        if (isGoogleSignupCapReached(now)) {
          res.redirect(302, errorUrl(config, "signup_limit"));
          return;
        }
        // One shop per OWNER email (LIRA-290): told here, before the form,
        // so nobody fills it in for nothing. Re-checked when the shop is
        // created. The shop is never named.
        if (googleEmailOwnsShop(claims.email)) {
          res.redirect(302, errorUrl(config, "email_has_shop"));
          return;
        }
        // The instant Google confirmed the address is what the new admin's
        // email_verified_at records.
        const ticket = signTicket("signup", {
          sub: claims.sub,
          email: claims.email,
          verifiedAt: now,
        });
        res.redirect(
          302,
          pageUrl(config.platformBaseUrl, "signup", { google: ticket }),
        );
        return;
      }
      case "link":
        res.redirect(302, linkIdentity(config, state, claims, now));
        return;
      case "join":
        res.redirect(302, joinWithGoogle(config, state, claims, now));
        return;
    }
  } catch (error) {
    logger.error({ error, intent: state.intent }, "Google callback failed");
    res.redirect(302, errorUrl(config, "failed"));
  }
});

// ── POST /choose ─────────────────────────────────────────────────────────

router.post(
  "/choose",
  validateRequest(googleChooseSchema),
  (req, res): void => {
    if (!googleConfig()) {
      refuseNotConfigured(res);
      return;
    }
    const ticket = readChooseTicket(verifyTicket("choose", req.body.ticket));
    const tenantId: number = req.body.tenantId;
    const listed = ticket?.shops.find((s) => s.tenantId === tenantId);
    if (!ticket || !listed) {
      refuse(res, "GOOGLE_TICKET_INVALID", CHOOSE_INVALID_MESSAGE);
      return;
    }
    // The ticket is replayable for its 10 minutes, so the link is re-checked
    // against the database rather than trusted from the ticket.
    // In the chosen shop's OWN scope: per-tenant mode keeps its links in
    // its own file.
    const match = runWithTenant(tenantId, () =>
      getGoogleAuthService().findMatchInTenant(ticket.sub, tenantId),
    );
    const tenant = activeTenant(tenantId);
    const redirectUrl =
      match && tenant
        ? handoffUrl(
            { tenantId, slug: tenant.slug, userId: match.user_id },
            new Date().toISOString(),
          )
        : null;
    if (!redirectUrl) {
      refuse(res, "GOOGLE_TICKET_INVALID", CHOOSE_INVALID_MESSAGE);
      return;
    }
    res.json(createSuccessResponse({ redirectUrl }));
  },
);

// ── POST /sso-exchange ───────────────────────────────────────────────────

router.post(
  "/sso-exchange",
  authLimiter,
  validateRequest(ssoExchangeSchema),
  (req, res): void => {
    if (!googleConfig()) {
      refuseNotConfigured(res);
      return;
    }
    try {
      const now = new Date().toISOString();
      // Consumed FIRST (single use): a token presented on the wrong host is
      // burned too, which is the safe direction.
      const handoff = runWithoutTenant(() =>
        getGoogleAuthService().consumeHandoff(req.body.token, now),
      );
      if (!handoff) {
        refuse(res, "SSO_INVALID", SSO_INVALID_MESSAGE);
        return;
      }

      // The token's shop must be the shop this host serves. With host
      // tenancy off (dev, preview) there is no host shop to compare; in
      // per-tenant DB mode that is refused outright, as /login does.
      const realm = resolveTenantHost(req);
      const hostOk = isHostTenancyActive(realm)
        ? realm.kind === "tenant" && realm.tenant.id === handoff.tenantId
        : !isPerTenantDbMode();
      if (!hostOk) {
        logger.warn(
          { tenantId: handoff.tenantId, realm: realm.kind },
          "SSO exchange refused: token presented on another host",
        );
        refuse(res, "SSO_INVALID", SSO_INVALID_MESSAGE);
        return;
      }

      const opened = runWithTenant(handoff.tenantId, () =>
        getGoogleAuthService().openSession({
          userId: handoff.userId,
          tenantId: handoff.tenantId,
          deviceInfo: req.headers["user-agent"] || "Unknown",
          ipAddress: clientIp(req) || req.socket.remoteAddress,
        }),
      );
      if (!opened) {
        refuse(res, "SSO_INVALID", SSO_INVALID_MESSAGE);
        return;
      }

      sendWebLoginResponse(res, opened.user, {
        sessionToken: opened.sessionToken,
        summary: `User "${opened.user.username}" logged in with Google`,
        metadata: { via: "google" },
      });
      logger.info(
        { userId: opened.user.id, tenantId: handoff.tenantId },
        "User logged in with Google (hand-off)",
      );
    } catch (error) {
      logger.error({ error }, "SSO exchange failed");
      refuse(res, "SSO_INVALID", SSO_INVALID_MESSAGE);
    }
  },
);

// ── Link from Settings (own account only) ────────────────────────────────

/** Own-account Google actions: a tenant user, never an impersonation
 * session (a super admin must not attach their Google to a shop admin) and
 * never the platform super admin (out of scope). */
function ownTenantAccount(
  req: Request,
  res: Response,
): { userId: number; tenantId: number } | null {
  const user = req.user;
  if (!user || user.tenantId === null || user.impersonatorId !== undefined) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return null;
  }
  return { userId: user.userId, tenantId: user.tenantId };
}

// GET /link — is MY account connected? Additive to the contract: the
// Settings panel needs it to show Connect vs Disconnect.
router.get(
  "/link",
  authenticateJWT,
  requireRole(TENANT_ROLES),
  (req, res): void => {
    const own = ownTenantAccount(req, res);
    if (!own) return;
    const enabled = googleConfig() !== null;
    const link = getGoogleAuthService().getLinkedEmail(own.userId);
    res.json(createSuccessResponse({ enabled, ...link }));
  },
);

// POST /link/start — the www start URL plus a signed link ticket that names
// the CALLER (never anything from the body). The page POSTs the ticket to
// that URL as a form, so it never appears in a URL. Contract said `{ url }`;
// the ticket moved out of the URL into its own field (security).
router.post(
  "/link/start",
  authenticateJWT,
  requireRole(TENANT_ROLES),
  (req, res): void => {
    const own = ownTenantAccount(req, res);
    if (!own) return;
    const config = googleConfig();
    if (!config) {
      refuseNotConfigured(res);
      return;
    }
    res.json(
      createSuccessResponse({
        url: `${config.platformBaseUrl}${GOOGLE_START_PATH}`,
        ticket: signTicket("link", own),
      }),
    );
  },
);

// DELETE /link — disconnect MY Google account.
//
// LIRA-291: a user who joined with Google has no password, so Google is
// their only way in. Removing it is refused (SET_PASSWORD_FIRST) until they
// set a password (POST /api/password-reset/set-initial). Checked FIRST, so
// the answer is the same whether Google sign-in is on or off. The service
// checks again inside the unlink.
router.delete(
  "/link",
  authenticateJWT,
  requireRole(TENANT_ROLES),
  (req, res): void => {
    const own = ownTenantAccount(req, res);
    if (!own) return;
    let unlinked: boolean;
    try {
      getGoogleAuthService().assertCanUnlink(own.userId);
      if (!googleConfig()) {
        refuseNotConfigured(res);
        return;
      }
      unlinked = getGoogleAuthService().unlinkIdentity(
        own.userId,
        new Date().toISOString(),
      );
    } catch (error) {
      if (error instanceof LastSigninMethodError) {
        refuse(res, error.code, error.message);
        return;
      }
      throw error;
    }
    if (unlinked) {
      auditRest(req, {
        action: "google_unlink",
        entity_type: "user",
        entity_id: String(own.userId),
        summary: "Disconnected the Google account used for sign-in",
      });
    }
    res.json(createSuccessResponse({ unlinked }));
  },
);

export default router;
