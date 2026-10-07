/**
 * POST /api/custom-services must ignore a client-sent `deferPayment`.
 *
 * `deferPayment: true` tells CustomServiceRepository.createService that a
 * session basket owns the customer's payment, so it skips the selling-price
 * refusal and every customer-cash posting (no drawer leg, no debt). Only the
 * server-side session checkout replay may set it. Before the fix the core
 * `createCustomServiceSchema` accepted the key, `validateRequest` kept it in
 * `req.body`, and the route handed it straight to `addService` — so a request
 * crafted outside the app booked a service that collected nothing.
 *
 * Same harness as customServicesUpdateMetadata.api.test.ts: the REAL core
 * schema runs (jest maps @liratek/core to source), only the service is
 * stubbed, so this asserts what actually reaches `addService`.
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

const addService = jest.fn<(data: Record<string, unknown>) => unknown>();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getCustomServiceService: () => ({ addService }),
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

describe("POST /api/custom-services — deferPayment is server-only", () => {
  let app: Express;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    app = buildApp();
    addService.mockReset();
    addService.mockReturnValue({ success: true, id: 11 });
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("drops a client-sent deferPayment before calling the service", async () => {
    const res = await request(app)
      .post("/api/custom-services")
      .set("x-test-role", "admin")
      .send({ description: "Screen fix", cost_usd: 10, deferPayment: true });

    expect(res.status).toBe(200);
    expect(addService).toHaveBeenCalledTimes(1);
    const passed = addService.mock.calls[0][0];
    expect(passed.description).toBe("Screen fix");
    expect(passed).not.toHaveProperty("deferPayment");
  });
});
