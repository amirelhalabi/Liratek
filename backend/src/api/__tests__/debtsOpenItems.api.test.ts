/**
 * LIRA-304 T029 — the web routes behind the repayment picker:
 *  - GET /api/debts/clients/:clientId/open-items returns the IPC-identical
 *    raw list inside the envelope;
 *  - POST /api/debts/repayments forwards the ticked `targets` to the
 *    service unchanged (the schema must not strip them — rule 23).
 * Not proven failing-first (written after the code).
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

describe("LIRA-304 debts routes", () => {
  const debtService = getDebtService();
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("GET /clients/:id/open-items returns the service's list", async () => {
    const items = [
      {
        kind: "member",
        id: 3,
        rowId: 1,
        createdAt: "2026-10-10 23:26:58",
        openUsd: 101,
        openLbp: 0,
        routingCap: { usd: 101, lbp: 0 },
        label: "OMT SEND",
        type: "FINANCIAL_SERVICE",
        sessionId: 2,
        isPrimary: true,
        primaryDrawer: "OMT_System",
      },
    ];
    const spy = jest
      .spyOn(debtService, "getOpenDebtItems")
      .mockReturnValue(items as never);
    const res = await request(app)
      .get("/api/debts/clients/7/open-items")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, items });
    expect(spy).toHaveBeenCalledWith(7);
  });

  it("GET open-items with a bad id is refused", async () => {
    const res = await request(app)
      .get("/api/debts/clients/abc/open-items")
      .set("x-test-role", "staff");
    expect(res.body.success).toBe(false);
  });

  it("POST /repayments keeps the ticked targets", async () => {
    const spy = jest
      .spyOn(debtService, "addRepayment")
      .mockReturnValue({ success: true, id: 1 });
    const targets = [
      { kind: "member", id: 3 },
      { kind: "charge", id: 9 },
    ];
    const res = await request(app)
      .post("/api/debts/repayments")
      .set("x-test-role", "staff")
      .send({ clientId: 7, amountUSD: 50, amountLBP: 0, targets });
    expect(res.body).toEqual({ success: true, id: 1 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 7, targets }),
    );
  });

  it("POST /repayments refuses an item ticked twice", async () => {
    const spy = jest.spyOn(debtService, "addRepayment");
    const res = await request(app)
      .post("/api/debts/repayments")
      .set("x-test-role", "staff")
      .send({
        clientId: 7,
        amountUSD: 50,
        amountLBP: 0,
        targets: [
          { kind: "member", id: 3 },
          { kind: "member", id: 3 },
        ],
      });
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
