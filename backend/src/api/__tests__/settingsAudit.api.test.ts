/**
 * LIRA-220 — settings REST audit coverage: no row for a rejected write, and
 * a redacted row (never the plaintext) if a `SENSITIVE_SETTING_KEYS` write
 * were ever to succeed through this route.
 *
 * `PUT /api/settings/:key` already returns before `auditRest(...)` when
 * `!result.success` (see the comment in `../settings.js`), so case 1 below
 * was already correct before this ticket — kept here as REST-side coverage,
 * not a rule-17 guard (nothing here was failing pre-fix). Case 2 IS a
 * rule-17 guard: `SettingsService.updateSetting` categorically rejects
 * `SENSITIVE_SETTING_KEYS` writes today, so the only way to exercise "a
 * sensitive write that succeeds" on this route is to stub the service — this
 * proves the REST transport is covered by the SAME write-time redaction in
 * `AuditService.log()` that the IPC transport relies on (rule 14: one
 * chokepoint, not a second copy of the predicate in `settings.ts`/
 * `auditRest`), as defense in depth if that categorical rejection is ever
 * loosened or bypassed.
 *
 * Pattern follows `auditRest.routes.test.ts`: real router + real
 * `AuditService` singleton with `.log` spied, only `server.js`/`auth.js`
 * faked.
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

import express, { type Express } from "express";
import request from "supertest";
import {
  getSettingsService,
  getAuditRepository,
  PROFITS_PASSWORD_SETTING_KEY,
} from "@liratek/core";
import settingsRouter from "../settings.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  return app;
}

describe("PUT /api/settings/:key — audit coverage (LIRA-220)", () => {
  let app: Express;
  // Spies on the REPOSITORY, not `AuditService.log()` itself: the
  // redaction under test happens INSIDE `AuditService.log()`'s body
  // (`AuditService.ts`'s `redactSensitiveAuditWrite`), so stubbing `log()`
  // wholesale (the `auditRest.routes.test.ts` pattern) would skip the very
  // code this test exists to exercise. Stubbing the repo's `.log()` instead
  // lets the real `AuditService.log()` run — including redaction — while
  // still avoiding a real DB write (the mocked better-sqlite3 stub would
  // accept it either way, but this keeps intent explicit and matches the
  // no-DB-round-trip style the sibling `settingsRoleGate.api.test.ts` uses).
  let repoLogSpy: ReturnType<typeof jest.spyOn>;
  const settingsService = getSettingsService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    repoLogSpy = jest
      .spyOn(getAuditRepository(), "log")
      .mockReturnValue(1);
  });

  it("a rejected sensitive-key write (real SettingsService guard) records no audit row", async () => {
    const res = await request(app)
      .put(`/api/settings/${PROFITS_PASSWORD_SETTING_KEY}`)
      .set("x-test-role", "admin")
      .send({ value: "attacker-supplied-hash" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(repoLogSpy).not.toHaveBeenCalled();
  });

  it("if a sensitive-key write ever succeeded, the audit row would still be redacted (defense in depth)", async () => {
    jest
      .spyOn(settingsService, "updateSetting")
      .mockReturnValue({ success: true });

    const res = await request(app)
      .put(`/api/settings/${PROFITS_PASSWORD_SETTING_KEY}`)
      .set("x-test-role", "admin")
      .send({ value: "SCRYPT:should-never-be-stored-in-plaintext" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(repoLogSpy).toHaveBeenCalledTimes(1);
    const written = repoLogSpy.mock.calls[0][0] as { new_values?: unknown };
    expect(JSON.stringify(written.new_values ?? "")).not.toContain(
      "SCRYPT:should-never-be-stored-in-plaintext",
    );
    expect(written.new_values).toEqual({ redacted: true });
  });

  it("a normal key's successful write is still audited with its real value", async () => {
    jest
      .spyOn(settingsService, "updateSetting")
      .mockReturnValue({ success: true });

    const res = await request(app)
      .put("/api/settings/shop_base_system")
      .set("x-test-role", "admin")
      .send({ value: "WHISH" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(repoLogSpy).toHaveBeenCalledTimes(1);
    expect(repoLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "setting",
        entity_id: "shop_base_system",
        new_values: { value: "WHISH" },
      }),
    );
  });
});
