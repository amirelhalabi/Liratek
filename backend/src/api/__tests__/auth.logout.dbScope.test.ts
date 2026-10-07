/**
 * POST /api/auth/logout's `authService.logout(sessionToken)` call must run
 * inside the DB scope the JWT's OWN `tenantId` claim implies (same B-D1
 * rule the middleware's `validateSession` follows) — the session row this
 * deletes lives in that tenant's own file once per-tenant DB routing is
 * live. This route decodes its own JWT manually (it is not behind
 * `authenticateJWT` — a logout must succeed even against an
 * already-expired/near-dead session), so it must scope the call itself
 * rather than inheriting one from the middleware.
 *
 * Rule 17 — proven to fail on the pre-fix route (recorded 2026-09-27,
 * `backend/src/api/__tests__/__prefixproof.logout.dbScope.test.ts` against a
 * byte-for-byte copy of `git show HEAD:backend/src/api/auth.ts`): captured
 * tenant was `1` (jest.setup.ts's fixed fallback), not `7` (the claim).
 * Proof file deleted after use.
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

let capturedTenantId: number | undefined;
let capturedBypass: boolean | undefined;

const logout = jest.fn(async () => {
  const core =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  capturedBypass = core.isTenantBypass();
  try {
    capturedTenantId = core.getCurrentTenantId();
  } catch {
    capturedTenantId = undefined;
  }
  return true;
});

const SECRET = "auth-logout-dbscope-secret-0123456789-0123456789-0123456789";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getAuthService: () => ({ logout }),
    JWT_SECRET: SECRET,
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import authRoutes from "../auth.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

function tokenFor(tenantId: number | null | undefined): string {
  const payload: Record<string, unknown> = {
    userId: 1,
    role: tenantId === null ? "super_admin" : "admin",
    sessionToken: "tok",
  };
  if (tenantId !== undefined) payload.tenantId = tenantId;
  return jwt.sign(payload, SECRET, { expiresIn: "1h" });
}

describe("POST /api/auth/logout — DB scope follows the JWT's tenantId claim", () => {
  beforeEach(() => {
    logout.mockClear();
    capturedTenantId = undefined;
    capturedBypass = undefined;
  });

  it("routes a tenant-claim token's logout() into runWithTenant(claim)", async () => {
    await request(buildApp())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${tokenFor(7)}`)
      .expect(200);
    expect(capturedTenantId).toBe(7);
    expect(capturedBypass).toBe(false);
  });

  it("routes a platform-claim (null) token's logout() into runWithoutTenant()", async () => {
    await request(buildApp())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${tokenFor(null)}`)
      .expect(200);
    expect(capturedBypass).toBe(true);
  });

  it("routes a legacy token with NO tenantId claim into runWithoutTenant() (best-effort platform fallback)", async () => {
    await request(buildApp())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${tokenFor(undefined)}`)
      .expect(200);
    expect(capturedBypass).toBe(true);
  });

  it("a different claim (9) routes to 9, not 7 — proves it's the claim, not a hardcoded value", async () => {
    await request(buildApp())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${tokenFor(9)}`)
      .expect(200);
    expect(capturedTenantId).toBe(9);
  });
});
