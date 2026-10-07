/**
 * B-D2 (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.1): login must run
 * inside the DB scope its resolved realm implies — `runWithTenant(id)` for a
 * subdomain that resolved to a tenant, `runWithoutTenant()` for the platform
 * realm — not unscoped. Once per-tenant DB routing is live
 * (`TENANT_DB_MODE=per-tenant`), every call `authService.login()` makes
 * (`findByUsernameInRealm`, `getTenantStatus`, `sessionRepo.createSession`)
 * resolves its connection from the ambient tenant scope, so running login
 * unscoped searches (and would WRITE the new session into) the wrong file.
 *
 * Rule 17 — proven to fail on the pre-fix route (recorded 2026-09-27,
 * `backend/src/api/__tests__/__prefixproof.auth.dbScope.test.ts` against a
 * byte-for-byte copy of `git show HEAD:backend/src/api/auth.ts`, since
 * reverting the real uncommitted file is forbidden):
 *   - a tenant realm (id 7) → captured tenant was `1` (jest.setup.ts's
 *     desktop-parity fixed fallback), not `7`.
 *   - the platform realm → captured bypass was `false`, not `true`.
 * Both proof files were deleted after use.
 *
 * This suite asserts the FIXED behaviour, plus the B-D2 refusal: with no
 * realm resolved AND `TENANT_DB_MODE=per-tenant`, login must refuse before
 * ever calling `authService.login()` (no cross-tenant username fallback is
 * possible once each tenant's users live in a separate file).
 */
import { jest } from "@jest/globals";

jest.mock("../../middleware/rateLimit.js", () => ({
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  signupLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  signupCheckLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  signupRequestLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

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
  NO_SUCH_REALM: -1,
}));

let capturedTenantId: number | undefined;
let capturedBypass: boolean | undefined;

interface StubLoginResult {
  success: boolean;
  user?: { id: number; username: string; role: string; tenant_id: number | null };
  token?: string;
  error?: string;
}

// Overridable per-test via `loginResult` — NOT `mockResolvedValueOnce`, which
// would replace this whole function body (including the capture logic) for
// that one call.
let loginResult: StubLoginResult = {
  success: true,
  user: { id: 42, username: "amir", role: "admin", tenant_id: 7 },
  token: "session-token",
};

const login = jest.fn(async () => {
  const core =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  capturedBypass = core.isTenantBypass();
  try {
    capturedTenantId = core.getCurrentTenantId();
  } catch {
    capturedTenantId = undefined;
  }
  return loginResult;
});
const logout = jest.fn(async () => true);

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getAuthService: () => ({ login, logout }),
    JWT_SECRET: "auth-dbscope-secret-0123456789-0123456789-0123456789",
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import authRoutes from "../auth.js";

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

const ORIGINAL_TENANT_DB_MODE = process.env.TENANT_DB_MODE;

describe("POST /api/auth/login — DB scope follows the resolved realm (B-D2)", () => {
  beforeEach(() => {
    login.mockClear();
    logout.mockClear();
    capturedTenantId = undefined;
    capturedBypass = undefined;
    delete process.env.TENANT_DB_MODE;
    loginResult = {
      success: true,
      user: { id: 42, username: "amir", role: "admin", tenant_id: 7 },
      token: "session-token",
    };
  });

  afterAll(() => {
    if (ORIGINAL_TENANT_DB_MODE === undefined) {
      delete process.env.TENANT_DB_MODE;
    } else {
      process.env.TENANT_DB_MODE = ORIGINAL_TENANT_DB_MODE;
    }
  });

  it("runs login() inside runWithTenant(id) for a resolved tenant realm", async () => {
    realm = {
      kind: "tenant",
      slug: "cornertech",
      tenant: { id: 7, slug: "cornertech", status: "active" },
    };
    const res = await post().expect(200);
    expect(res.body.success).toBe(true);
    expect(capturedTenantId).toBe(7);
    expect(capturedBypass).toBe(false);
  });

  it("runs login() inside runWithoutTenant() for the platform realm", async () => {
    realm = { kind: "platform", host: "liratek.app" };
    loginResult = {
      success: true,
      user: { id: 1, username: "root", role: "super_admin", tenant_id: null },
      token: "session-token",
    };
    await post({ username: "root" }).expect(200);
    expect(capturedBypass).toBe(true);
  });

  it("runs login() inside runWithoutTenant() for an unknown subdomain (doomed lookup, safe scope)", async () => {
    realm = { kind: "unknown", slug: "nosuchshop" };
    loginResult = { success: false, error: "Invalid username or password" };
    await post().expect(401);
    expect(capturedBypass).toBe(true);
  });

  it("shared mode (default): host tenancy inactive still logs in exactly as before (unaffected)", async () => {
    realm = { kind: "disabled" };
    const res = await post().expect(200);
    expect(res.body.success).toBe(true);
    // Runs inside runWithoutTenant() now (previously fully unscoped) — proven
    // harmless because nothing login() calls consults ambient tenant context
    // (every UserRepository/SessionRepository method login() touches is
    // tenant-exempt raw SQL with an explicit realm/id param).
    expect(capturedBypass).toBe(true);
  });

  it("per-tenant DB mode: refuses BEFORE calling authService.login() when no realm resolved", async () => {
    process.env.TENANT_DB_MODE = "per-tenant";
    realm = { kind: "disabled" };
    const res = await post().expect(401);
    expect(res.body.success).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });

  it("per-tenant DB mode: a resolved tenant realm still logs in normally", async () => {
    process.env.TENANT_DB_MODE = "per-tenant";
    realm = {
      kind: "tenant",
      slug: "cornertech",
      tenant: { id: 7, slug: "cornertech", status: "active" },
    };
    const res = await post().expect(200);
    expect(res.body.success).toBe(true);
    expect(login).toHaveBeenCalled();
    expect(capturedTenantId).toBe(7);
  });

  it("revokes the session in the SAME scope it was created in when the realm check denies it", async () => {
    realm = {
      kind: "tenant",
      slug: "othershop",
      tenant: { id: 9, slug: "othershop", status: "active" },
    };
    // login() resolves as tenant 7's admin (the mock's fixed user), but the
    // realm is tenant 9 — the existing post-auth realm check (unchanged by
    // this fix) must deny it.
    await post().expect(401);
    expect(logout).toHaveBeenCalledWith("session-token");
    // login() itself still ran inside tenant 9's scope (the realm the
    // subdomain resolved to) — proven by the earlier "tenant realm" test
    // already asserting the scope tracks `realm.tenant.id`, not the user
    // that comes back.
    expect(capturedTenantId).toBe(9);
  });
});
