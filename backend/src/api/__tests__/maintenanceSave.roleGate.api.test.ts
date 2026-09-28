/**
 * POST /api/maintenance/jobs — role gate (LIRA-242, owner decision
 * 2026-09-28).
 *
 * A real web-app test found staff refused with a 403 and an uncaught page
 * error when creating a repair job or changing its status — both go through
 * this ONE route (`MaintenanceService.saveJob` handles create/update/status
 * transition alike). The owner decided staff MAY create and advance repair
 * jobs; only DELETE (voiding a job) stays admin-only.
 *
 * Follows the harness in `../__tests__/expensesDelete.api.test.ts`: hits the
 * REAL router (`../maintenance.js`) through a minimal Express app, faking
 * only `../../server.js` (logger), `../../middleware/audit.js` (auditRest)
 * and `../../middleware/auth.js` (an `x-test-role` stand-in for
 * `authenticateJWT`). `MaintenanceService.prototype.saveJob` is stubbed via
 * `jest.spyOn` — the route constructs its own instance at module load, so
 * spying on the prototype is the only way to intercept it without changing
 * production code to accept an injected instance.
 *
 * Rule 17: proven to fail against the pre-fix route (`requireRole(["admin"])`)
 * — the staff-role case got HTTP 403 and the service was never called.
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

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
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
import { MaintenanceService } from "@liratek/core";
import maintenanceRouter from "../maintenance.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", maintenanceRouter);
  return app;
}

describe("POST /api/maintenance/jobs — role gate (LIRA-242)", () => {
  let app: Express;

  const validBody = {
    device_name: "iPhone 13",
    price_usd: 50,
  };

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("staff CAN create/save a job — reaches the service with the JWT-derived actor id (LIRA-246a)", async () => {
    const saveSpy = jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: true, id: 7 } as any);

    const res = await request(app)
      .post("/api/maintenance/jobs")
      .set("x-test-role", "staff")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 7 });
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ device_name: "iPhone 13" }),
      42, // req.user.userId from the JWT — never trusted from the body
    );
  });

  it("admin can still create/save a job (unchanged)", async () => {
    const saveSpy = jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: true, id: 8 } as any);

    const res = await request(app)
      .post("/api/maintenance/jobs")
      .set("x-test-role", "admin")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 8 });
    expect(saveSpy).toHaveBeenCalled();
  });

  it("a role outside admin/staff is refused with 403, service never called", async () => {
    const saveSpy = jest.spyOn(MaintenanceService.prototype, "saveJob");

    const res = await request(app)
      .post("/api/maintenance/jobs")
      .set("x-test-role", "viewer")
      .send(validBody);

    expect(res.status).toBe(403);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("unauthenticated: 401, service never called", async () => {
    const saveSpy = jest.spyOn(MaintenanceService.prototype, "saveJob");

    const res = await request(app).post("/api/maintenance/jobs").send(validBody);

    expect(res.status).toBe(401);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/maintenance/jobs/:id — stays admin-only (unaffected by LIRA-242)", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("staff is refused with 403, service never called", async () => {
    const deleteSpy = jest.spyOn(MaintenanceService.prototype, "deleteJob");

    const res = await request(app)
      .delete("/api/maintenance/jobs/5")
      .set("x-test-role", "staff");

    expect(res.status).toBe(403);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("admin reaches the service (unchanged)", async () => {
    const deleteSpy = jest
      .spyOn(MaintenanceService.prototype, "deleteJob")
      .mockReturnValue({ success: true } as any);

    const res = await request(app)
      .delete("/api/maintenance/jobs/5")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalledWith(5);
  });
});
