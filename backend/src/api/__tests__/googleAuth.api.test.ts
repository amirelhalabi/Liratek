/**
 * Continue with Google (LIRA-280) — the REST routes at /api/auth/google and
 * the `googleTicket` branch of POST /api/auth/signup.
 *
 * Route wiring only: GoogleAuthService is a stub here. Its own behaviour —
 * the ID-token checks (signature against a JWKS, iss, aud, exp, nonce,
 * email_verified), hand-off single use and expiry, identity links and the
 * session gates — is proven against a real database and a generated RSA key
 * in core's GoogleAuthService.test.ts. No request ever leaves the process.
 *
 * What these guard: dormancy (nothing works while GOOGLE_CLIENT_ID is
 * unset), state + PKCE binding, www-only start, the three sign-in outcomes,
 * the hand-off's shop check, the sign-up ticket (password still required),
 * and link/unlink acting only on the caller's own account.
 */

import crypto from "node:crypto";
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../middleware/rateLimit.js", () => ({
  authLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  signupLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  signupCheckLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  signupRequestLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  apiLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
}));

jest.mock("../../services/tenantDomains.js", () => ({
  provisionTenantDomain: async () => undefined,
}));

interface TestRequest {
  headers: Record<string, string | undefined>;
  user?: Record<string, unknown>;
}
type Next = () => void;
interface TestResponse {
  status(code: number): { json(body: unknown): void };
}

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: TestRequest, res: TestResponse, next: Next) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    const impersonator = req.headers["x-test-impersonator"];
    req.user = {
      userId: 42,
      username: "tester",
      role,
      tenantId: role === "super_admin" ? null : 2,
      sessionToken: "test-session",
      ...(impersonator ? { impersonatorId: Number(impersonator) } : {}),
    };
    next();
  };
  const requireRole =
    (roles: string[]) => (req: TestRequest, res: TestResponse, next: Next) => {
      if (!req.user) {
        res.status(401).json({ success: false, error: "Not authenticated" });
        return;
      }
      if (!roles.includes(String(req.user.role))) {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }
      next();
    };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

let clientId: string | undefined;
let clientSecret: string | undefined;
let baseDomain: string | undefined;
let selfServe = false;

const svc = {
  buildAuthorizationUrl: jest.fn((input: Record<string, string>) => {
    const p = new URLSearchParams({
      client_id: input.clientId!,
      redirect_uri: input.redirectUri!,
      state: input.state!,
      nonce: input.nonce!,
      code_challenge: input.codeChallenge!,
      code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }),
  exchangeCodeForClaims: jest.fn<
    (input: Record<string, unknown>) => Promise<{ sub: string; email: string; picture?: string | null }>
  >(),
  findSignInMatches: jest.fn<(sub: string) => Array<Record<string, unknown>>>(),
  findMatchInTenant: jest.fn<(sub: string, tenantId: number) => Record<string, unknown> | null>(),
  createHandoff: jest.fn<(input: Record<string, unknown>) => string>(),
  consumeHandoff: jest.fn<(token: string, now: string) => { userId: number; tenantId: number } | null>(),
  openSession: jest.fn<(input: Record<string, unknown>) => unknown>(),
  linkIdentity: jest.fn<(input: Record<string, unknown>) => void>(),
  unlinkIdentity: jest.fn<(userId: number) => boolean>(),
  assertCanUnlink: jest.fn<(userId: number) => void>(),
  getLinkedEmail: jest.fn<
    (userId: number) => {
      linked: boolean;
      email: string | null;
      hasPassword: boolean;
      pictureUrl?: string | null;
    }
  >(),
  // LIRA-294: the account photo, refreshed on every Google sign-in.
  refreshPicture: jest.fn<(sub: string, picture: string | null, now: string) => void>(),
  getPictureUrl: jest.fn<(userId: number) => string | null>(),
};

/** Which scope the route was in when a service method ran: a shop id
 * (runWithTenant), "platform" (runWithoutTenant) or null (none). LIRA-288:
 * the explicit-shop Google lookups must run in THAT shop's scope, or
 * per-tenant mode reads the platform file and finds nobody. */
let scope: number | "platform" | null = null;
function inScope<T>(next: number | "platform", fn: () => T): T {
  const outer = scope;
  scope = next;
  try {
    return fn();
  } finally {
    scope = outer;
  }
}

const provisionTenant = jest.fn<(input: Record<string, unknown>) => unknown>();
/** The ONE public sign-up daily cap (email requests + Google sign-ups). */
const capReached = jest.fn<(input: { now: string; dailyCap: number }) => boolean>();
/** LIRA-290: the ONE "this email already owns a shop" check. */
const ownsShop = jest.fn<(email: string) => { id: number; slug: string } | null>();
const auditLog = jest.fn();
/** LIRA-288 "Join with Google": the core service is a stub here (its own
 * behaviour is core's UserInvitationService.joinWithGoogle.test.ts). */
const acceptWithGoogle = jest.fn<(input: Record<string, unknown>) => unknown>();

const TENANTS: Record<number, { id: number; name: string; slug: string; status: string }> = {
  2: { id: 2, name: "Two Shop", slug: "two", status: "active" },
  3: { id: 3, name: "Three Shop", slug: "three", status: "active" },
  5: { id: 5, name: "Closed", slug: "closed", status: "suspended" },
};

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getGoogleAuthService: () => svc,
    getTenantProvisioningService: () => ({ provisionTenant }),
    getSignupInvitationService: () => ({
      isPublicSignupCapReached: capReached,
      findShopOwnedByEmail: ownsShop,
    }),
    getAuditService: () => ({ log: auditLog }),
    getUserInvitationService: () => ({ acceptWithGoogle }),
    getAuditRepository: () => ({ log: auditLog }),
    getAuthService: () => ({ login: jest.fn(), logout: jest.fn() }),
    getUserRepository: () => ({
      findById: () => null,
      findByUsernameInRealm: (username: string, tenantId: number) => ({
        id: 99,
        username,
        tenant_id: tenantId,
      }),
    }),
    getTenantRepository: () => ({
      getBySlug: (slug: string) =>
        Object.values(TENANTS).find((t) => t.slug === slug) ?? null,
      getById: (id: number) => TENANTS[id] ?? null,
    }),
    runWithoutTenant: (fn: () => unknown) => inScope("platform", fn),
    runWithTenant: (id: number, fn: () => unknown) => inScope(id, fn),
    JWT_SECRET: "test-secret-at-least-32-characters-long!",
    JWT_EXPIRES_IN: "7d",
    get GOOGLE_CLIENT_ID() {
      return clientId;
    },
    get GOOGLE_CLIENT_SECRET() {
      return clientSecret;
    },
    get APP_BASE_DOMAIN() {
      return baseDomain;
    },
    get SIGNUP_SELF_SERVE_ENABLED() {
      return selfServe;
    },
    get SIGNUP_INVITE_BASE_URL() {
      return undefined;
    },
  };
});

