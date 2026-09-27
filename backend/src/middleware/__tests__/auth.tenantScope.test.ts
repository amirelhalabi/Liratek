/**
 * B-D1 (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.1): the session check
 * must be scoped by the JWT's OWN signed `tenantId` claim BEFORE
 * `validateSession()` runs — not after, and not left unscoped. A shop's
 * sessions live in that shop's own database file once per-tenant routing is
 * live (`TENANT_DB_MODE=per-tenant`), so `getDatabase()` inside
 * `validateSession` (session-by-token lookup, activity touch, the global
 * user fetch) must already be routed to the right file.
 *
 * Rule 17 — proven to fail on the pre-fix middleware (recorded 2026-09-27,
 * `backend/src/middleware/__tests__/__prefixproof.tenantScope.test.ts`
 * against a byte-for-byte copy of `git show HEAD:backend/src/middleware/
 * auth.ts`, since reverting the real uncommitted file is forbidden):
 *   - tenantId claim 7  → captured tenant was `1` (the DESKTOP fixed
 *     fallback `jest.setup.ts` pins for every test), not `7` — the JWT's
 *     claim was silently ignored in favour of whatever ambient tenant
 *     happened to be set.
 *   - tenantId claim null → captured bypass was `false`, not `true` — no
 *     `runWithoutTenant()` scope was ever entered for the platform realm.
 * Both proof files were deleted after use, per the plan not to leave
 * throwaway fixtures behind.
 *
 * This suite asserts the FIXED behaviour: `validateSession` sees the JWT's
 * claim as the active tenant scope, not the ambient/fixed one.
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

const SECRET = "auth-tenantscope-secret-0123456789-0123456789-0123456789";

let capturedTenantId: number | undefined;
let capturedBypass: boolean | undefined;
let capturedThrew: boolean | undefined;

const validateSession = jest.fn(async () => {
  const core =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  capturedBypass = core.isTenantBypass();
  try {
    capturedTenantId = core.getCurrentTenantId();
    capturedThrew = false;
  } catch {
    capturedTenantId = undefined;
    capturedThrew = true;
  }
  // tenant_id must agree with whichever scope was actually active — the
  // middleware cross-checks payload.tenantId against this (belt-and-
  // suspenders, WP2 §4), so a mock that always answered `7` would falsely
  // 401 the platform-claim case rather than exercising it.
  return {
    id: 42,
    username: "amir",
    role: (capturedBypass ? "super_admin" : "admin") as "super_admin" | "admin",
    tenant_id: capturedBypass ? null : (capturedTenantId ?? null),
    is_active: 1,
  };
});

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getAuthService: () => ({ validateSession }),
    JWT_SECRET: SECRET,
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { authenticateJWT } from "../auth.js";

function buildApp(): Express {
  const app = express();
  app.get("/x", authenticateJWT, (_req, res) => res.json({ success: true }));
  return app;
}

function tokenFor(tenantId: number | null): string {
  return jwt.sign(
    {
      userId: 42,
      role: tenantId === null ? "super_admin" : "admin",
      sessionToken: "session-token",
      tenantId,
    },
    SECRET,
    { expiresIn: "7d" },
  );
}

describe("authenticateJWT — validateSession scoped by the JWT's tenantId claim (B-D1)", () => {
  beforeEach(() => {
    validateSession.mockClear();
    capturedTenantId = undefined;
    capturedBypass = undefined;
    capturedThrew = undefined;
  });

  it("routes a tenant-claim token's validateSession into runWithTenant(claim), not the ambient/fixed tenant", async () => {
    const res = await request(buildApp())
      .get("/x")
      .set("Authorization", `Bearer ${tokenFor(7)}`);

    expect(res.status).toBe(200);
    expect(capturedThrew).toBe(false);
    // The critical assertion: 7 (the JWT claim), never 1 (jest.setup.ts's
    // desktop-parity fixed tenant, which is what a pre-fix middleware would
    // have silently fallen through to instead).
    expect(capturedTenantId).toBe(7);
    expect(capturedBypass).toBe(false);
  });

  it("routes a platform-claim (null) token's validateSession into runWithoutTenant()", async () => {
    const res = await request(buildApp())
      .get("/x")
      .set("Authorization", `Bearer ${tokenFor(null)}`);

    expect(res.status).toBe(200);
    expect(capturedBypass).toBe(true);
    expect(capturedThrew).toBe(true); // bypass scope: getCurrentTenantId() throws by design
  });

  it("a DIFFERENT tenant claim (9) routes to 9, not 7 — proves it's the claim, not a hardcoded value", async () => {
    // Second call reuses the same mock but a different claim; if the scope
    // were hardcoded or leaked from a previous request this would still read 7.
    await request(buildApp())
      .get("/x")
      .set("Authorization", `Bearer ${tokenFor(9)}`);
    expect(capturedTenantId).toBe(9);
  });
});
