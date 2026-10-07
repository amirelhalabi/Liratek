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
  exchangeCodeForClaims: jest.fn<(input: Record<string, unknown>) => Promise<{ sub: string; email: string }>>(),
  findSignInMatches: jest.fn<(sub: string) => Array<Record<string, unknown>>>(),
  findMatchInTenant: jest.fn<(sub: string, tenantId: number) => Record<string, unknown> | null>(),
  createHandoff: jest.fn<(input: Record<string, unknown>) => string>(),
  consumeHandoff: jest.fn<(token: string, now: string) => { userId: number; tenantId: number } | null>(),
  openSession: jest.fn<(input: Record<string, unknown>) => unknown>(),
  linkIdentity: jest.fn<(input: Record<string, unknown>) => void>(),
  unlinkIdentity: jest.fn<(userId: number) => boolean>(),
  getLinkedEmail: jest.fn<(userId: number) => { linked: boolean; email: string | null }>(),
};

const provisionTenant = jest.fn<(input: Record<string, unknown>) => unknown>();
const auditLog = jest.fn();

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
    getAuditService: () => ({ log: auditLog }),
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
    runWithoutTenant: (fn: () => unknown) => fn(),
    runWithTenant: (_id: number, fn: () => unknown) => fn(),
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
  GoogleTokenError,
  IdentityAlreadyLinkedError,
  GOOGLE_NOT_CONFIGURED,
  googleSignupSchema,
} from "@liratek/core";
import googleAuthRoutes from "../googleAuth.js";
import authRoutes from "../auth.js";

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
    expect(res.body).toEqual({ success: true, data: { enabled: false, startUrl: null, shop: null, signupEnabled: false } });
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
      signupEnabled: false,
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

      svc.findMatchInTenant.mockReturnValue(TWO_SHOPS[1]!);
      const res = await request(app)
        .post("/api/auth/google/choose")
        .send({ ticket, tenantId: 3 });
      expect(res.body).toEqual({
        success: true,
        data: { redirectUrl: "https://three.liratek.shop/#/login?sso=handoff-token" },
      });
      // Re-checked against the database, not trusted from the ticket.
      expect(svc.findMatchInTenant).toHaveBeenCalledWith("g-sub", 3);
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
  // Creating a shop with Google is public self-serve sign-up: it opens only
  // with the self-serve switch (owner: sign-up is invite-only until then).
  beforeEach(() => {
    selfServe = true;
  });

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

  it("one shop per email still applies", async () => {
    enable();
    const app = buildApp();
    const googleTicket = await signupTicket(app);
    const { EmailAlreadyHasShopError } = jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
    provisionTenant.mockImplementation(() => {
      throw new EmailAlreadyHasShopError();
    });
    const res = await request(app).post("/api/auth/signup").send({ ...shopFields, googleTicket });
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_HAS_SHOP");
    expect(svc.linkIdentity).not.toHaveBeenCalled();
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

describe("Google sign-up obeys the self-serve switch (SIGNUP_SELF_SERVE_ENABLED)", () => {
  const shopFields = {
    name: "New Shop",
    slug: "newshop",
    adminUsername: "amir",
    adminPassword: "Str0ng-Password!",
  };

  it("status says sign-up is closed while self-serve is off, open when on", async () => {
    enable();
    const app = buildApp();
    let res = await request(app).get("/api/auth/google/status").set("Host", WWW);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.signupEnabled).toBe(false);
    selfServe = true;
    res = await request(app).get("/api/auth/google/status").set("Host", WWW);
    expect(res.body.data.signupEnabled).toBe(true);
  });

  it("start with intent=signup is refused while self-serve is off", async () => {
    enable();
    const res = await request(buildApp())
      .get("/api/auth/google/start?intent=signup")
      .set("Host", WWW);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error=signup_closed");
    expect(svc.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("a ticket minted while open cannot create a shop once self-serve is off", async () => {
    enable();
    selfServe = true;
    const app = buildApp();
    const url = await signInFlow(app, "intent=signup");
    const googleTicket = hashParams(url).get("google")!;
    selfServe = false;
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ ...shopFields, googleTicket });
    expect(res.body.success).toBe(false);
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  it("sign-in with Google still works while sign-up is closed", async () => {
    enable();
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

  it("links the SIGNED-IN user's own account and returns to that shop's Settings", async () => {
    enable();
    const url = await linkFlow(buildApp());
    expect(url.origin).toBe("https://two.liratek.shop");
    expect(url.hash.startsWith("#/settings?")).toBe(true);
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
    svc.getLinkedEmail.mockReturnValue({ linked: true, email: "owner@gmail.com" });
    let res = await request(app).get("/api/auth/google/link").set("x-test-role", "admin");
    expect(res.body).toEqual({
      success: true,
      data: { enabled: true, linked: true, email: "owner@gmail.com" },
    });
    expect(svc.getLinkedEmail).toHaveBeenCalledWith(42);

    svc.unlinkIdentity.mockReturnValue(true);
    res = await request(app)
      .delete("/api/auth/google/link")
      .set("x-test-role", "admin")
      .send({ userId: 7 });
    expect(res.body).toEqual({ success: true, data: { unlinked: true } });
    expect(svc.unlinkIdentity).toHaveBeenCalledWith(42);
  });
});