import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  GoogleAccountInOtherShopError,
  GoogleTokenError,
  IdentityAlreadyLinkedError,
  GOOGLE_NOT_CONFIGURED,
  googleSignupSchema,
  EmailTakenInShopError,
  JoinGoogleEmailMismatchError,
  UserInviteShopInactiveError,
  UsernameTakenError,
  LastSigninMethodError,
  SET_PASSWORD_FIRST,
  SET_PASSWORD_FIRST_MESSAGE,
} from "@liratek/core";
import googleAuthRoutes from "../googleAuth.js";
import authRoutes from "../auth.js";
import { signTicket } from "../../security/googleOAuth.js";

const WWW = "www.liratek.shop";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // server.ts parses forms globally too (the link start is a form POST).
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/auth/google", googleAuthRoutes);
  app.use("/api/auth", authRoutes);
  return app;
}

function enable(): void {
  clientId = "cid.apps.googleusercontent.com";
  clientSecret = "csecret";
  baseDomain = "liratek.shop";
}

beforeEach(() => {
  jest.clearAllMocks();
  clientId = undefined;
  clientSecret = undefined;
  baseDomain = "liratek.shop";
  selfServe = false;
  capReached.mockReturnValue(false);
  ownsShop.mockReturnValue(null);
  scope = null;
  svc.createHandoff.mockReturnValue("handoff-token");
  svc.exchangeCodeForClaims.mockResolvedValue({
    sub: "g-sub",
    email: "owner@gmail.com",
  });
});

/** The cookie and the Google URL a /start produced. */
async function start(
  app: Express,
  query: string,
): Promise<{ cookie: string; google: URL }> {
  const res = await request(app)
    .get(`/api/auth/google/start?${query}`)
    .set("Host", WWW);
  expect(res.status).toBe(302);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  const cookie = setCookie[0]!.split(";")[0]!;
  return { cookie, google: new URL(res.headers.location as string) };
}

/** POST /start as the Settings page's form does. */
async function startForm(
  app: Express,
  fields: Record<string, string>,
): Promise<{ cookie: string; google: URL }> {
  const res = await request(app)
    .post("/api/auth/google/start")
    .set("Host", WWW)
    .type("form")
    .send(fields);
  expect(res.status).toBe(302);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return {
    cookie: setCookie[0]!.split(";")[0]!,
    google: new URL(res.headers.location as string),
  };
}

async function callback(
  app: Express,
  cookie: string | null,
  query: string,
): Promise<URL> {
  let req = request(app).get(`/api/auth/google/callback?${query}`).set("Host", WWW);
  if (cookie) req = req.set("Cookie", cookie);
  const res = await req;
  expect(res.status).toBe(302);
  return new URL(res.headers.location as string);
}

/** Fragment query of `https://x/#/path?a=b`. */
function hashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.split("?")[1] ?? "");
}

async function signInFlow(
  app: Express,
  startQuery = "intent=login",
): Promise<URL> {
  const { cookie, google } = await start(app, startQuery);
  return callback(
    app,
    cookie,
    `code=c1&state=${encodeURIComponent(google.searchParams.get("state")!)}`,
  );
}

// ── Dormant ──────────────────────────────────────────────────────────────

describe("dormant while GOOGLE_CLIENT_ID is unset", () => {
  it("status reports disabled, and so does a client id without its secret", async () => {
    const app = buildApp();
    let res = await request(app).get("/api/auth/google/status").set("Host", WWW);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { enabled: false, startUrl: null, shop: null } });
    clientId = "cid";
    res = await request(app).get("/api/auth/google/status").set("Host", WWW);
    expect(res.body.data.enabled).toBe(false);
  });

  it("start and callback redirect with error=not_configured", async () => {
    const app = buildApp();
    const s = await request(app).get("/api/auth/google/start?intent=login").set("Host", WWW);
    expect(s.status).toBe(302);
    expect(s.headers.location).toContain("error=not_configured");
    const c = await request(app).get("/api/auth/google/callback?code=x&state=y").set("Host", WWW);
    expect(c.status).toBe(302);
    expect(c.headers.location).toContain("error=not_configured");
    expect(svc.exchangeCodeForClaims).not.toHaveBeenCalled();
  });

  it("every POST/DELETE answers 200 GOOGLE_NOT_CONFIGURED and touches nothing", async () => {
    const app = buildApp();
    const calls = [
      request(app).post("/api/auth/google/choose").send({ ticket: "t", tenantId: 2 }),
      request(app).post("/api/auth/google/sso-exchange").send({ token: "t" }),
      request(app).post("/api/auth/google/link/start").set("x-test-role", "admin"),
      request(app).delete("/api/auth/google/link").set("x-test-role", "admin"),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(GOOGLE_NOT_CONFIGURED);
    }
    expect(svc.consumeHandoff).not.toHaveBeenCalled();
    expect(svc.unlinkIdentity).not.toHaveBeenCalled();
  });

  it("a Google sign-up body is refused without provisioning", async () => {
    const res = await request(buildApp())
      .post("/api/auth/signup")
      .send({
        name: "Shop",
        slug: "newshop",
        adminUsername: "amir",
        adminPassword: "Str0ng-Password!",
        googleTicket: "anything",
      });
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(GOOGLE_NOT_CONFIGURED);
    expect(provisionTenant).not.toHaveBeenCalled();
  });
});

