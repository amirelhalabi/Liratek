/**
 * LIRA-371 — POST /api/debts/repayments carries `cashDrawer` to
 * DebtService.addRepayment and refuses a bad value (shared addRepaymentSchema).
 * Parity check: the route spreads the validated body, so this may pass
 * before any service change ("parity check, not proven failing-first").
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
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import { getDebtService } from "@liratek/core";
import debtsRouter from "../debts.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/debts", debtsRouter);
  return app;
}

describe("LIRA-371 POST /api/debts/repayments — cashDrawer", () => {
  const debtService = getDebtService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards cashDrawer GENERAL to the service", async () => {
    const spy = jest
      .spyOn(debtService, "addRepayment")
      .mockReturnValue({ success: true, id: 1 });
    const res = await request(buildApp())
      .post("/api/debts/repayments")
      .set("x-test-role", "staff")
      .send({ clientId: 1, amountUSD: 200, amountLBP: 0, cashDrawer: "GENERAL" });
    expect(res.body).toEqual({ success: true, id: 1 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ cashDrawer: "GENERAL", userId: 42 }),
    );
  });

  it("refuses cashDrawer OMT with success: false and never reaches the service", async () => {
    const spy = jest.spyOn(debtService, "addRepayment");
    const res = await request(buildApp())
      .post("/api/debts/repayments")
      .set("x-test-role", "staff")
      .send({ clientId: 1, amountUSD: 200, amountLBP: 0, cashDrawer: "OMT" });
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
