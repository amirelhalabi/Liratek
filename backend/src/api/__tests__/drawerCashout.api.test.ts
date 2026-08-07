/**
 * Drawer cash-out REST route tests — HTTP twin of
 * electron-app/handlers/drawerCashoutHandlers.ts (see drawerCashout.ts).
 *
 * Pattern mirrors partners.api.test.ts / suppliers.api.test.ts / debts.api.test.ts:
 * the REAL router (../drawerCashout.js) with only ../../middleware/auth.js
 * faked (header-driven `x-test-role`); DrawerCashoutService is the REAL
 * singleton with `addCashout`/`getHistory` stubbed via `jest.spyOn` so we can
 * assert on the exact argument the route builds and on the envelope shape.
 *
 * Admin-ONLY gate (stricter than Drawer Top-Up's admin+staff) is the one
 * behavior specific to this route worth a dedicated assertion — a staff
 * token must be rejected with 403 and must never reach the service.
 */

import { jest } from "@jest/globals";

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 7,
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
import { getDrawerCashoutService } from "@liratek/core";
import drawerCashoutRouter from "../drawerCashout.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/drawer-cashout", drawerCashoutRouter);
  return app;
}

describe("Drawer cash-out REST routes", () => {
  let app: Express;
  const drawerCashoutService = getDrawerCashoutService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("POST /api/drawer-cashout", () => {
    it("admin can cash out — validated payload passes through to the service with the JWT userId injected", async () => {
      const spy = jest
        .spyOn(drawerCashoutService, "addCashout")
        .mockReturnValue({ success: true, id: 1 });

      const res = await request(app)
        .post("/api/drawer-cashout")
        .set("x-test-role", "admin")
        .send({ amount_usd: 50, notes: "Owner withdrawal" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 1 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ amount_usd: 50, notes: "Owner withdrawal" }),
        7,
      );
    });

    it("staff is rejected with 403 and never reaches the service (admin-only, stricter than top-up)", async () => {
      const spy = jest.spyOn(drawerCashoutService, "addCashout");

      const res = await request(app)
        .post("/api/drawer-cashout")
        .set("x-test-role", "staff")
        .send({ amount_usd: 50, notes: "Owner withdrawal" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects (never reaches the service) when notes is missing — rule 19c: 200 + string error", async () => {
      const spy = jest.spyOn(drawerCashoutService, "addCashout");

      const res = await request(app)
        .post("/api/drawer-cashout")
        .set("x-test-role", "admin")
        .send({ amount_usd: 50 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects (never reaches the service) when both amounts are zero — rule 19c: 200 + string error", async () => {
      const spy = jest.spyOn(drawerCashoutService, "addCashout");

      const res = await request(app)
        .post("/api/drawer-cashout")
        .set("x-test-role", "admin")
        .send({ amount_usd: 0, amount_lbp: 0, notes: "Owner withdrawal" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("surfaces a service-level failure (e.g. insufficient funds) verbatim with HTTP 200", async () => {
      jest.spyOn(drawerCashoutService, "addCashout").mockReturnValue({
        success: false,
        error: "Insufficient funds in General drawer (USD).",
      });

      const res = await request(app)
        .post("/api/drawer-cashout")
        .set("x-test-role", "admin")
        .send({ amount_usd: 999999, notes: "Owner withdrawal" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "Insufficient funds in General drawer (USD).",
      });
    });
  });

  describe("GET /api/drawer-cashout/history", () => {
    it("returns { success: true, data } from the service", async () => {
      const history = [
        {
          id: 1,
          amount_usd: 50,
          amount_lbp: 0,
          notes: "Owner withdrawal",
          user_id: 7,
          created_at: "2026-07-21T00:00:00.000Z",
          updated_at: "2026-07-21T00:00:00.000Z",
        },
      ];
      jest
        .spyOn(drawerCashoutService, "getHistory")
        .mockReturnValue(history as any);

      const res = await request(app)
        .get("/api/drawer-cashout/history")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: history });
    });

    it("passes a numeric ?limit= through to the service", async () => {
      const spy = jest
        .spyOn(drawerCashoutService, "getHistory")
        .mockReturnValue([]);

      const res = await request(app)
        .get("/api/drawer-cashout/history?limit=5")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(5);
    });
  });
});