// ── Start + callback ─────────────────────────────────────────────────────

describe("start: authorization code with PKCE, state in a signed cookie", () => {
  it("reports the www start URL when enabled", async () => {
    enable();
    const res = await request(buildApp()).get("/api/auth/google/status").set("Host", "two.liratek.shop");
    expect(res.body.data).toEqual({
      enabled: true,
      startUrl: "https://www.liratek.shop/api/auth/google/start",
      shop: "two",
    });
  });

  it("redirects to Google with S256 PKCE and sets an httpOnly, Lax cookie", async () => {
    enable();
    const res = await request(buildApp())
      .get("/api/auth/google/start?intent=login")
      .set("Host", WWW);
    expect(res.status).toBe(302);
    const google = new URL(res.headers.location as string);
    expect(google.hostname).toBe("accounts.google.com");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(google.searchParams.get("redirect_uri")).toBe(
      "https://www.liratek.shop/api/auth/google/callback",
    );
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    // The verifier never travels to the browser in the clear.
    expect(cookie).not.toContain(google.searchParams.get("code_challenge")!);
  });

  it("a shop subdomain is sent to the www start, never runs the flow itself", async () => {
    enable();
    const res = await request(buildApp())
      .get("/api/auth/google/start?intent=login&shop=two")
      .set("Host", "two.liratek.shop");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://www.liratek.shop/api/auth/google/start?intent=login&shop=two",
    );
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("a link ticket in a URL (GET) is refused even when valid", async () => {
    enable();
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/google/link/start")
      .set("x-test-role", "admin");
    const ticket = res.body.data.ticket as string;
    const get = await request(app)
      .get(`/api/auth/google/start?intent=link&ticket=${ticket}`)
      .set("Host", WWW);
    expect(get.status).toBe(302);
    expect(get.headers.location).toContain("error=expired");
    expect(svc.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("a link form with a forged ticket is refused", async () => {
    enable();
    const forged = jwt.sign(
      { userId: 1, tenantId: 2 },
      "test-secret-at-least-32-characters-long!",
      { audience: "google-link" },
    );
    const res = await request(buildApp())
      .post("/api/auth/google/start")
      .set("Host", WWW)
      .type("form")
      .send({ intent: "link", ticket: forged });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error=expired");
    expect(svc.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("intent=link without a valid link ticket is refused", async () => {
    enable();
    const res = await request(buildApp())
      .get("/api/auth/google/start?intent=link")
      .set("Host", WWW);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error=expired");
    expect(svc.buildAuthorizationUrl).not.toHaveBeenCalled();
  });
});

describe("callback", () => {
  it("sends the PKCE verifier whose S256 is the challenge Google saw", async () => {
    enable();
    const app = buildApp();
    const { cookie, google } = await start(app, "intent=login");
    svc.findSignInMatches.mockReturnValue([]);
    await callback(app, cookie, `code=c1&state=${google.searchParams.get("state")}`);
    const input = svc.exchangeCodeForClaims.mock.calls[0]![0];
    expect(input.code).toBe("c1");
    expect(
      crypto.createHash("sha256").update(String(input.codeVerifier)).digest("base64url"),
    ).toBe(google.searchParams.get("code_challenge"));
    expect(input.nonce).toBe(google.searchParams.get("nonce"));
    expect(input.redirectUri).toBe("https://www.liratek.shop/api/auth/google/callback");
  });

  it("refuses a state that does not match the cookie", async () => {
    enable();
    const app = buildApp();
    const { cookie } = await start(app, "intent=login");
    const url = await callback(app, cookie, "code=c1&state=forged");
    expect(hashParams(url).get("error")).toBe("failed");
    expect(svc.exchangeCodeForClaims).not.toHaveBeenCalled();
  });

  it("refuses a callback with no state cookie (expired or another browser)", async () => {
    enable();
    const url = await callback(buildApp(), null, "code=c1&state=s");
    expect(hashParams(url).get("error")).toBe("expired");
    expect(svc.exchangeCodeForClaims).not.toHaveBeenCalled();
  });

  it("a cancelled consent comes back as error=cancelled and clears the cookie", async () => {
    enable();
    const app = buildApp();
    const { cookie, google } = await start(app, "intent=login");
    const res = await request(app)
      .get(`/api/auth/google/callback?error=access_denied&state=${google.searchParams.get("state")}`)
      .set("Host", WWW)
      .set("Cookie", cookie);
    expect(hashParams(new URL(res.headers.location as string)).get("error")).toBe("cancelled");
    expect(String(res.headers["set-cookie"])).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("an ID token the service refuses is error=failed", async () => {
    enable();
    svc.exchangeCodeForClaims.mockRejectedValue(new GoogleTokenError("aud"));
    const url = await signInFlow(buildApp());
    expect(hashParams(url).get("error")).toBe("failed");
    expect(svc.findSignInMatches).not.toHaveBeenCalled();
  });

  it("login, one shop: mints a hand-off and goes to that shop's /#/login?sso=", async () => {
    enable();
    svc.findSignInMatches.mockReturnValue([
      { identity_id: 1, user_id: 20, tenant_id: 2, username: "boss", role: "admin" },
    ]);
    const url = await signInFlow(buildApp());
    expect(url.origin).toBe("https://two.liratek.shop");
    expect(url.hash).toBe("#/login?sso=handoff-token");
    expect(svc.findSignInMatches).toHaveBeenCalledWith("g-sub");
    expect(svc.createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 20, tenantId: 2 }),
    );
  });

  it("login, no linked account: error=no_account (never matched by email)", async () => {
    enable();
    svc.findSignInMatches.mockReturnValue([]);
    const url = await signInFlow(buildApp());
    expect(url.origin).toBe("https://www.liratek.shop");
    expect(hashParams(url).get("error")).toBe("no_account");
    expect(svc.createHandoff).not.toHaveBeenCalled();
  });

  it("login, a suspended shop is not offered", async () => {
    enable();
    svc.findSignInMatches.mockReturnValue([
      { identity_id: 1, user_id: 50, tenant_id: 5, username: "x", role: "admin" },
    ]);
    const url = await signInFlow(buildApp());
    expect(hashParams(url).get("error")).toBe("no_account");
  });

  // LIRA-288 FR-004: started on a shop's own address, Google signs in THAT
  // shop's user — read from the shop's own records, never the www directory
  // — or refuses; it never goes to another shop.
  describe("login started on a shop's own address", () => {
    it("signs in that shop's linked user, looked up in that shop's scope", async () => {
      enable();
      svc.findMatchInTenant.mockImplementation((_sub, tenantId) => {
        expect(scope).toBe(tenantId);
        return { identity_id: 1, user_id: 20, tenant_id: 2, username: "boss", role: "admin" };
      });
      const url = await signInFlow(buildApp(), "intent=login&shop=two");
      expect(url.origin).toBe("https://two.liratek.shop");
      expect(url.hash).toBe("#/login?sso=handoff-token");
      expect(svc.findMatchInTenant).toHaveBeenCalledWith("g-sub", 2);
      expect(svc.findSignInMatches).not.toHaveBeenCalled();
    });

    it("refuses with error=no_account when this shop has no linked user, even if another shop does", async () => {
      enable();
      svc.findMatchInTenant.mockReturnValue(null);
      svc.findSignInMatches.mockReturnValue([
        { tenant_id: 3, slug: "three", shop_name: "Three Shop", user_id: 30, username: "boss3" },
      ]);
      const url = await signInFlow(buildApp(), "intent=login&shop=two");
      expect(url.origin).toBe("https://www.liratek.shop");
      expect(hashParams(url).get("error")).toBe("no_account");
      expect(svc.createHandoff).not.toHaveBeenCalled();
    });

    it("refuses a shop that is not active", async () => {
      enable();
      svc.findMatchInTenant.mockReturnValue({ identity_id: 1, user_id: 50, tenant_id: 5, username: "x", role: "admin" });
      const url = await signInFlow(buildApp(), "intent=login&shop=closed");
      expect(hashParams(url).get("error")).toBe("no_account");
      expect(svc.createHandoff).not.toHaveBeenCalled();
    });
  });

  describe("login, several shops", () => {
    const TWO_SHOPS = [
      { identity_id: 1, user_id: 20, tenant_id: 2, username: "boss", role: "admin" },
      { identity_id: 2, user_id: 30, tenant_id: 3, username: "boss3", role: "admin" },
    ];

    it("goes to the www chooser; choosing a listed shop returns its hand-off URL", async () => {
      enable();
      svc.findSignInMatches.mockReturnValue(TWO_SHOPS);
      const app = buildApp();
      const url = await signInFlow(app);
      expect(url.origin).toBe("https://www.liratek.shop");
      const ticket = hashParams(url).get("choose");
      expect(ticket).toBeTruthy();
      const shops = (jwt.decode(ticket!) as { shops: Array<{ tenantId: number; name: string }> }).shops;
      expect(shops.map((s) => s.name)).toEqual(["Two Shop", "Three Shop"]);
      expect(svc.createHandoff).not.toHaveBeenCalled();

      const chooseScopes: Array<number | "platform" | null> = [];
      svc.findMatchInTenant.mockImplementation(() => {
        chooseScopes.push(scope);
        return TWO_SHOPS[1]!;
      });
      const res = await request(app)
        .post("/api/auth/google/choose")
        .send({ ticket, tenantId: 3 });
      expect(res.body).toEqual({
        success: true,
        data: { redirectUrl: "https://three.liratek.shop/#/login?sso=handoff-token" },
      });
      // Re-checked against the database, not trusted from the ticket — in
      // the chosen shop's own scope (its file, in per-tenant mode).
      expect(svc.findMatchInTenant).toHaveBeenCalledWith("g-sub", 3);
      expect(chooseScopes).toEqual([3]);
      expect(svc.createHandoff).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 30, tenantId: 3 }),
      );
    });

    it("refuses a shop the ticket does not list, an unlinked shop, and a forged ticket", async () => {
      enable();
      svc.findSignInMatches.mockReturnValue(TWO_SHOPS);
      const app = buildApp();
      const ticket = hashParams(await signInFlow(app)).get("choose");

      let res = await request(app).post("/api/auth/google/choose").send({ ticket, tenantId: 7 });
      expect(res.body.success).toBe(false);

      svc.findMatchInTenant.mockReturnValue(null);
      res = await request(app).post("/api/auth/google/choose").send({ ticket, tenantId: 2 });
      expect(res.body.success).toBe(false);

      const forged = jwt.sign(
        { sub: "g-sub", shops: [{ tenantId: 2, name: "x", slug: "two" }] },
        "test-secret-at-least-32-characters-long!",
        { audience: "google-choose" },
      );
      svc.findMatchInTenant.mockReturnValue(TWO_SHOPS[0]!);
      res = await request(app).post("/api/auth/google/choose").send({ ticket: forged, tenantId: 2 });
      expect(res.body.success).toBe(false);
      expect(svc.createHandoff).not.toHaveBeenCalled();
    });
  });
});

// ── Hand-off exchange ────────────────────────────────────────────────────

describe("POST /sso-exchange", () => {
  const exchange = (host: string, token = "handoff-token") =>
    request(buildApp())
      .post("/api/auth/google/sso-exchange")
      .set("Host", host)
      .send({ token });

  it("issues the same session envelope as /login, on the hand-off's own shop", async () => {
    enable();
    svc.consumeHandoff.mockReturnValue({ userId: 20, tenantId: 2 });
    svc.openSession.mockReturnValue({
      user: { id: 20, username: "boss", role: "admin", tenant_id: 2 },
      sessionToken: "db-session-token",
    });
    const res = await exchange("two.liratek.shop");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({ id: 20, username: "boss", role: "admin" });
    expect(res.body.data.sessionToken).toBe("db-session-token");
    const claims = jwt.verify(
      res.body.data.token,
      "test-secret-at-least-32-characters-long!",
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      userId: 20,
      role: "admin",
      tenantId: 2,
      sessionToken: "db-session-token",
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login", entity_type: "session", user_id: 20 }),
    );
  });

  it("a used or expired token gets the generic refusal", async () => {
    enable();
    svc.consumeHandoff.mockReturnValue(null);
    const res = await exchange("two.liratek.shop");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(svc.openSession).not.toHaveBeenCalled();
  });

  it.each([
    ["another shop", "three.liratek.shop"],
    ["the platform host", WWW],
    ["an unknown shop", "nosuch.liratek.shop"],
  ])("refuses a hand-off presented on %s", async (_label, host) => {
    enable();
    svc.consumeHandoff.mockReturnValue({ userId: 20, tenantId: 2 });
    const res = await exchange(host);
    expect(res.body.success).toBe(false);
    expect(svc.openSession).not.toHaveBeenCalled();
  });

  it("refuses when the user or shop can no longer sign in", async () => {
    enable();
    svc.consumeHandoff.mockReturnValue({ userId: 20, tenantId: 2 });
    svc.openSession.mockReturnValue(null);
    const res = await exchange("two.liratek.shop");
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });
});

// ── Sign-up ──────────────────────────────────────────────────────────────

describe("sign-up with a Google ticket", () => {
  // Owner decision 2026-10-07: Google sign-up is ALWAYS open when Google is
  // configured, whatever the self-serve email switch says (`selfServe` stays
  // false throughout this block).

  async function signupTicket(app: Express): Promise<string> {
    const url = await signInFlow(app, "intent=signup");
    expect(url.origin).toBe("https://www.liratek.shop");
    expect(url.hash.startsWith("#/signup?")).toBe(true);
    return hashParams(url).get("google")!;
  }

  // Rule 24: the body's keys are the schema's own.
  const shopFields = {
    name: "New Shop",
    slug: "newshop",
    adminUsername: "amir",
    adminPassword: "Str0ng-Password!",
  };

  it("the body used here is valid per googleSignupSchema", () => {
    expect(googleSignupSchema.safeParse({ ...shopFields, googleTicket: "t" }).success).toBe(true);
    expect(
      googleSignupSchema.safeParse({ ...shopFields, adminPassword: undefined, googleTicket: "t" }).success,
    ).toBe(false);
  });

  it("creates the shop with the Google email, verified, and links the admin to the Google sub", async () => {
    enable();
    const app = buildApp();
    const googleTicket = await signupTicket(app);
    expect((jwt.decode(googleTicket) as { email: string }).email).toBe("owner@gmail.com");
    provisionTenant.mockReturnValue({ id: 9, name: "New Shop", slug: "newshop" });

    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...shopFields, googleTicket, contactEmail: "attacker@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.data.loginUrl).toBe("https://newshop.liratek.shop");
    const input = provisionTenant.mock.calls[0]![0];
    expect(input.contactEmail).toBe("owner@gmail.com");
    expect(typeof input.contactEmailVerifiedAt).toBe("string");
    // Marks the shop as a Google sign-up: what the daily cap counts.
    expect(typeof input.googleSignupAt).toBe("string");
    expect(input.adminPassword).toBe("Str0ng-Password!");
    expect(svc.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 99, subject: "g-sub", email: "owner@gmail.com" }),
    );
  });

  it("still requires a password", async () => {
    enable();
    const app = buildApp();
    const googleTicket = await signupTicket(app);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...shopFields, adminPassword: undefined, googleTicket });
    // validateRequest answers zod failures 200 + success:false (rule 19c).
    expect(res.body.success).toBe(false);
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  it("refuses a forged or wrong-purpose ticket", async () => {
    enable();
    const app = buildApp();
    const forged = jwt.sign(
      { sub: "g", email: "x@example.com", verifiedAt: new Date().toISOString() },
      "not-the-secret-but-long-enough-32-chars!!",
      { audience: "google-signup" },
    );
    let res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket: forged });
    expect(res.body.success).toBe(false);
    // A sign-in chooser ticket is not a sign-up ticket.
    svc.findSignInMatches.mockReturnValue([
      { identity_id: 1, user_id: 20, tenant_id: 2, username: "a", role: "admin" },
      { identity_id: 2, user_id: 30, tenant_id: 3, username: "b", role: "admin" },
    ]);
    const choose = hashParams(await signInFlow(app)).get("choose")!;
    res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket: choose });
    expect(res.body.success).toBe(false);
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  // LIRA-290: this used to expect HTTP 400 with the code nested in
  // `error`, which the page's requestJson THREW on, losing the code. The
  // refusal is now the contract envelope: 200 + top-level `code`.
  it("one shop per email still applies (a shop appearing after the check: the unique index)", async () => {
    enable();
    const app = buildApp();
    const googleTicket = await signupTicket(app);
    const { EmailAlreadyHasShopError } = jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
    provisionTenant.mockImplementation(() => {
      throw new EmailAlreadyHasShopError();
    });
    const res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      code: "EMAIL_ALREADY_HAS_SHOP",
      error: "This email already has a LiraTek shop.",
    });
    expect(svc.linkIdentity).not.toHaveBeenCalled();
  });

  it("an OWNER's Gmail is refused at the callback: back to the Google page with error=email_has_shop, no ticket", async () => {
    enable();
    ownsShop.mockReturnValue({ id: 2, slug: "two" });
    const url = await signInFlow(buildApp(), "intent=signup");
    expect(url.origin).toBe("https://www.liratek.shop");
    expect(url.hash).toContain("auth/google?");
    expect(hashParams(url).get("error")).toBe("email_has_shop");
    expect(url.hash).not.toContain("google=");
    // The shop is never named in the URL.
    expect(url.href).not.toContain("two");
    expect(ownsShop).toHaveBeenCalledWith("owner@gmail.com");
  });

  it("an OWNER's Gmail is refused when the form is submitted, before provisioning: 200 EMAIL_ALREADY_HAS_SHOP", async () => {
    enable();
    const app = buildApp();
    const googleTicket = await signupTicket(app);
    ownsShop.mockReturnValue({ id: 2, slug: "two" });
    const res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      code: "EMAIL_ALREADY_HAS_SHOP",
      error: "This email already has a LiraTek shop.",
    });
    expect(provisionTenant).not.toHaveBeenCalled();
    expect(svc.linkIdentity).not.toHaveBeenCalled();
  });

  it("a Gmail that owns no shop (e.g. a staff member's) gets the sign-up form", async () => {
    enable();
    const url = await signInFlow(buildApp(), "intent=signup");
    expect(url.hash.startsWith("#/signup?google=")).toBe(true);
    expect(ownsShop).toHaveBeenCalledWith("owner@gmail.com");
  });

  it("an invite-link sign-up body still goes to the invite route", async () => {
    enable();
    const res = await request(buildApp())
      .post("/api/auth/signup")
      .send({ ...shopFields, inviteToken: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde" });
    // The invite route answers; the Google branch never ran.
    expect(res.body.code).not.toBe(GOOGLE_NOT_CONFIGURED);
    expect(svc.linkIdentity).not.toHaveBeenCalled();
  });
});

