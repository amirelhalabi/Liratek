/**
 * Service Providers REST route tests — FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md
 * §5b phase 4a.
 *
 * Pattern mirrors partners.api.test.ts: the REAL router (../serviceProviders.js)
 * with only ../../middleware/auth.js faked (header-driven `x-test-role`);
 * ServiceProviderService is the REAL singleton with `listActive` stubbed via
 * `jest.spyOn` so we can assert on the exact response shape without a DB.
 */

import { jest } from "@jest/globals";

// ../server.js would boot dotenv + the HTTP listener + a real DB connection
// (it also uses `import.meta.url`, which Jest's CJS transform can't parse) —
// mirrors suppliers.api.test.ts's stub, which only needs `logger` from it.
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
import { getServiceProviderService } from "@liratek/core";
import serviceProvidersRouter from "../serviceProviders.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/service-providers", serviceProvidersRouter);
  return app;
}

describe("Service Providers REST routes — §5b phase 4a", () => {
  let app: Express;
  const service = getServiceProviderService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("GET /api/service-providers/active", () => {
    it("returns the active providers from the service in the IPC-identical envelope", async () => {
      const providers = [
        {
          id: 1,
          code: "OMT",
          label: "OMT",
          drawer_name: "OMT_System",
          is_system_provider: 1,
          sort_order: 0,
          is_active: 1,
          is_system: 1,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
      ];
      const spy = jest
        .spyOn(service, "listActive")
        .mockReturnValue(providers as any);

      const res = await request(app)
        .get("/api/service-providers/active")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, providers });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("rejects with 401 when no auth is provided", async () => {
      const res = await request(app).get("/api/service-providers/active");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("allows any authenticated role (no requireRole gate — mirrors the IPC handler, which is also open to any role)", async () => {
      jest.spyOn(service, "listActive").mockReturnValue([] as any);

      const staffRes = await request(app)
        .get("/api/service-providers/active")
        .set("x-test-role", "staff");
      expect(staffRes.status).toBe(200);
      expect(staffRes.body.success).toBe(true);

      const adminRes = await request(app)
        .get("/api/service-providers/active")
        .set("x-test-role", "admin");
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.success).toBe(true);
    });

    it("returns 500 with success:false if the service throws", async () => {
      jest.spyOn(service, "listActive").mockImplementation(() => {
        throw new Error("boom");
      });

      const res = await request(app)
        .get("/api/service-providers/active")
        .set("x-test-role", "staff");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });
  });
});
