/**
 * LIRA-347 — the web routes behind the Debts page's settle-by-day calendar:
 *  - GET /api/debts/clients/:clientId/month-rows?month=YYYY-MM returns the
 *    IPC-identical month inside the envelope, validated by the shared core
 *    schema (debtMonthRowsSchema);
 *  - POST /api/debts/repayments forwards `expectedOwed` and
 *    `creditUseUSD`/`creditUseLBP` to the service unchanged (rule 23: the
 *    schema must not strip them) with the actor from the JWT.
 * Not proven failing-first (written after the route, rule 17).
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

describe("LIRA-347 debts routes (settle by day)", () => {
  const debtService = getDebtService();
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("GET /clients/:id/month-rows returns the service's month inside the envelope", async () => {
    const data = {
      month: "2026-10",
      rows: [
        {
          shop_day: "2026-10-22",
          kind: "charge",
          id: 11,
          amount_usd: 40,
          amount_lbp: 0,
          covered_usd: 0,
          covered_lbp: 0,
          remaining_usd: 40,
          remaining_lbp: 0,
          row_scope: "DAY",
          label: "Loto ticket",
          type: "LOTO",
          session_id: null,
        },
      ],
      account: { earlier_usd: 0, earlier_lbp: 0, credit_usd: 20, credit_lbp: 0 },
    };
    const spy = jest
      .spyOn(debtService, "getClientDebtMonthRows")
      .mockReturnValue(data as never);
    const res = await request(app)
      .get("/api/debts/clients/7/month-rows?month=2026-10")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data });
    expect(spy).toHaveBeenCalledWith(7, "2026-10");
  });

  it("GET month-rows with a bad month is refused, the service not called", async () => {
    const spy = jest.spyOn(debtService, "getClientDebtMonthRows");
    const res = await request(app)
      .get("/api/debts/clients/7/month-rows?month=2026-13")
      .set("x-test-role", "staff");
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST /repayments keeps expectedOwed and the credit use (rule 23), actor from the JWT", async () => {
    const spy = jest
      .spyOn(debtService, "addRepayment")
      .mockReturnValue({ success: true, id: 1 });
    const res = await request(app)
      .post("/api/debts/repayments")
      .set("x-test-role", "staff")
      .send({
        clientId: 7,
        amountUSD: 30,
        amountLBP: 0,
        targets: [{ kind: "sale", id: 5 }],
        expectedOwed: { usd: 50, lbp: 0 },
        creditUseUSD: 20,
        userId: 999,
      });
    expect(res.body).toEqual({ success: true, id: 1 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 7,
        expectedOwed: { usd: 50, lbp: 0 },
        creditUseUSD: 20,
        userId: 42,
      }),
    );
  });

  it("POST /repayments accepts a repayment wholly from credit", async () => {
    const spy = jest
      .spyOn(debtService, "addRepayment")
      .mockReturnValue({ success: true, id: 1 });
    const res = await request(app)
      .post("/api/debts/repayments")
      .set("x-test-role", "staff")
      .send({ clientId: 7, targets: [{ kind: "sale", id: 5 }], creditUseUSD: 14 });
    expect(res.body).toEqual({ success: true, id: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