describe("Google sign-up: always open when configured, inside the one daily cap", () => {
  const shopFields = {
    name: "New Shop",
    slug: "newshop",
    adminUsername: "amir",
    adminPassword: "Str0ng-Password!",
  };

  it("status carries no separate sign-up switch, and start(signup) runs with self-serve OFF", async () => {
    enable();
    selfServe = false;
    const app = buildApp();
    const res = await request(app).get("/api/auth/google/status").set("Host", WWW);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data).not.toHaveProperty("signupEnabled");
    const url = await signInFlow(app, "intent=signup");
    expect(url.hash.startsWith("#/signup?google=")).toBe(true);
  });

  it("creates the shop with self-serve OFF", async () => {
    enable();
    selfServe = false;
    const app = buildApp();
    const googleTicket = hashParams(await signInFlow(app, "intent=signup")).get("google")!;
    provisionTenant.mockReturnValue({ id: 9, name: "New Shop", slug: "newshop" });
    const res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket });
    expect(res.status).toBe(201);
    expect(provisionTenant).toHaveBeenCalledTimes(1);
  });

  it("cap reached at the callback: back to the Google page with error=signup_limit", async () => {
    enable();
    capReached.mockReturnValue(true);
    const url = await signInFlow(buildApp(), "intent=signup");
    expect(url.hash).toContain("error=signup_limit");
    expect(url.hash).not.toContain("google=");
  });

  it("cap reached when the form is submitted: refused with a clear message, nothing created, warn logged", async () => {
    enable();
    const app = buildApp();
    const googleTicket = hashParams(await signInFlow(app, "intent=signup")).get("google")!;
    capReached.mockReturnValue(true);
    const { logger } = jest.requireMock<{ logger: { warn: jest.Mock } }>("../../server.js");
    const res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("SIGNUP_DAILY_CAP");
    expect(String(res.body.error)).toMatch(/today/i);
    expect(provisionTenant).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    // The cap is the platform's one setting (SIGNUP_SELF_SERVE_DAILY_CAP).
    expect(capReached).toHaveBeenCalledWith(
      expect.objectContaining({ dailyCap: expect.any(Number), now: expect.any(String) }),
    );
  });

  // LIRA-288 FR-003 (owner decision 2026-10-08: one Google account = one
  // user PER SHOP): an account already linked in other shops can still
  // create a new shop; its admin gets the link.
  it("an account linked in other shops gets the sign-up form at the callback", async () => {
    enable();
    svc.findSignInMatches.mockReturnValue([
      { tenant_id: 2, slug: "two", shop_name: "Two Shop", user_id: 20, username: "boss" },
    ]);
    const url = await signInFlow(buildApp(), "intent=signup");
    expect(url.origin).toBe("https://www.liratek.shop");
    expect(url.hash.startsWith("#/signup?google=")).toBe(true);
    expect(url.hash).not.toContain("already_connected");
  });

  it("an account linked in other shops creates the shop and links its admin when the form is submitted", async () => {
    enable();
    const app = buildApp();
    const googleTicket = hashParams(await signInFlow(app, "intent=signup")).get("google")!;
    provisionTenant.mockReturnValue({ id: 9, name: "New Shop", slug: "newshop" });
    const res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket });
    expect(res.status).toBe(201);
    expect(provisionTenant).toHaveBeenCalledTimes(1);
    expect(svc.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 99, subject: "g-sub" }),
    );
    expect(res.body.code).not.toBe("GOOGLE_ACCOUNT_IN_OTHER_SHOP");
  });

  it("sign-in with Google is never subject to the sign-up cap", async () => {
    enable();
    capReached.mockReturnValue(true);
    svc.findSignInMatches.mockReturnValue([
      { identity_id: 1, user_id: 20, tenant_id: 2, username: "boss", role: "admin" },
    ]);
    const url = await signInFlow(buildApp());
    expect(url.hash).toBe("#/login?sso=handoff-token");
  });
});

