/**
 * LIRA-178 — settings REST role-gate regression test.
 *
 * `PUT /api/settings/:key` used to have `authenticateJWT` but NO
 * `requireRole`, so any authenticated role (staff included) could write ANY
 * row in `system_settings` over REST — a rule-19c parity break against the
 * IPC twins `db:update-setting` / `settings:update`
 * (electron-app/handlers/dbHandlers.ts), which both gate on
 * requireRole(["admin"]).
 *
 * Follows the harness in `../__tests__/profitsGate.api.test.ts`: hits the
 * REAL router (../settings.js) through a minimal Express app, faking only
 * ../../server.js (logger) and ../../middleware/auth.js (x-test-role
 * stand-in for authenticateJWT/requireRole). SettingsService is the REAL
 * singleton with its methods stubbed via jest.spyOn — this proves the route
 * wires the exact role/envelope/status-code contract, without a real DB
 * round trip.
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
import { getSettingsService, PROFITS_PASSWORD_SETTING_KEY } from "@liratek/core";
import settingsRouter from "../settings.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  return app;
}

describe("LIRA-178: settings REST role gate", () => {
  let app: Express;
  const settingsService = getSettingsService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("PUT /api/settings/:key", () => {
    it("staff gets 403 and the setting is NOT written", async () => {
      const updateSpy = jest.spyOn(settingsService, "updateSetting");

      const res = await request(app)
        .put("/api/settings/setup_complete")
        .set("x-test-role", "staff")
        .send({ value: "0" });

      expect(res.status).toBe(403);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("admin succeeds and the service is called with the write", async () => {
      const updateSpy = jest
        .spyOn(settingsService, "updateSetting")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .put("/api/settings/setup_complete")
        .set("x-test-role", "admin")
        .send({ value: "1" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(updateSpy).toHaveBeenCalledWith("setup_complete", "1");
    });

    it("unauthenticated request gets 401", async () => {
      const updateSpy = jest.spyOn(settingsService, "updateSetting");

      const res = await request(app)
        .put("/api/settings/setup_complete")
        .send({ value: "0" });

      expect(res.status).toBe(401);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("the SENSITIVE_SETTING_KEYS write guard still rejects an admin write to the profits password key (independent of the role fix)", async () => {
      // Real SettingsService.updateSetting, not stubbed: prove the
      // service-level guard (SettingsService.ts) still applies even though
      // the caller now clears the admin role check.
      const res = await request(app)
        .put(`/api/settings/${PROFITS_PASSWORD_SETTING_KEY}`)
        .set("x-test-role", "admin")
        .send({ value: "some-hash" });

      expect(res.status).toBe(200); // envelope failure, not HTTP failure
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/settings/:key (sanity — not over-tightened)", () => {
    it("staff can still read a setting", async () => {
      jest.spyOn(settingsService, "getSetting").mockReturnValue({
        id: 1,
        key_name: "shop_base_system",
        value: "OMT",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      } as any);

      const res = await request(app)
        .get("/api/settings/shop_base_system")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
