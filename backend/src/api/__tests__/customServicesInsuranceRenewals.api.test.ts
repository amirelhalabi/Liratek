/**
 * LIRA-360 — the insurance renewal routes, mirroring the IPC channels:
 * GET /insurance-renewals passes the browser's `client_day` (rule 27) and
 * returns the list; POST /insurance-renewals/:id/dismiss is admin + staff,
 * takes the actor from the JWT, never the body, and is matched before /:id.
 *
 * Not proven failing-first (rule 17): written after the routes were wired.
 * Mock pattern copied from customServicesDelete.api.test.ts.
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

const getInsuranceRenewals = jest.fn();
const dismissInsuranceRenewal = jest.fn();
const getServiceById = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getCustomServiceService: () => ({
      getInsuranceRenewals,
      dismissInsuranceRenewal,
      getServiceById,
    }),
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

describe("LIRA-360 insurance renewal routes", () => {
  let app: Express;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    app = buildApp();
    getInsuranceRenewals.mockReset();
    dismissInsuranceRenewal.mockReset();
    getServiceById.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("lists renewals for the browser's day, for staff too", async () => {
    getInsuranceRenewals.mockReturnValue([{ id: 3, days_left: 5 }]);
    const res = await request(app)
      .get("/api/custom-services/insurance-renewals?client_day=2026-10-29")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, renewals: [{ id: 3, days_left: 5 }] });
    expect(getInsuranceRenewals).toHaveBeenCalledWith("2026-10-29");
    expect(getServiceById).not.toHaveBeenCalled();
  });

  it("falls back to a day of its own when client_day is malformed", async () => {
    getInsuranceRenewals.mockReturnValue([]);
    const res = await request(app)
      .get("/api/custom-services/insurance-renewals?client_day=yesterday")
      .set("x-test-role", "admin");
    expect(res.body.success).toBe(true);
    expect(getInsuranceRenewals).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("dismisses with the JWT user as the actor", async () => {
    dismissInsuranceRenewal.mockReturnValue({ success: true });
    const res = await request(app)
      .post("/api/custom-services/insurance-renewals/9/dismiss")
      .set("x-test-role", "staff")
      .send({ username: "someone-else" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(dismissInsuranceRenewal).toHaveBeenCalledWith(9, "tester");
  });

  it("refuses a bad id with HTTP 200 + success:false", async () => {
    const res = await request(app)
      .post("/api/custom-services/insurance-renewals/abc/dismiss")
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(dismissInsuranceRenewal).not.toHaveBeenCalled();
  });

  it("passes the service's refusal through", async () => {
    dismissInsuranceRenewal.mockReturnValue({
      success: false,
      error: "This insurance is not on the renewal list",
    });
    const res = await request(app)
      .post("/api/custom-services/insurance-renewals/9/dismiss")
      .set("x-test-role", "admin");
    expect(res.body).toEqual({
      success: false,
      error: "This insurance is not on the renewal list",
    });
  });
});