// ── Link from Settings ───────────────────────────────────────────────────

describe("link / unlink from Settings", () => {
  async function linkFlow(app: Express): Promise<URL> {
    const res = await request(app)
      .post("/api/auth/google/link/start")
      .set("x-test-role", "staff")
      .send({ userId: 1, tenantId: 3 }); // ignored: the JWT decides
    expect(res.body.success).toBe(true);
    // The ticket is NOT in the URL (access logs); the page POSTs it.
    expect(res.body.data.url).toBe("https://www.liratek.shop/api/auth/google/start");
    expect(typeof res.body.data.ticket).toBe("string");
    const { cookie, google } = await startForm(app, {
      intent: "link",
      ticket: res.body.data.ticket as string,
    });
    return callback(app, cookie, `code=c1&state=${google.searchParams.get("state")}`);
  }

  // LIRA-291: the panel moved to "My account" (/account), which every role
  // can open; Settings is admin-only, so a staff member landing there was
  // sent home and never saw the result.
  it("links the SIGNED-IN user's own account and returns to that shop's My account page", async () => {
    enable();
    const url = await linkFlow(buildApp());
    expect(url.origin).toBe("https://two.liratek.shop");
    expect(url.hash.startsWith("#/account?")).toBe(true);
    expect(hashParams(url).has("tab")).toBe(false);
    expect(hashParams(url).get("google")).toBe("linked");
    expect(svc.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, subject: "g-sub", email: "owner@gmail.com" }),
    );
    expect(svc.findSignInMatches).not.toHaveBeenCalled();
  });

  it("reports an account already linked here", async () => {
    enable();
    svc.linkIdentity.mockImplementation(() => {
      throw new IdentityAlreadyLinkedError();
    });
    const url = await linkFlow(buildApp());
    expect(hashParams(url).get("google")).toBe("already_linked");
  });

  // LIRA-288: `in_other_shop` is no longer produced. The deprecated error
  // (never raised now) is just a failed link, never "in another shop".
  it("never reports google=in_other_shop", async () => {
    enable();
    svc.linkIdentity.mockImplementationOnce(() => {
      throw new GoogleAccountInOtherShopError();
    });
    const url = await linkFlow(buildApp());
    expect(url.origin).toBe("https://two.liratek.shop");
    expect(hashParams(url).get("google")).toBe("error");
  });

  it("refuses impersonation sessions and the platform super admin", async () => {
    enable();
    const app = buildApp();
    let res = await request(app)
      .post("/api/auth/google/link/start")
      .set("x-test-role", "admin")
      .set("x-test-impersonator", "1");
    expect(res.status).toBe(403);
    res = await request(app).post("/api/auth/google/link/start").set("x-test-role", "super_admin");
    expect(res.status).toBe(403);
    res = await request(app).post("/api/auth/google/link/start");
    expect(res.status).toBe(401);
  });

  it("GET /link reports the caller's own link; DELETE /link unlinks it", async () => {
    enable();
    const app = buildApp();
    svc.getLinkedEmail.mockReturnValue({
      linked: true,
      email: "owner@gmail.com",
      hasPassword: true,
    });
    let res = await request(app).get("/api/auth/google/link").set("x-test-role", "admin");
    expect(res.body).toEqual({
      success: true,
      data: { enabled: true, linked: true, email: "owner@gmail.com", hasPassword: true },
    });
    expect(svc.getLinkedEmail).toHaveBeenCalledWith(42);

    svc.unlinkIdentity.mockReturnValue(true);
    res = await request(app)
      .delete("/api/auth/google/link")
      .set("x-test-role", "admin")
      .send({ userId: 7 });
    expect(res.body).toEqual({ success: true, data: { unlinked: true } });
    expect(svc.unlinkIdentity).toHaveBeenCalledWith(42, expect.any(String));
  });

  // ── LIRA-291: never remove the last way to sign in ─────────────────────

  it("LIRA-291: a STAFF session can read and remove its own link (My account is for every role)", async () => {
    enable();
    const app = buildApp();
    svc.getLinkedEmail.mockReturnValue({ linked: true, email: "s@gmail.com", hasPassword: true });
    const status = await request(app).get("/api/auth/google/link").set("x-test-role", "staff");
    expect(status.body).toMatchObject({ success: true, data: { linked: true, hasPassword: true } });
    svc.unlinkIdentity.mockReturnValue(true);
    const res = await request(app).delete("/api/auth/google/link").set("x-test-role", "staff");
    expect(res.body).toEqual({ success: true, data: { unlinked: true } });
    expect(svc.unlinkIdentity).toHaveBeenCalledWith(42, expect.any(String));
  });

  it("GET /link reports hasPassword:false for a Google-only user, even with Google off", async () => {
    svc.getLinkedEmail.mockReturnValue({
      linked: true,
      email: "rami@gmail.com",
      hasPassword: false,
    });
    const res = await request(buildApp())
      .get("/api/auth/google/link")
      .set("x-test-role", "staff");
    expect(res.body).toEqual({
      success: true,
      data: { enabled: false, linked: true, email: "rami@gmail.com", hasPassword: false },
    });
  });

  it.each([
    ["Google on", true],
    ["Google off", false],
  ])("DELETE /link refuses SET_PASSWORD_FIRST for a user with no password (%s); nothing unlinked or audited", async (_label, on) => {
    if (on) enable();
    svc.assertCanUnlink.mockImplementationOnce(() => {
      throw new LastSigninMethodError();
    });
    const res = await request(buildApp())
      .delete("/api/auth/google/link")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      code: SET_PASSWORD_FIRST,
      error: SET_PASSWORD_FIRST_MESSAGE,
    });
    expect(svc.assertCanUnlink).toHaveBeenCalledWith(42);
    expect(svc.unlinkIdentity).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("DELETE /link turns the service's own refusal (checked again inside unlink) into SET_PASSWORD_FIRST", async () => {
    enable();
    svc.unlinkIdentity.mockImplementationOnce(() => {
      throw new LastSigninMethodError();
    });
    const res = await request(buildApp())
      .delete("/api/auth/google/link")
      .set("x-test-role", "staff");
    expect(res.body).toMatchObject({ success: false, code: SET_PASSWORD_FIRST });
    expect(auditLog).not.toHaveBeenCalled();
  });
});

