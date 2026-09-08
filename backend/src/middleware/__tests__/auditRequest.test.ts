/**
 * Web-transport audit trail (middleware/auditRequest.ts).
 *
 * Builds a minimal Express app around the REAL middleware and spies on the
 * REAL AuditService singleton's `log` (backed by jest.setup.ts's mock DB), so
 * these assert the middleware's actual behaviour rather than a reimplementation
 * of it.
 *
 * Rule 17 — proven to fail on the pre-fix code: with `app.use(auditRequest)`
 * removed from buildApp(), "records a row for a successful mutating request"
 * fails with 0 calls instead of 1. That is precisely the bug this closes: 146
 * audit call sites on the desktop IPC side, zero on REST.
 */

import { jest } from "@jest/globals";
import express, { type Express, type Request } from "express";
import request from "supertest";
import { getAuditService } from "@liratek/core";
import { auditRequest } from "../auditRequest.js";

interface TestUser {
  userId: number;
  username: string;
  role: "super_admin" | "admin" | "staff";
  tenantId: number | null;
  sessionToken: string;
  impersonatorId?: number;
}

const DEFAULT_USER: TestUser = {
  userId: 42,
  username: "tester",
  role: "admin",
  tenantId: 1,
  sessionToken: "test-session",
};

/**
 * `user: null` simulates an unauthenticated request (no router-level
 * authenticateJWT ran), which is how the exempt/anonymous paths behave.
 */
function buildApp(user: TestUser | null = DEFAULT_USER): Express {
  const app = express();
  app.use(express.json());

  if (user) {
    app.use((req: Request, _res, next) => {
      (req as Request & { user?: TestUser }).user = user;
      next();
    });
  }

  app.use(auditRequest);

  app.post("/api/sales/process", (_req, res) => {
    res.json({ success: true, id: 7 });
  });
  app.post("/api/sales/rejected", (_req, res) => {
    // The REST envelope returns HTTP 200 even on failure, to match IPC.
    res.json({ success: false, error: "insufficient stock" });
  });
  app.post("/api/sales/errored", (_req, res) => {
    res.status(500).json({ success: false, error: "boom" });
  });
  app.get("/api/sales/list", (_req, res) => {
    res.json({ success: true, rows: [] });
  });
  app.delete("/api/drawer-topup/9", (_req, res) => {
    res.json({ success: true });
  });
  app.post("/api/auth/login", (_req, res) => {
    res.json({ success: true, token: "jwt-here" });
  });

  return app;
}

describe("auditRequest middleware", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest
      .spyOn(getAuditService(), "log")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("records a row for a successful mutating request", async () => {
    await request(buildApp())
      .post("/api/sales/process")
      .send({ total: 25, status: "completed" })
      .expect(200);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const row = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.user_id).toBe(42);
    expect(row.username).toBe("tester");
    expect(row.role).toBe("admin");
    expect(row.action).toBe("create");
    expect(row.entity_type).toBe("sales");
    expect(row.summary).toBe("POST /api/sales/process");
  });

  it("marks the row as middleware-generated so it is not mistaken for a semantic entry", async () => {
    await request(buildApp()).post("/api/sales/process").send({ total: 1 });

    const meta = (logSpy.mock.calls[0]![0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.audit_source).toBe("http-middleware");
    expect(meta.transport).toBe("web");
    expect(meta.method).toBe("POST");
    expect(meta.status).toBe(200);
  });

  it("maps the HTTP verb to desktop's lowercase action vocabulary", async () => {
    await request(buildApp()).delete("/api/drawer-topup/9");

    const row = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.action).toBe("delete");
    // Hyphens become underscores to match entity_type conventions.
    expect(row.entity_type).toBe("drawer_topup");
  });

  it("NEVER writes a password or token into the audit row", async () => {
    await request(buildApp())
      .post("/api/sales/process")
      .send({
        adminPassword: "sup3r-s3cret",
        nested: { new_password: "also-secret", sessionToken: "tok" },
        total: 25,
      });

    const serialized = JSON.stringify(logSpy.mock.calls[0]![0]);
    expect(serialized).not.toContain("sup3r-s3cret");
    expect(serialized).not.toContain("also-secret");
    expect(serialized).toContain("[REDACTED]");
    // Non-sensitive fields still survive, or the trail would be useless.
    expect(serialized).toContain("25");
  });

  it("does not record a mutation the server rejected", async () => {
    await request(buildApp()).post("/api/sales/rejected").send({ total: 1 });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does not record a request that errored with a 5xx", async () => {
    await request(buildApp()).post("/api/sales/errored").send({ total: 1 });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("ignores reads", async () => {
    await request(buildApp()).get("/api/sales/list").expect(200);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("skips /api/auth/* — those routes have no req.user to attribute", async () => {
    await request(buildApp())
      .post("/api/auth/login")
      .send({ username: "x", password: "y" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("writes nothing when the request is unauthenticated", async () => {
    await request(buildApp(null)).post("/api/sales/process").send({ total: 1 });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("preserves the real actor when a super admin is impersonating a tenant", async () => {
    await request(
      buildApp({ ...DEFAULT_USER, role: "admin", impersonatorId: 1 }),
    )
      .post("/api/sales/process")
      .send({ total: 1 });

    const row = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.impersonator_id).toBe(1);
    expect(row.user_id).toBe(42);
  });

  it("defaults impersonator_id to null for a normal write", async () => {
    await request(buildApp()).post("/api/sales/process").send({ total: 1 });
    const row = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.impersonator_id).toBeNull();
  });

  it("does not break the response when the audit write throws", async () => {
    logSpy.mockImplementation(() => {
      throw new Error("audit table is on fire");
    });

    // The mutation must still succeed: audit is fire-and-forget.
    const res = await request(buildApp())
      .post("/api/sales/process")
      .send({ total: 25 })
      .expect(200);
    expect(res.body).toEqual({ success: true, id: 7 });
  });
});
