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

let inviteCode: string | undefined;
let baseDomain: string | undefined;

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getTenantProvisioningService: () => ({ provisionTenant }),
    getAuthService: () => ({ login: jest.fn(), logout: jest.fn() }),
    getAuditService: () => ({ log: auditLog }),
    getUserRepository: () => ({
      findById: () => null,
      // The signup audit resolves the admin it just created, in the new
      // tenant's realm.
      findByUsernameInRealm: () => ({ id: 99, username: "amir" }),
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
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express, { type Express } from "express";
import request from "supertest";
import authRoutes from "../auth.js";

const TENANT = { id: 7, name: "Corner Tech", slug: "cornertech" };

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
    inviteCode = "let-me-in";
    baseDomain = undefined;
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
});
