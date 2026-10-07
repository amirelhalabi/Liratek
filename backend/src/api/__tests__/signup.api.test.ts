/**
 * POST /api/auth/signup — public self-service tenant creation.
 *
 * Hits the REAL router with the REAL Zod schema. provisionTenant is stubbed:
 * what these assert is the ACCESS CONTROL around a write path that is
 * reachable with no token, not the provisioning itself (covered by the
 * TenantProvisioningService tests and the v172 migration tests).
 *
 * The invariant worth guarding above all: signup is OFF unless
 * SIGNUP_INVITE_CODE is set. Forgetting to configure something must not be
 * what exposes tenant creation to the internet.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const provisionTenant = jest.fn();
const auditLog = jest.fn();
// LIRA-267: the invite-link service. Its own behaviour (claim, release,
// crash case) is proven against a real database in core's
// SignupInvitationService.test.ts; here only the ROUTE's use of it matters.
const inviteCheck = jest.fn();
const inviteConsume = jest.fn();
const safeEqualSpy = jest.fn();

let inviteCode: string | undefined;
let baseDomain: string | undefined;
let emailConfigured = false;

jest.mock("../../email/createTransport.js", () => ({
  isEmailConfigured: () => emailConfigured,
}));

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getTenantProvisioningService: () => ({ provisionTenant }),
    getSignupInvitationService: () => ({
      check: inviteCheck,
      consume: inviteConsume,
    }),
    safeEqual: (a: string, b: string) => {
      safeEqualSpy(a, b);
      return actual.safeEqual(a, b);
    },
    getAuthService: () => ({ login: jest.fn(), logout: jest.fn() }),
    getAuditService: () => ({ log: auditLog }),
    getUserRepository: () => ({
      findById: () => null,
      // The signup audit resolves the admin it just created, in the new
      // tenant's realm.
      findByUsernameInRealm: () => ({ id: 99, username: "amir" }),
    }),
    // Host resolution consults the tenant registry for a subdomain label.
    // Stubbed so a tenant host resolves to `tenant` for real, rather than
    // failing the lookup and landing on `unknown` — which would make the
    // platformHost assertions pass for the wrong reason.
    getTenantRepository: () => ({
      getBySlug: (slug: string) => (slug === TENANT.slug ? TENANT : null),
    }),
    runWithoutTenant: (fn: () => unknown) => fn(),
    runWithTenant: (_id: number, fn: () => unknown) => fn(),
    JWT_SECRET: "test-secret-at-least-32-characters-long!",
    JWT_EXPIRES_IN: "7d",
    get SIGNUP_INVITE_CODE() {
      return inviteCode;
    },
    get APP_BASE_DOMAIN() {
      return baseDomain;
    },
  };
});

// The limiter must not reject across tests; the real one is proven by its own
// suite and its per-IP window would make these order-dependent.
jest.mock("../../middleware/rateLimit.js", () => ({
  signupLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  signupCheckLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  signupRequestLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express, { type Express } from "express";
import request from "supertest";
import authRoutes from "../auth.js";
import {
  signupSchema,
  checkSignupInviteSchema,
  EmailAlreadyHasShopError,
  SIGNUP_INVITE_INVALID_MESSAGE,
} from "@liratek/core";

const TENANT = { id: 7, name: "Corner Tech", slug: "cornertech" };

const VALID_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

const VALID_BODY = {
  name: "Corner Tech",
  slug: "cornertech",
  adminUsername: "amir",
  adminPassword: "Str0ng-Password!",
  inviteCode: "let-me-in",
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

function post(body: Record<string, unknown> = {}) {
  return request(buildApp())
    .post("/api/auth/signup")
    .send({ ...VALID_BODY, ...body });
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    provisionTenant.mockReset();
    auditLog.mockReset();
    provisionTenant.mockReturnValue(TENANT);
    inviteCheck.mockReset();
    inviteConsume.mockReset();
    safeEqualSpy.mockReset();
    inviteCode = "let-me-in";
    baseDomain = undefined;
    emailConfigured = false;
  });

  describe("access control", () => {
    it("is DISABLED when no invite code is configured", async () => {
      inviteCode = undefined;

      const res = await post().expect(403);

      // The safe default: an unconfigured deployment cannot be signed up to.
      expect(provisionTenant).not.toHaveBeenCalled();
      expect(res.body.success).toBe(false);
    });

    it("rejects a wrong invite code", async () => {
      const res = await post({ inviteCode: "guessing" }).expect(403);
      expect(provisionTenant).not.toHaveBeenCalled();
      expect(res.body.success).toBe(false);
    });

    it("rejects a request with no invite code at all", async () => {
      // Schema-level: inviteCode is required, so this never reaches the handler.
      const res = await request(buildApp()).post("/api/auth/signup").send({
        name: TENANT.name,
        slug: TENANT.slug,
        adminUsername: "amir",
        adminPassword: "Str0ng-Password!",
      });

      // validateRequest answers 200 with success:false, matching IPC — the
      // envelope carries the outcome, not the status code (rule 19c).
      expect(res.body.success).toBe(false);
      expect(provisionTenant).not.toHaveBeenCalled();
    });

    it("accepts the correct invite code", async () => {
      const res = await post().expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant).toEqual(TENANT);
    });
  });

  describe("validation reuses the tenant rules", () => {
    it("rejects a reserved slug", async () => {
      // "admin" is in RESERVED_TENANT_SLUGS — a signup must not be able to
      // claim a hostname the platform itself uses.
      const res = await post({ slug: "admin" });
      expect(res.body.success).toBe(false);
      expect(provisionTenant).not.toHaveBeenCalled();
    });

    it("rejects a slug with an invalid charset", async () => {
      const res = await post({ slug: "Corner Tech!" });
      expect(res.body.success).toBe(false);
      expect(provisionTenant).not.toHaveBeenCalled();
    });

    it("rejects a too-short admin username", async () => {
      const res = await post({ adminUsername: "ab" });
      expect(res.body.success).toBe(false);
      expect(provisionTenant).not.toHaveBeenCalled();
    });
  });

  describe("behaviour on success", () => {
    it("issues NO token — the caller logs in on its own subdomain", async () => {
      const res = await post().expect(201);
      // Minting a token for a realm the browser is not yet on would contradict
      // subdomain-scoped login.
      expect(JSON.stringify(res.body)).not.toContain("token");
    });

    it("records an audit row under the new tenant", async () => {
      await post().expect(201);
      expect(auditLog).toHaveBeenCalledTimes(1);
      const row = auditLog.mock.calls[0]![0] as Record<string, unknown>;
      expect(row.action).toBe("create");
      expect(row.entity_type).toBe("tenant");
      expect(row.entity_id).toBe(String(TENANT.id));
    });

    it("returns loginUrl null when host tenancy is off", async () => {
      // No APP_BASE_DOMAIN: there IS no per-tenant URL, and inventing one
      // (`<slug>.<whatever host>`) would hand the new shop a dead link.
      const res = await post().expect(201);
      expect(res.body.data.loginUrl).toBeNull();
    });

    it("returns the tenant's own subdomain URL once APP_BASE_DOMAIN is set", async () => {
      baseDomain = "liratek.shop";
      const res = await post().expect(201);
      expect(res.body.data.loginUrl).toBe("https://cornertech.liratek.shop");
    });

    it("never echoes the admin password back", async () => {
      const res = await post().expect(201);
      expect(JSON.stringify(res.body)).not.toContain("Str0ng-Password!");
    });
  });

  describe("GET /api/auth/signup-status", () => {
    const status = () => request(buildApp()).get("/api/auth/signup-status");

    it("reports disabled when no invite code is configured", async () => {
      inviteCode = undefined;
      const res = await status().expect(200);
      expect(res.body.data.enabled).toBe(false);
    });

    it("reports enabled when one is", async () => {
      const res = await status().expect(200);
      expect(res.body.data.enabled).toBe(true);
    });

    it("never returns the invite code itself", async () => {
      const res = await status().expect(200);
      // A boolean is the whole contract; leaking the code would hand out the
      // one thing that gates tenant creation.
      expect(JSON.stringify(res.body)).not.toContain("let-me-in");
    });

    // ── platformHost ────────────────────────────────────────────────────
    //
    // The login page cannot learn this from a failed attempt: every realm
    // refusal returns the same generic error on purpose, so that subdomains
    // cannot be probed. It has to be told up front, or a shop's staff see
    // "invalid username or password" on a host where their password was
    // never going to work and read it as a broken app.
    describe("platformHost", () => {
      it("is true on www., where only super admins may sign in", async () => {
        baseDomain = "liratek.shop";
        const res = await status().set("Host", "www.liratek.shop").expect(200);
        expect(res.body.data.platformHost).toBe(true);
        // Carried so the notice can spell out the address format.
        expect(res.body.data.baseDomain).toBe("liratek.shop");
      });

      it("is true on the apex", async () => {
        baseDomain = "liratek.shop";
        const res = await status().set("Host", "liratek.shop").expect(200);
        expect(res.body.data.platformHost).toBe(true);
      });

      it("is false on a tenant subdomain, and withholds the base domain", async () => {
        baseDomain = "liratek.shop";
        const res = await status()
          .set("Host", "cornertech.liratek.shop")
          .expect(200);
        expect(res.body.data.platformHost).toBe(false);
        expect(res.body.data.baseDomain).toBeNull();
      });

      it("is false when host tenancy is switched off entirely", async () => {
        // No APP_BASE_DOMAIN: there is no platform realm, so no host can be
        // it — the notice must not appear on a preview or a bare IP.
        baseDomain = undefined;
        const res = await status().set("Host", "www.liratek.shop").expect(200);
        expect(res.body.data.platformHost).toBe(false);
      });
    });
  });

  describe("conflicts", () => {
    it("surfaces a taken slug as a 400 with the reason", async () => {
      provisionTenant.mockImplementation(() => {
        throw new Error("Tenant slug 'cornertech' is already taken");
      });

      const res = await post().expect(400);
      // The form needs to know WHICH field to fix. createErrorResponse wraps
      // the reason in an object, so assert against the serialised body.
      expect(JSON.stringify(res.body)).toContain("already taken");
    });

    it("does not audit when provisioning failed", async () => {
      provisionTenant.mockImplementation(() => {
        throw new Error("Username 'amir' already exists");
      });

      await post().expect(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // ── LIRA-267: invite links ───────────────────────────────────────────────

  describe("inviteCode path (Stage A)", () => {
    it("compares the code in constant time", async () => {
      await post({ inviteCode: "guessing" }).expect(403);
      expect(safeEqualSpy).toHaveBeenCalledWith("guessing", "let-me-in");
    });

    it("rejects a body carrying BOTH a code and a token", async () => {
      const res = await post({ inviteToken: VALID_TOKEN });
      expect(res.body.success).toBe(false);
      expect(provisionTenant).not.toHaveBeenCalled();
      expect(inviteConsume).not.toHaveBeenCalled();
    });
  });

  describe("inviteToken path", () => {
    const INVITE = {
      id: 12,
      email: "owner@example.com",
      shop_name_hint: "Corner Tech",
    };

    // Rule 24: the body's field names are the schema's — this precondition
    // fails if `inviteToken` is ever renamed.
    const TOKEN_BODY = {
      name: VALID_BODY.name,
      slug: VALID_BODY.slug,
      adminUsername: VALID_BODY.adminUsername,
      adminPassword: VALID_BODY.adminPassword,
      inviteToken: VALID_TOKEN,
    };

    function postToken(extra: Record<string, unknown> = {}) {
      return request(buildApp())
        .post("/api/auth/signup")
        .send({ ...TOKEN_BODY, ...extra });
    }

    beforeEach(() => {
      // The real service calls provision(invite) after a successful claim.
      inviteConsume.mockImplementation(
        (token: unknown, _now: unknown, provision: unknown) =>
          token === VALID_TOKEN
            ? {
                ok: true,
                invite: INVITE,
                result: (provision as (i: typeof INVITE) => unknown)(INVITE),
              }
            : { ok: false },
      );
    });

    it("the token body is valid per signupSchema", () => {
      expect(signupSchema.safeParse(TOKEN_BODY).success).toBe(true);
    });

    it("creates the shop with the INVITE's email, ignoring any contactEmail in the body", async () => {
      const res = await postToken({ contactEmail: "attacker@evil.test" }).expect(
        201,
      );

      expect(res.body.data.tenant).toEqual(TENANT);
      expect(provisionTenant).toHaveBeenCalledTimes(1);
      const args = provisionTenant.mock.calls[0]![0] as Record<string, unknown>;
      expect(args.contactEmail).toBe("owner@example.com");
      expect(args).not.toHaveProperty("inviteToken");
      expect(args.slug).toBe(TENANT.slug);
      // "now" is a server ISO instant.
      const [, now] = inviteConsume.mock.calls[0]!;
      expect(typeof now).toBe("string");
      expect(Number.isNaN(Date.parse(now as string))).toBe(false);
    });

    it("works even when no shared invite code is configured", async () => {
      inviteCode = undefined;
      await postToken().expect(201);
      expect(provisionTenant).toHaveBeenCalledTimes(1);
    });

    it("records the audit row as an invite-link sign-up", async () => {
      await postToken().expect(201);
      const row = auditLog.mock.calls[0]![0] as {
        metadata: Record<string, unknown>;
      };
      expect(row.metadata).toMatchObject({
        self_service: true,
        via: "invite_link",
        invitation_id: INVITE.id,
      });
    });

    it("refuses an unusable token with 403 and the generic message", async () => {
      const res = await postToken({ inviteToken: "not-a-real-token" }).expect(
        403,
      );
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toContain(SIGNUP_INVITE_INVALID_MESSAGE);
      expect(provisionTenant).not.toHaveBeenCalled();
    });

    it("surfaces a provisioning error as 400 with its reason", async () => {
      provisionTenant.mockImplementation(() => {
        throw new Error("Tenant slug 'cornertech' is already taken");
      });
      inviteConsume.mockImplementation(
        (_t: unknown, _n: unknown, provision: unknown) => {
          // The real service releases the claim, then rethrows.
          (provision as (i: typeof INVITE) => unknown)(INVITE);
          return { ok: true };
        },
      );

      const res = await postToken().expect(400);
      expect(JSON.stringify(res.body)).toContain("already taken");
      expect(auditLog).not.toHaveBeenCalled();
    });

    it("maps EMAIL_ALREADY_HAS_SHOP to 400 'This email already has a shop.'", async () => {
      inviteConsume.mockImplementation(() => {
        throw new EmailAlreadyHasShopError();
      });
      const res = await postToken().expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe("This email already has a shop.");
    });

    it("rejects a body with neither a code nor a token", async () => {
      const { inviteToken: _omit, ...neither } = TOKEN_BODY;
      const res = await request(buildApp())
        .post("/api/auth/signup")
        .send(neither);
      // validateRequest answers schema failures with 200 + success:false
      // (rule 19c), not 400.
      expect(res.body.success).toBe(false);
      expect(inviteConsume).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/signup/invite/check", () => {
    const check = (body: Record<string, unknown>) =>
      request(buildApp()).post("/api/auth/signup/invite/check").send(body);

    it("valid -> 200 with email, shop name hint and expiry", async () => {
      inviteCheck.mockReturnValue({
        email: "owner@example.com",
        shopNameHint: "Corner Tech",
        expiresAt: "2026-10-10T10:00:00.000Z",
      });
      const body = { token: VALID_TOKEN };
      expect(checkSignupInviteSchema.safeParse(body).success).toBe(true);

      const res = await check(body).expect(200);

      expect(res.body).toEqual({
        success: true,
        data: {
          email: "owner@example.com",
          shopNameHint: "Corner Tech",
          expiresAt: "2026-10-10T10:00:00.000Z",
        },
      });
      expect(inviteCheck.mock.calls[0]![0]).toBe(VALID_TOKEN);
    });

    it("unknown/expired/used/revoked/claimed -> 200 success:false with the one generic message", async () => {
      inviteCheck.mockReturnValue(null);
      const res = await check({ token: "whatever" }).expect(200);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toContain(SIGNUP_INVITE_INVALID_MESSAGE);
    });

    it("an empty token is rejected by the schema", async () => {
      const res = await check({ token: "" });
      expect(res.body.success).toBe(false);
      expect(inviteCheck).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/auth/signup-status emailInvitesEnabled", () => {
    it("is false when email is not configured", async () => {
      emailConfigured = false;
      const res = await request(buildApp())
        .get("/api/auth/signup-status")
        .expect(200);
      expect(res.body.data.emailInvitesEnabled).toBe(false);
    });

    it("is true when it is", async () => {
      emailConfigured = true;
      const res = await request(buildApp())
        .get("/api/auth/signup-status")
        .expect(200);
      expect(res.body.data.emailInvitesEnabled).toBe(true);
    });
  });
});
