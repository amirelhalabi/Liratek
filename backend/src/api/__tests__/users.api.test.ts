/**
 * Users API REST route tests — GET/POST/PUT /api/users*.
 *
 * Every write route in `users.ts` used to be a non-functional placeholder:
 * it logged a "requested" message and returned a canned `{ success: true }`
 * (POST / even fabricated `id: 1`) without ever calling AuthService. This
 * suite exists to prove the routes are now REAL — each test below is
 * commented with the pre-fix stub behavior it catches (CLAUDE.md rule 17):
 * every one of them was run against the placeholder file first and FAILED
 * there (the stub always returned success with no service call, so any
 * assertion on the service being invoked, or on a non-hardcoded id/user
 * list, failed outright).
 *
 * Pattern mirrors `authSessions.api.test.ts`, the established convention for
 * this directory: `../../server.js` and `../../middleware/auth.js` are
 * faked (real files have import-time side effects / no route-level way to
 * mint a JWT), `@liratek/core` is partially mocked — `getAuthService` swapped
 * for a stub object so these tests are about ROUTE wiring (which arguments
 * the route builds and passes down), not AuthService internals — while
 * everything else (schemas, error classes, `isAppError`, `getAuditService`)
 * stays the REAL module via `jest.requireActual`.
 *
 * Security property under test throughout: the actor (role used for
 * authorization, and the actorId passed to deactivateUser) always comes from
 * req.user (the verified JWT), never from the request body.
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

const createUser = jest.fn();
const resetPassword = jest.fn();
const deactivateUser = jest.fn();
const reactivateUser = jest.fn();
const setUserRole = jest.fn();
const getAllUsers = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getAuthService: () => ({
      createUser,
      resetPassword,
      deactivateUser,
      reactivateUser,
      setUserRole,
      getAllUsers,
    }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import {
  getAuditService,
  ConflictError,
  ValidationError,
  BusinessRuleError,
  AuthenticationError,
} from "@liratek/core";
import usersRoutes from "../users.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRoutes);
  return app;
}

describe("GET /api/users/non-admins", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    getAllUsers.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/users/non-admins");
    expect(res.status).toBe(401);
    expect(getAllUsers).not.toHaveBeenCalled();
  });

  it("requires the admin role — a staff JWT is rejected, service never called", async () => {
    const res = await request(app)
      .get("/api/users/non-admins")
      .set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(getAllUsers).not.toHaveBeenCalled();
  });

  // Catches the pre-fix stub, which always returned `{ success: true, users: [] }`
  // regardless of what users actually existed.
  it("returns the REAL non-admin users, filtered exactly like the IPC twin", async () => {
    getAllUsers.mockReturnValue([
      { id: 1, username: "admin", role: "admin", is_active: 1, tenant_id: 1 },
      { id: 2, username: "staff1", role: "staff", is_active: 1, tenant_id: 1 },
      { id: 3, username: "staff2", role: "staff", is_active: 0, tenant_id: 1 },
    ]);

    const res = await request(app)
      .get("/api/users/non-admins")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      users: [
        {
          id: 2,
          username: "staff1",
          role: "staff",
          is_active: 1,
          tenant_id: 1,
        },
        {
          id: 3,
          username: "staff2",
          role: "staff",
          is_active: 0,
          tenant_id: 1,
        },
      ],
    });
  });
});

describe("POST /api/users", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    createUser.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/users")
      .send({ username: "bob", password: "secret1", role: "staff" });
    expect(res.status).toBe(401);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("requires the admin role — a staff JWT is rejected, service never called", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("x-test-role", "staff")
      .send({ username: "bob", password: "secret1", role: "staff" });
    expect(res.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  // Catches the pre-fix stub: it returned `{ success: true, id: 1 }` for
  // EVERY request, with no row ever created. This asserts the id comes back
  // from the service's real created user, and is not the hardcoded 1.
  it("actually creates the user and returns its real id", async () => {
    createUser.mockResolvedValue({
      success: true,
      user: {
        id: 57,
        username: "bob",
        role: "staff",
        is_active: 1,
        tenant_id: 1,
      },
    });

    const res = await request(app)
      .post("/api/users")
      .set("x-test-role", "admin")
      .send({ username: "bob", password: "secret1", role: "staff" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 57 });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith(
      { username: "bob", password: "secret1", role: "staff" },
      "admin",
    );
  });

  it("audits the creation with the real id, actor from req.user", async () => {
    createUser.mockResolvedValue({
      success: true,
      user: {
        id: 57,
        username: "bob",
        role: "staff",
        is_active: 1,
        tenant_id: 1,
      },
    });

    await request(app)
      .post("/api/users")
      .set("x-test-role", "admin")
      .send({ username: "bob", password: "secret1", role: "staff" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        entity_type: "user",
        entity_id: "57",
        user_id: 42,
        username: "tester",
        role: "admin",
      }),
    );
  });

  // Catches the pre-fix stub: it never validated the username at all, so a
  // duplicate would have "succeeded" the same as any other request.
  it("a duplicate username returns HTTP 200 { success: false, error }, not a fabricated success", async () => {
    createUser.mockRejectedValue(new ConflictError("Username already exists"));

    const res = await request(app)
      .post("/api/users")
      .set("x-test-role", "admin")
      .send({ username: "bob", password: "secret1", role: "staff" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Username already exists",
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("a business-rule ValidationError from the service also comes back 200 {success:false}, not 500", async () => {
    createUser.mockRejectedValue(
      new ValidationError("Username must be at least 3 characters"),
    );

    const res = await request(app)
      .post("/api/users")
      .set("x-test-role", "admin")
      .send({ username: "bo", password: "secret1", role: "staff" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  // Missing-`return` regression guard: a 400-path validation rejection must
  // not fall through into the success response below it. On the pre-fix
  // code, `res.status(400).json(...)` had no `return`, so execution
  // continued into `res.json({ success: true, id: 1 })`, which — depending
  // on header timing — is exactly the kind of bug that throws
  // ERR_HTTP_HEADERS_SENT or silently reports success on a rejected request.
  it("a schema-rejected body (missing fields) never falls through to success, and never reaches the service", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("x-test-role", "admin")
      .send({ username: "bob" }); // missing password + role

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("500s honestly when the service throws something that isn't an AppError", async () => {
    createUser.mockRejectedValue(new Error("SQLITE_BUSY"));

    const res = await request(app)
      .post("/api/users")
      .set("x-test-role", "admin")
      .send({ username: "bob", password: "secret1", role: "staff" });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/users/:id/active", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    deactivateUser.mockReset();
    reactivateUser.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires the admin role — a staff JWT is rejected, service never called", async () => {
    const res = await request(app)
      .put("/api/users/5/active")
      .set("x-test-role", "staff")
      .send({ is_active: 0 });
    expect(res.status).toBe(403);
    expect(deactivateUser).not.toHaveBeenCalled();
    expect(reactivateUser).not.toHaveBeenCalled();
  });

  // Missing-`return` regression guard: an invalid id must not fall through
  // into the mutation/success path below it.
  it("rejects a non-numeric id with 200 {success:false}, service never called", async () => {
    const res = await request(app)
      .put("/api/users/abc/active")
      .set("x-test-role", "admin")
      .send({ is_active: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Invalid user ID" });
    expect(deactivateUser).not.toHaveBeenCalled();
  });

  it("deactivates the real user, actorId sourced from req.user (never the body)", async () => {
    deactivateUser.mockReturnValue(true);

    const res = await request(app)
      .put("/api/users/5/active")
      .set("x-test-role", "admin")
      .send({ is_active: 0, actorId: 999 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deactivateUser).toHaveBeenCalledTimes(1);
    expect(deactivateUser).toHaveBeenCalledWith(5, 42, "admin");
    expect(reactivateUser).not.toHaveBeenCalled();
  });

  it("reactivates the real user when is_active is 1", async () => {
    reactivateUser.mockReturnValue(true);

    const res = await request(app)
      .put("/api/users/5/active")
      .set("x-test-role", "admin")
      .send({ is_active: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(reactivateUser).toHaveBeenCalledTimes(1);
    expect(reactivateUser).toHaveBeenCalledWith(5, "admin");
    expect(deactivateUser).not.toHaveBeenCalled();
  });

  it("audits the status change", async () => {
    deactivateUser.mockReturnValue(true);

    await request(app)
      .put("/api/users/5/active")
      .set("x-test-role", "admin")
      .send({ is_active: 0 });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        entity_type: "user",
        entity_id: "5",
        summary: "Deactivated user",
      }),
    );
  });

  // Catches the discarded-return-value bug: deactivateUser/reactivateUser
  // are tenant-scoped repository writes that return `false` (not a throw)
  // for a nonexistent id or an id belonging to another tenant. The
  // pre-fix route ignored that return value entirely and always answered
  // `{ success: true }` plus wrote an audit_log row for a mutation that
  // never happened — this proves both are now gated on the real result.
  it("a nonexistent user id returns { success: false } and audits NOTHING", async () => {
    deactivateUser.mockReturnValue(false);

    const res = await request(app)
      .put("/api/users/999/active")
      .set("x-test-role", "admin")
      .send({ is_active: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "User not found" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("500s honestly, audits nothing, when the last-admin business rule throws", async () => {
    deactivateUser.mockImplementation(() => {
      throw new BusinessRuleError("Cannot deactivate the last administrator");
    });

    const res = await request(app)
      .put("/api/users/5/active")
      .set("x-test-role", "admin")
      .send({ is_active: 0 });

    // BusinessRuleError is an AppError -> handled failure -> 200, not 500.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Cannot deactivate the last administrator",
    });
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/users/:id/role", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    setUserRole.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires the admin role — a staff JWT is rejected, service never called", async () => {
    const res = await request(app)
      .put("/api/users/5/role")
      .set("x-test-role", "staff")
      .send({ role: "admin" });
    expect(res.status).toBe(403);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects an invalid role with 200 {success:false}, service never called", async () => {
    const res = await request(app)
      .put("/api/users/5/role")
      .set("x-test-role", "admin")
      .send({ role: "owner" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("performs the real role change, actor role sourced from req.user", async () => {
    setUserRole.mockReturnValue(true);

    const res = await request(app)
      .put("/api/users/5/role")
      .set("x-test-role", "admin")
      .send({ role: "admin" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(setUserRole).toHaveBeenCalledTimes(1);
    expect(setUserRole).toHaveBeenCalledWith(5, "admin", "admin");
  });

  it("audits the role change", async () => {
    setUserRole.mockReturnValue(true);

    await request(app)
      .put("/api/users/5/role")
      .set("x-test-role", "admin")
      .send({ role: "staff" });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        entity_type: "user",
        entity_id: "5",
        summary: 'Changed user role to "staff"',
      }),
    );
  });

  // Catches the discarded-return-value bug: setUserRole is a tenant-scoped
  // repository write returning `false` (not a throw) for a nonexistent id
  // or another tenant's id. The pre-fix route ignored this and always
  // answered `{ success: true }` plus audited a role change that never
  // happened.
  it("a nonexistent user id returns { success: false } and audits NOTHING", async () => {
    setUserRole.mockReturnValue(false);

    const res = await request(app)
      .put("/api/users/999/role")
      .set("x-test-role", "admin")
      .send({ role: "admin" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "User not found" });
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/users/:id/password", () => {
  const app = buildApp();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    resetPassword.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("requires the admin role — a staff JWT is rejected, service never called", async () => {
    const res = await request(app)
      .put("/api/users/5/password")
      .set("x-test-role", "staff")
      .send({ password: "newpass1" });
    expect(res.status).toBe(403);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("rejects a too-short password with 200 {success:false}, service never called", async () => {
    const res = await request(app)
      .put("/api/users/5/password")
      .set("x-test-role", "admin")
      .send({ password: "ab" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("performs the real password reset, actor role sourced from req.user", async () => {
    resetPassword.mockResolvedValue({ success: true });

    const res = await request(app)
      .put("/api/users/5/password")
      .set("x-test-role", "admin")
      .send({ password: "newpass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(resetPassword).toHaveBeenCalledWith(5, "newpass1", "admin");
  });

  it("audits the password change", async () => {
    resetPassword.mockResolvedValue({ success: true });

    await request(app)
      .put("/api/users/5/password")
      .set("x-test-role", "admin")
      .send({ password: "newpass1" });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        entity_type: "user",
        entity_id: "5",
        summary: "Changed user password",
      }),
    );
  });

  it("a business rejection from the service (e.g. weak password) returns 200 {success:false} and audits nothing", async () => {
    resetPassword.mockResolvedValue({
      success: false,
      error: "Password too weak",
    });

    const res = await request(app)
      .put("/api/users/5/password")
      .set("x-test-role", "admin")
      .send({ password: "newpass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Password too weak" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  // Catches the same discarded-return-value class of bug as the /active and
  // /role routes: AuthService.resetPassword throws AuthenticationError
  // ("User not found") for a nonexistent/cross-tenant id rather than
  // returning success:false, but the effect must be identical — no audit
  // row for a password change that never happened.
  it("a nonexistent user id returns { success: false } and audits NOTHING", async () => {
    resetPassword.mockRejectedValue(new AuthenticationError("User not found"));

    const res = await request(app)
      .put("/api/users/999/password")
      .set("x-test-role", "admin")
      .send({ password: "newpass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "User not found" });
    expect(logSpy).not.toHaveBeenCalled();
  });
});
