/**
 * Subdomain-scoped login: POST /api/auth/login refuses credentials that do not
 * belong to the tenant whose host was addressed.
 *
 * Hits the REAL router with the REAL Zod schema. AuthService.login is stubbed
 * (this is about the realm decision, not password hashing) and tenantHost is
 * mocked so each test can state a realm directly.
 *
 * Rule 17 — proven to fail on the pre-fix code: with the realm block removed
 * from api/auth.ts, "refuses a tenant's credentials on ANOTHER tenant's
 * subdomain" returns 200 with a token. That was the behaviour before this:
 * login took no tenant hint and nothing read the Host header, so any tenant's
 * credentials authenticated on any hostname.
 */

import { jest } from "@jest/globals";

// The real server.ts uses import.meta.url (ESM) which ts-jest cannot compile
// under CommonJS, and auth.ts imports its logger from there. Same stand-in the
// other api tests use.
jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

type Realm = Record<string, unknown>;
let realm: Realm = { kind: "disabled" };

jest.mock("../../middleware/tenantHost.js", () => ({
  resolveTenantHost: () => realm,
  isHostTenancyActive: (r: Realm) =>
    r.kind !== "disabled" && r.kind !== "foreign",
}));

const login = jest.fn();
const logout = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getAuthService: () => ({ login, logout }),
    JWT_SECRET: "test-secret-at-least-32-characters-long!",
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import authRoutes from "../auth.js";

const TENANT_A = { id: 7, slug: "cornertech", status: "active" };
const TENANT_B = { id: 9, slug: "othershop", status: "active" };

/** A user of tenant A. */
const USER_A = {
  id: 42,
  username: "amir",
  role: "admin" as const,
  tenant_id: TENANT_A.id,
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

function post(body: Record<string, unknown> = {}) {
  return request(buildApp())
    .post("/api/auth/login")
    .send({ username: "amir", password: "Str0ng-Password!", ...body });
}

describe("POST /api/auth/login — subdomain realm", () => {
  beforeEach(() => {
    login.mockReset();
    logout.mockReset();
    login.mockResolvedValue({
      success: true,
      user: USER_A,
      token: "session-token",
    });
    realm = { kind: "disabled" };
  });

  it("allows the login on the tenant's OWN subdomain", async () => {
    realm = { kind: "tenant", slug: TENANT_A.slug, tenant: TENANT_A };
    const res = await post().expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
  });

  it("refuses a tenant's credentials on ANOTHER tenant's subdomain", async () => {
    realm = { kind: "tenant", slug: TENANT_B.slug, tenant: TENANT_B };
    const res = await post().expect(401);
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("session-token");
  });

  it("gives the SAME generic error as bad credentials, so subdomains cannot be probed", async () => {
    realm = { kind: "tenant", slug: TENANT_B.slug, tenant: TENANT_B };
    const wrongRealm = await post().expect(401);

    login.mockResolvedValue({ success: false, error: "Invalid credentials" });
    realm = { kind: "tenant", slug: TENANT_A.slug, tenant: TENANT_A };
    const badPassword = await post().expect(401);

    // Identical bodies: nothing distinguishes "wrong shop" from "wrong password".
    expect(wrongRealm.body).toEqual(badPassword.body);
  });

  it("revokes the session login() already created when it refuses", async () => {
    realm = { kind: "tenant", slug: TENANT_B.slug, tenant: TENANT_B };
    await post().expect(401);
    // Otherwise a refused attempt leaves a usable session row behind.
    expect(logout).toHaveBeenCalledWith("session-token");
  });

  it("refuses login to a suspended tenant, even on its own subdomain", async () => {
    realm = {
      kind: "tenant",
      slug: TENANT_A.slug,
      tenant: { ...TENANT_A, status: "suspended" },
    };
    await post().expect(401);
    expect(logout).toHaveBeenCalledWith("session-token");
  });

  it("refuses every login on an unknown subdomain", async () => {
    realm = { kind: "unknown", slug: "nosuchshop" };
    await post().expect(401);
  });

  it("refuses a non-super_admin on the platform realm", async () => {
    realm = { kind: "platform", host: "liratek.app" };
    await post().expect(401);
  });

  it("allows a super_admin on the platform realm", async () => {
    login.mockResolvedValue({
      success: true,
      user: { id: 1, username: "root", role: "super_admin", tenant_id: null },
      token: "session-token",
    });
    realm = { kind: "platform", host: "liratek.app" };
    const res = await post({ username: "root" }).expect(200);
    expect(res.body.success).toBe(true);
  });

  it("changes nothing when host tenancy is disabled (no APP_BASE_DOMAIN)", async () => {
    realm = { kind: "disabled" };
    const res = await post().expect(200);
    expect(res.body.success).toBe(true);
    expect(logout).not.toHaveBeenCalled();
  });

  it("changes nothing on a foreign host, so previews and the bare IP keep working", async () => {
    realm = { kind: "foreign", host: "liratek.vercel.app" };
    const res = await post().expect(200);
    expect(res.body.success).toBe(true);
  });
});