// ── Join with Google (LIRA-288) ──────────────────────────────────────────

describe("Join with Google (invite links)", () => {
  const JOIN = { token: "invite-token-abc", username: "rami", tenantId: 2 };

  async function joinFlow(app: Express, join: object = JOIN): Promise<URL> {
    const { cookie, google } = await startForm(app, {
      intent: "join",
      ticket: signTicket("join", join),
    });
    return callback(app, cookie, `code=c1&state=${google.searchParams.get("state")}`);
  }

  function joinParams(url: URL): URLSearchParams {
    expect(url.hash.startsWith("#/join?")).toBe(true);
    return hashParams(url);
  }

  it("a join ticket in a URL (GET) is refused even when valid", async () => {
    enable();
    const res = await request(buildApp())
      .get(`/api/auth/google/start?intent=join&ticket=${signTicket("join", JOIN)}`)
      .set("Host", WWW);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location as string).hash).toContain("error=expired");
  });

  it("a forged or wrong-purpose join ticket is refused before Google", async () => {
    enable();
    const res = await request(buildApp())
      .post("/api/auth/google/start")
      .set("Host", WWW)
      .type("form")
      .send({ intent: "join", ticket: signTicket("link", { userId: 1, tenantId: 2 }) });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location as string).hash).toContain("error=expired");
  });

  it("success: accepts in the invite's shop scope with Google's identity, then hands off into that shop", async () => {
    enable();
    const scopes: Array<number | "platform" | null> = [];
    acceptWithGoogle.mockImplementation(() => {
      scopes.push(scope);
      return {
        ok: true,
        invite: { id: 7, email: "owner@gmail.com" },
        user: { id: 77, username: "rami", role: "staff" },
        shop: { id: 2, name: "Two Shop", slug: "two" },
      };
    });
    const url = await joinFlow(buildApp());
    expect(url.origin).toBe("https://two.liratek.shop");
    expect(url.hash).toBe("#/login?sso=handoff-token");
    expect(acceptWithGoogle).toHaveBeenCalledWith({
      token: "invite-token-abc",
      username: "rami",
      google: { sub: "g-sub", email: "owner@gmail.com", emailVerified: true },
      now: expect.any(String),
      requiredTenantId: 2,
    });
    expect(scopes).toEqual([2]);
    expect(svc.createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 77, tenantId: 2 }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 77,
        action: "create",
        entity_type: "user",
        metadata: expect.objectContaining({ via: "invite_google", invitation_id: 7 }),
      }),
    );
  });

  it.each([
    ["email_mismatch", () => new JoinGoogleEmailMismatchError()],
    ["already_linked", () => new IdentityAlreadyLinkedError()],
    ["username_taken", () => new UsernameTakenError()],
    ["shop_not_active", () => new UserInviteShopInactiveError()],
    ["email_taken", () => new EmailTakenInShopError()],
    ["error", () => new Error("boom")],
  ])("a refusal comes back to the shop's join page with google=%s and the invite", async (code, makeError) => {
    enable();
    acceptWithGoogle.mockImplementation(() => {
      throw makeError();
    });
    const url = await joinFlow(buildApp());
    expect(url.origin).toBe("https://two.liratek.shop");
    const params = joinParams(url);
    expect(params.get("google")).toBe(code);
    expect(params.get("invite")).toBe("invite-token-abc");
    expect(svc.createHandoff).not.toHaveBeenCalled();
  });

  it("an unusable invite comes back as google=invite_invalid", async () => {
    enable();
    acceptWithGoogle.mockReturnValue({ ok: false });
    const params = joinParams(await joinFlow(buildApp()));
    expect(params.get("google")).toBe("invite_invalid");
  });

  it("a cancelled consent comes back to the join page as google=cancelled", async () => {
    enable();
    const app = buildApp();
    const { cookie, google } = await startForm(app, {
      intent: "join",
      ticket: signTicket("join", JOIN),
    });
    const url = await callback(
      app,
      cookie,
      `error=access_denied&state=${google.searchParams.get("state")}`,
    );
    expect(joinParams(url).get("google")).toBe("cancelled");
    expect(acceptWithGoogle).not.toHaveBeenCalled();
  });
});

