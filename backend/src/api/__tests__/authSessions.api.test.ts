/**
 * "Signed-in devices" REST route tests (SESSION_RESILIENCE_AND_DEVICES_PLAN.md
 * Part 2) — GET/DELETE/POST /api/auth/sessions*.
 *
 * Pattern mirrors auth.realm.test.ts, the only existing suite that imports
 * the REAL ../auth.js router: ../../server.js (logger) and
 * ../../middleware/rateLimit.js are faked because the real files have
 * import-time side effects (dotenv + HTTP listener; a real rate-limit
 * store), and `@liratek/core` is partially mocked — `getAuthService` is
 * swapped for a stub object (these tests are about ROUTE wiring: which
 * arguments the route builds and passes down, not AuthService/
 * SessionRepository internals, which are the core agent's own repository/
 * service test files) while everything else, including `getAuditService`,
 * stays the REAL module via `jest.requireActual`. `JWT_SECRET`/
 * `JWT_EXPIRES_IN` are pinned directly in the mock so the module-load-time
 * `if (!JWT_SECRET) throw` in auth.ts can't fail depending on whether the
 * test process happened to load backend/.env (it doesn't — dotenv only runs
 * inside the now-mocked server.ts).
 *
 * ../../middleware/auth.js is faked the same header-driven `x-test-role` way
 * every other REST route suite in this directory does (suppliers.api.test.ts
 * etc.) — it also pins `sessionToken: "test-session"` on `req.user`, which
 * lets every test assert that the route reads the comparison token from
 * req.user rather than accepting one from the client.
 *
 * Security property under test throughout: userId and the session token
 * used for `is_current`/revocation ALWAYS come from req.user, never from
 * req.body or req.params — a client must not be able to name whose sessions
 * it is listing or revoking. Every "sourced from req.user, not the body"
 * test sends a body with a DIFFERENT userId/id and asserts the service was
 * called with the JWT's own values instead.
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

jest.mock("../../middleware/rateLimit.js", () => ({
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  signupLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 42,
      username: "tester",
      role,
      tenantId: 1,
      // Fixed, distinct from any token a test's fixtures use, so
      // `is_current`-style comparisons in fixtures are unambiguous.
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

const listUserSessions = jest.fn();
const revokeUserSession = jest.fn();
const revokeOtherSessions = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getAuthService: () => ({
      listUserSessions,
      revokeUserSession,
      revokeOtherSessions,
    }),
    JWT_SECRET: "test-secret-at-least-32-characters-long!",
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import { getAuditService } from "@liratek/core";
import authRoutes from "../auth.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

// A SafeSession fixture, deliberately matching the contract's field list
// EXACTLY — no `token`, ever (packages/core/src/repositories/SessionRepository.ts
// `toSafeSession`). If the route ever forwarded a raw entity instead of what
// the service returns, or spread something extra onto it, the "no token in
// the serialised JSON" test below would need to fail — see that test's own
// rule-17 note for how this was proven.
const SAFE_SESSION_FIXTURE = {
  id: 7,
  device_type: "web",
  device_info: "Chrome on Windows",
  ip_address: "203.0.113.5",
  created_at: "2026-09-01 10:00:00",
  last_activity_at: "2026-09-10 09:30:00",
  is_current: true,
};

describe("GET /api/auth/sessions", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    listUserSessions.mockReset();
    revokeUserSession.mockReset();
    revokeOtherSessions.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires authentication — 401 without a token, service never called", async () => {
    const res = await request(app).get("/api/auth/sessions");
    expect(res.status).toBe(401);
    expect(listUserSessions).not.toHaveBeenCalled();
  });

  it("lists the CALLER's own sessions — userId/token sourced from req.user, never the body", async () => {
    listUserSessions.mockResolvedValue([SAFE_SESSION_FIXTURE]);

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("x-test-role", "staff")
      // A GET body is unusual, but if anything ever read it for a userId,
      // this proves it doesn't: 999 must never reach the service call.
      .send({ userId: 999 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [SAFE_SESSION_FIXTURE] });
    expect(listUserSessions).toHaveBeenCalledTimes(1);
    expect(listUserSessions).toHaveBeenCalledWith(42, "test-session");
  });

  // The one that matters most (plan §"Proving it"): assert on the SERIALISED
  // JSON, not on object properties — a getter or a spread on the route could
  // reintroduce a token even if the fixture and the SafeSession type don't
  // have one.
  //
  // Rule 17 — proven to fail on buggy code: temporarily changed the route to
  // `res.json(createSuccessResponse(sessions.map((s) => ({ ...s, token:
  // "leaked" }))))` and re-ran this test — it failed with the substring
  // found, as expected. Reverted before committing; the route never spreads
  // or maps the service's return value, it forwards it as-is.
  //
  // (Separately, the id=1e3 case in the DELETE suite below is its own rule-17
  // proof: a `Number.isInteger(Number(idParam))` check — the obvious first
  // draft — silently ACCEPTS "1e3" as 1000 and lets it through to the
  // service, which is why the route validates against a strict
  // `/^[1-9]\d*$/` digit-string pattern instead.)
  it("the response body's serialised JSON contains NO token field for any row", async () => {
    listUserSessions.mockResolvedValue([
      SAFE_SESSION_FIXTURE,
      { ...SAFE_SESSION_FIXTURE, id: 8, is_current: false },
    ]);

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    const serialised = JSON.stringify(res.body).toLowerCase();
    expect(serialised).not.toContain("token");
  });

  it("never audits a read", async () => {
    listUserSessions.mockResolvedValue([SAFE_SESSION_FIXTURE]);
    await request(app).get("/api/auth/sessions").set("x-test-role", "admin");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("500s honestly when the service throws, and audits nothing", async () => {
    listUserSessions.mockRejectedValue(new Error("SQLITE_BUSY"));
    const res = await request(app)
      .get("/api/auth/sessions")
      .set("x-test-role", "admin");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/auth/sessions/:id", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    listUserSessions.mockReset();
    revokeUserSession.mockReset();
    revokeOtherSessions.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires authentication — 401 without a token, service never called", async () => {
    const res = await request(app).delete("/api/auth/sessions/7");
    expect(res.status).toBe(401);
    expect(revokeUserSession).not.toHaveBeenCalled();
  });

  it.each([
    ["abc", "non-numeric"],
    ["1.5", "fractional"],
    ["0", "zero"],
    ["-3", "negative"],
    ["1e3", "exponential notation"],
    ["", "empty"],
  ])(
    "rejects id=%s (%s) with a 200 {success:false} envelope, service never called",
    async (idParam) => {
      const res = await request(app)
        .delete(`/api/auth/sessions/${idParam}`)
        .set("x-test-role", "admin");
      // A trailing empty segment ("/sessions/") doesn't match this route at
      // all (404 from Express's own router, not our validation — a genuine
      // routing miss, so it's exempt from envelope parity). Everything else
      // is a HANDLED failure from OUR check and must come back 200 +
      // {success:false}, per CLAUDE.md's envelope-parity rule (rule 19c).
      if (idParam !== "") {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
      }
      expect(revokeUserSession).not.toHaveBeenCalled();
    },
  );

  it("revokes by id from the URL and userId from req.user — never from the body", async () => {
    revokeUserSession.mockResolvedValue(true);

    const res = await request(app)
      .delete("/api/auth/sessions/7")
      .set("x-test-role", "admin")
      .send({ userId: 999, id: 123 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(revokeUserSession).toHaveBeenCalledTimes(1);
    expect(revokeUserSession).toHaveBeenCalledWith(7, 42);
  });

  it("audits the revocation on success, actor from req.user", async () => {
    revokeUserSession.mockResolvedValue(true);

    await request(app)
      .delete("/api/auth/sessions/7")
      .set("x-test-role", "admin");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "revoke_session",
        entity_type: "session",
        entity_id: "7",
        user_id: 42,
        username: "tester",
        role: "admin",
      }),
    );
  });

  it("answers 200 {success:false} and audits NOTHING when the id isn't the caller's (not found / another user / another tenant)", async () => {
    revokeUserSession.mockResolvedValue(false);

    const res = await request(app)
      .delete("/api/auth/sessions/999")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("500s honestly when the service throws, and audits nothing", async () => {
    revokeUserSession.mockRejectedValue(new Error("SQLITE_BUSY"));

    const res = await request(app)
      .delete("/api/auth/sessions/7")
      .set("x-test-role", "admin");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/sessions/revoke-others", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    listUserSessions.mockReset();
    revokeUserSession.mockReset();
    revokeOtherSessions.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires authentication — 401 without a token, service never called", async () => {
    const res = await request(app).post("/api/auth/sessions/revoke-others");
    expect(res.status).toBe(401);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("revokes using userId/token from req.user, never the body — and leaves the caller's own session alone by construction", async () => {
    revokeOtherSessions.mockResolvedValue(3);

    const res = await request(app)
      .post("/api/auth/sessions/revoke-others")
      .set("x-test-role", "admin")
      // A malicious/careless client naming a different user must not change
      // whose sessions get revoked.
      .send({ userId: 999 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { revoked: 3 } });
    expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
    // The route passes the CALLER's own token through as the "spare this
    // one" marker — it never names a session to revoke, which is what makes
    // it structurally impossible for this route to end the caller's own
    // session. (AuthService.revokeOtherSessions's own exclusion of the
    // matching-token row is proven in the core layer's own tests — this
    // route-level assertion is about what THIS file passes down.)
    expect(revokeOtherSessions).toHaveBeenCalledWith(42, "test-session");
  });

  it("audits the revocation with the count, actor from req.user", async () => {
    revokeOtherSessions.mockResolvedValue(2);

    await request(app)
      .post("/api/auth/sessions/revoke-others")
      .set("x-test-role", "admin");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "revoke_other_sessions",
        entity_type: "session",
        user_id: 42,
        username: "tester",
        role: "admin",
        summary: expect.stringContaining("2"),
      }),
    );
  });

  it("audits even a zero-revoked attempt (no other sessions existed)", async () => {
    revokeOtherSessions.mockResolvedValue(0);

    const res = await request(app)
      .post("/api/auth/sessions/revoke-others")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { revoked: 0 } });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("500s honestly when the service throws, and audits nothing", async () => {
    revokeOtherSessions.mockRejectedValue(new Error("SQLITE_BUSY"));

    const res = await request(app)
      .post("/api/auth/sessions/revoke-others")
      .set("x-test-role", "admin");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
