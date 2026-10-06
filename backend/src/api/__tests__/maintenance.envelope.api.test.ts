/**
 * /api/maintenance — a service REFUSAL answers HTTP 200 with the
 * IPC-identical envelope `{ success: false, error }` (CLAUDE.md rule 19c,
 * LIRA-263). The adapter (`backendApi.saveMaintenanceJob` /
 * `deleteMaintenanceJob`) branches on `result.success`, and `requestJson`
 * throws on a non-2xx status — so the old HTTP 400 turned a readable refusal
 * ("already paid — refund it first") into a thrown error on the web app
 * only, while desktop showed the message.
 *
 * Harness copied from maintenanceSave.roleGate.api.test.ts.
 *
 * Rule 17: written before the route fix and run against the unfixed route —
 * both cases failed with `expect(res.status).toBe(200)` receiving 400.
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

const ALREADY_PAID =
  "This job is already paid. Refund it first to change the payment.";

describe("/api/maintenance — refusals use the IPC envelope at HTTP 200", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("POST /jobs refused by the service (already paid) → 200 + success:false", async () => {
    jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: false, error: ALREADY_PAID } as any);

    const res = await request(app)
      .post("/api/maintenance/jobs")
      .set("x-test-role", "staff")
      .send({ id: 7, device_name: "iPhone 13", price_usd: 50 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: ALREADY_PAID });
  });

  it("DELETE /jobs/:id refused by the service → 200 + success:false", async () => {
    jest.spyOn(MaintenanceService.prototype, "deleteJob").mockReturnValue({
      success: false,
      error: "Cannot delete a paid job",
    } as any);

    const res = await request(app)
      .delete("/api/maintenance/jobs/7")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Cannot delete a paid job",
    });
  });

  it("DELETE /jobs/:id with a non-numeric id → 200 + success:false", async () => {
    const res = await request(app)
      .delete("/api/maintenance/jobs/abc")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Invalid job ID" });
  });
});
