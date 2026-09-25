/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183):
 * POST /api/hold-money/:id/collect moves from a bare id to a validated
 * body, and GET /:id/pickups + POST /pickups/:pickupId/void are brand new
 * routes — every assertion below fails against pre-fix code by
 * construction (rule 17).
 *
 * Hits the REAL router (../holdMoney.js) through a minimal Express app;
 * only ../../server.js (logger, if imported transitively) and
 * ../../middleware/auth.js are faked, mirroring closing.api.test.ts.
 * HoldMoneyService is the REAL singleton with its methods stubbed via
 * jest.spyOn, proving the route wires the exact same envelope shape the IPC
 * handler (electron-app/handlers/holdMoneyHandlers.ts) returns.
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
import { getHoldMoneyService } from "@liratek/core";
import holdMoneyRouter from "../holdMoney.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/hold-money", holdMoneyRouter);
  return app;
}

describe("Hold Money REST routes (LIRA-214)", () => {
  let app: Express;
  const service = getHoldMoneyService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("POST /:id/collect validates the body and returns the service's envelope", async () => {
    const spy = jest
      .spyOn(service, "collectHold")
      .mockReturnValue({ success: true, id: 88 });

    const res = await request(app)
      .post("/api/hold-money/5/collect")
      .set("x-test-role", "staff")
      .send({
        usd_amount: 20,
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      });

    expect(res.status).toBe(200); // envelope parity — 200 even on failure
    expect(res.body).toEqual({ success: true, id: 88 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, usd_amount: 20 }),
      42,
    );
  });

  it("POST /:id/collect rejects a malformed body without calling the service", async () => {
    const spy = jest.spyOn(service, "collectHold");

    const res = await request(app)
      .post("/api/hold-money/5/collect")
      .set("x-test-role", "staff")
      .send({ usd_amount: -5 }); // negative — schema rejects

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST /:id/collect requires staff/admin (403 for an unauthorized role)", async () => {
    const res = await request(app)
      .post("/api/hold-money/5/collect")
      .set("x-test-role", "viewer")
      .send({});

    expect(res.status).toBe(403);
  });

  it("GET /:id/pickups returns the service's list", async () => {
    jest
      .spyOn(service, "getPickups")
      .mockReturnValue([
        {
          id: 1,
          hold_money_id: 5,
          transaction_id: 10,
          usd_amount: 20,
          lbp_amount: 0,
          is_voided: 0,
          voided_by: null,
          voided_at: null,
          created_by: 42,
          created_at: "2026-09-24T00:00:00.000Z",
          updated_at: "2026-09-24T00:00:00.000Z",
        },
      ] as any);

    const res = await request(app)
      .get("/api/hold-money/5/pickups")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it("POST /pickups/:pickupId/void forwards to the service and returns its envelope", async () => {
    const spy = jest
      .spyOn(service, "voidPickup")
      .mockReturnValue({ success: true, id: 7 });

    const res = await request(app)
      .post("/api/hold-money/pickups/1/void")
      .set("x-test-role", "admin")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 7 });
    expect(spy).toHaveBeenCalledWith(1, 42);
  });
});
