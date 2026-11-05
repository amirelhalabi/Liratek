/**
 * LIRA-371 — the supplier settle / Pay-Receive routes carry `cash_drawer`
 * to SupplierService and refuse a bad value (shared core schemas). Parity
 * check, not proven failing-first: the routes spread the validated body.
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

import express, { type Express } from "express";
import request from "supertest";
import { getSupplierService } from "@liratek/core";
import suppliersRouter from "../suppliers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/suppliers", suppliersRouter);
  return app;
}

const settleBody = {
  financial_service_ids: [1],
  amount_usd: 0,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};
const accountBody = {
  per_currency: {
    USD: {
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 772.3 }],
    },
  },
  expected_owed: { usd: 772.3, lbp: 0 },
};
const cashflowBody = {
  direction: "PAY",
  payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
};

const CASES = [
  ["/api/suppliers/3/settle", "settleTransactions", settleBody],
  ["/api/suppliers/3/settle-account", "settleAccount", accountBody],
  ["/api/suppliers/3/cashflow", "recordSupplierCashflow", cashflowBody],
] as const;

describe("LIRA-371 supplier routes — cash_drawer", () => {
  const service = getSupplierService();
  beforeEach(() => jest.restoreAllMocks());

  it.each(CASES)("%s forwards cash_drawer GENERAL", async (url, method, body) => {
    const spy = jest
      .spyOn(service, method)
      .mockReturnValue({ success: true, id: 1 });
    const res = await request(buildApp())
      .post(url)
      .set("x-test-role", "admin")
      .send({ ...body, cash_drawer: "GENERAL" });
    expect(res.body).toEqual({ success: true, id: 1 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ cash_drawer: "GENERAL" }),
    );
  });

  it.each(CASES)("%s refuses a bad value with HTTP 200 + success: false", async (url, method, body) => {
    const spy = jest.spyOn(service, method);
    const res = await request(buildApp())
      .post(url)
      .set("x-test-role", "admin")
      .send({ ...body, cash_drawer: "OMT_System" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
