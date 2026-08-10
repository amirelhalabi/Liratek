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

  // §5b phase 5 — the write path. ServiceProviderRepository's create/update/
  // delete existed since phase 1 but nothing exposed them; these routes are
  // that exposure's web-transport half (electron-app/handlers/
  // serviceProviderHandlers.ts is the IPC half). Every write is gated
  // requireRole(["admin"]) — mirrors paymentMethods.ts exactly.

  describe("GET /api/service-providers (admin listing, includes inactive/system)", () => {
    it("returns ALL providers from the service in the IPC-identical envelope, any role", async () => {
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
      const spy = jest.spyOn(service, "listAll").mockReturnValue(providers as any);

      const res = await request(app)
        .get("/api/service-providers")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, providers });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("rejects with 401 when no auth is provided", async () => {
      const res = await request(app).get("/api/service-providers");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/service-providers (create, admin only)", () => {
    it("creates a provider and returns 201 with the IPC-identical envelope", async () => {
      const spy = jest
        .spyOn(service, "createProvider")
        .mockReturnValue({ success: true, id: 42 });

      const res = await request(app)
        .post("/api/service-providers")
        .set("x-test-role", "admin")
        .send({ code: "SYRIA", label: "Syria" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, id: 42 });
      expect(spy).toHaveBeenCalledWith({ code: "SYRIA", label: "Syria" });
    });

    it("rejects a non-admin (staff) with 403 before the service is ever called", async () => {
      const spy = jest.spyOn(service, "createProvider");

      const res = await request(app)
        .post("/api/service-providers")
        .set("x-test-role", "staff")
        .send({ code: "SYRIA", label: "Syria" });

      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a payload with drawer_name — the shared Zod schema does not accept the field (money-safety: only General is ever allowed, and it's never client-settable)", async () => {
      const spy = jest.spyOn(service, "createProvider");

      const res = await request(app)
        .post("/api/service-providers")
        .set("x-test-role", "admin")
        .send({ code: "SYRIA", label: "Syria", drawer_name: "Whish_System" });

      // Zod's .object() strips unknown keys by default rather than
      // rejecting — so this is CALLED, but proves the extra field never
      // reaches the service, which is what actually matters for the
      // money-safety invariant.
      if (spy.mock.calls.length > 0) {
        expect(spy.mock.calls[0][0]).not.toHaveProperty("drawer_name");
      } else {
        expect(res.body.success).toBe(false);
      }
    });

    it("rejects an empty code with the rule-19c envelope (HTTP 200, success:false)", async () => {
      const spy = jest.spyOn(service, "createProvider");

      const res = await request(app)
        .post("/api/service-providers")
        .set("x-test-role", "admin")
        .send({ code: "", label: "Syria" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a code containing whitespace with the rule-19c envelope", async () => {
      const spy = jest.spyOn(service, "createProvider");

      const res = await request(app)
        .post("/api/service-providers")
        .set("x-test-role", "admin")
        .send({ code: "SY RIA", label: "Syria" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 400 with the service's error when creation fails (e.g. duplicate code)", async () => {
      jest.spyOn(service, "createProvider").mockReturnValue({
        success: false,
        error: "Service provider code 'SYRIA' already exists",
      });

      const res = await request(app)
        .post("/api/service-providers")
        .set("x-test-role", "admin")
        .send({ code: "SYRIA", label: "Syria" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Service provider code 'SYRIA' already exists",
      });
    });
  });

  describe("PUT /api/service-providers/:id (update, admin only)", () => {
    it("updates a provider and returns the IPC-identical envelope", async () => {
      const spy = jest
        .spyOn(service, "updateProvider")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .put("/api/service-providers/7")
        .set("x-test-role", "admin")
        .send({ label: "Syria Remit", is_active: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith(7, { label: "Syria Remit", is_active: 0 });
    });

    it("rejects a non-admin (staff) with 403 before the service is ever called", async () => {
      const spy = jest.spyOn(service, "updateProvider");

      const res = await request(app)
        .put("/api/service-providers/7")
        .set("x-test-role", "staff")
        .send({ label: "Nope" });

      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("strips code/drawer_name/is_system_provider from the body before the service ever sees it (the shared Zod schema does not declare them)", async () => {
      const spy = jest
        .spyOn(service, "updateProvider")
        .mockReturnValue({ success: true });

      await request(app)
        .put("/api/service-providers/7")
        .set("x-test-role", "admin")
        .send({
          label: "Syria Remit",
          code: "HACKED",
          drawer_name: "Whish_System",
          is_system_provider: 1,
        });

      expect(spy).toHaveBeenCalledWith(7, { label: "Syria Remit" });
    });

    it("returns 400 with the service's error when update fails (e.g. not found)", async () => {
      jest.spyOn(service, "updateProvider").mockReturnValue({
        success: false,
        error: "Service provider not found",
      });

      const res = await request(app)
        .put("/api/service-providers/9999")
        .set("x-test-role", "admin")
        .send({ label: "Nope" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Service provider not found",
      });
    });
  });

  describe("DELETE /api/service-providers/:id (delete, admin only)", () => {
    it("deletes a non-system provider and returns the IPC-identical envelope", async () => {
      const spy = jest
        .spyOn(service, "deleteProvider")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .delete("/api/service-providers/7")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith(7);
    });

    it("rejects a non-admin (staff) with 403 before the service is ever called", async () => {
      const spy = jest.spyOn(service, "deleteProvider");

      const res = await request(app)
        .delete("/api/service-providers/7")
        .set("x-test-role", "staff");

      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 400 with the service's error for a system provider (cannot delete OMT/WHISH/etc.)", async () => {
      jest.spyOn(service, "deleteProvider").mockReturnValue({
        success: false,
        error: "Cannot delete system service provider",
      });

      const res = await request(app)
        .delete("/api/service-providers/1")
        .set("x-test-role", "admin");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Cannot delete system service provider",
      });
    });
  });
});
