/**
 * LIRA-306 (rule 23 lift) — `DELETE /api/custom-services/:id` validates the
 * id with the SAME core `customServiceIdParamSchema` the
 * `custom-services:delete` IPC handler and offline recording use. A bad id
 * answers HTTP 200 + { success:false } (rule 19c) without touching the
 * service; a good one reaches `deleteService` as a NUMBER.
 *
 * Not proven failing-first (rule 17): written after the route was wired.
 * Mock pattern copied from customServicesUpdateMetadata.api.test.ts.
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

const deleteService = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getCustomServiceService: () => ({ deleteService }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import { getAuditService } from "@liratek/core";
import customServicesRoutes from "../customServices.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/custom-services", customServicesRoutes);
  return app;
}

describe("DELETE /api/custom-services/:id — shared id schema", () => {
  let app: Express;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    app = buildApp();
    deleteService.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("passes the id to the service as a number", async () => {
    deleteService.mockReturnValue({ success: true });
    const res = await request(app).delete("/api/custom-services/17").set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteService).toHaveBeenCalledWith(17);
  });

  it.each(["abc", "0", "-3", "1.5"])("refuses id %s with HTTP 200 + success:false", async (bad) => {
    const res = await request(app).delete(`/api/custom-services/${bad}`).set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(deleteService).not.toHaveBeenCalled();
  });

  it("stays admin-only", async () => {
    const res = await request(app).delete("/api/custom-services/17").set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(deleteService).not.toHaveBeenCalled();
  });
});