// ── LIRA-294: the Google profile photo ────────────────────────────────────

describe("LIRA-294 profile photo", () => {
  const PHOTO = "https://lh3.googleusercontent.com/a/photo=s96-c";

  it("/start asks Google for the profile scope (the photo) — via the core URL builder", async () => {
    // The scope itself lives in core's buildAuthorizationUrl (unit-tested
    // there); the route must use that builder, never its own URL.
    enable();
    await start(buildApp(), "intent=login");
    expect(svc.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it("a sign-in on a shop's own address refreshes the photo in THAT shop's scope", async () => {
    enable();
    svc.exchangeCodeForClaims.mockResolvedValue({ sub: "g-sub", email: "owner@gmail.com", picture: PHOTO });
    svc.findMatchInTenant.mockReturnValue({ identity_id: 1, user_id: 20, tenant_id: 2, username: "boss", role: "admin" });
    const scopes: Array<number | "platform" | null> = [];
    svc.refreshPicture.mockImplementation(() => {
      scopes.push(scope);
    });
    await signInFlow(buildApp(), "intent=login&shop=two");
    expect(svc.refreshPicture).toHaveBeenCalledWith("g-sub", PHOTO, expect.any(String));
    expect(scopes).toEqual([2]);
  });

  it("a sign-in on www refreshes the photo in every shop the account opens", async () => {
    enable();
    svc.exchangeCodeForClaims.mockResolvedValue({ sub: "g-sub", email: "owner@gmail.com", picture: PHOTO });
    svc.findSignInMatches.mockReturnValue([
      { identity_id: 1, user_id: 20, tenant_id: 2, username: "boss", role: "admin" },
      { identity_id: 2, user_id: 30, tenant_id: 3, username: "boss3", role: "admin" },
    ]);
    const scopes: Array<number | "platform" | null> = [];
    svc.refreshPicture.mockImplementation(() => {
      scopes.push(scope);
    });
    await signInFlow(buildApp());
    expect(scopes).toEqual([2, 3]);
  });

  it("no refresh when this shop has no linked user", async () => {
    enable();
    svc.findMatchInTenant.mockReturnValue(null);
    await signInFlow(buildApp(), "intent=login&shop=two");
    expect(svc.refreshPicture).not.toHaveBeenCalled();
  });

  it("GET /link carries pictureUrl", async () => {
    enable();
    svc.getLinkedEmail.mockReturnValue({
      linked: true,
      email: "owner@gmail.com",
      hasPassword: true,
      pictureUrl: PHOTO,
    });
    const res = await request(buildApp()).get("/api/auth/google/link").set("x-test-role", "admin");
    expect(res.body.data.pictureUrl).toBe(PHOTO);
  });
});
