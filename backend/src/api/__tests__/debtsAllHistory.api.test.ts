/**
 * LIRA-330 — GET /api/debts/history: every client's history in one request
 * (Accounts Excel export), the web twin of IPC `debt:get-all-history`. Same
 * envelope as the per-client history route; needs a signed-in user.
 * Not proven failing-first (written with the route).
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

describe("LIRA-330 GET /api/debts/history", () => {
  const debtService = getDebtService();
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("returns the whole shop's history in the history envelope", async () => {
    const history = [
      { id: 1, client_id: 10, transaction_type: "Manual Debt", amount_usd: 5 },
      { id: 2, client_id: 20, transaction_type: "Repayment", amount_usd: -5 },
    ];
    const spy = jest
      .spyOn(debtService, "getAllHistory")
      .mockReturnValue(history as never);
    const res = await request(app)
      .get("/api/debts/history")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, history });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses a request without a signed-in user", async () => {
    const spy = jest.spyOn(debtService, "getAllHistory");
    const res = await request(app).get("/api/debts/history");
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});
