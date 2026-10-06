/**
 * LIRA-262 — `POST /api/expenses/stock-use` (web transport of "the shop used
 * its own stock"). Same harness as `expensesDelete.api.test.ts`: the REAL
 * router through a minimal Express app, faking only the logger, the audit
 * writer and `authenticateJWT` (`x-test-role`). `ExpenseService
 * .addStockExpense` is stubbed — the money behaviour is proven in core
 * (`ExpenseRepository.stockUse.test.ts`); this file proves the transport:
 * same role gate as add-expense, the shared core schema, actor from the JWT,
 * IPC-identical envelope.
 *
 * Rule 17 note: written after the route, so NOT proven failing-first.
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
import { getExpenseService } from "@liratek/core";
import expensesRouter from "../expenses.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/expenses", expensesRouter);
  return app;
}

const validBody = {
  source: "KATSH",
  item_id: 12,
  quantity: 2,
  category: "Shop_Supply",
  expense_date: "2026-10-06T00:00:00.000Z",
};

describe("LIRA-262: POST /api/expenses/stock-use", () => {
  let app: Express;
  const expenseService = getExpenseService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it.each(["admin", "staff"])(
    "%s reaches the service with the parsed body and the JWT actor, HTTP 200 envelope",
    async (role) => {
      const spy = jest
        .spyOn(expenseService, "addStockExpense")
        .mockReturnValue({ success: true, id: 7 } as any);

      const res = await request(app)
        .post("/api/expenses/stock-use")
        .set("x-test-role", role)
        // A client-sent amount / user id must never reach the service.
        .send({ ...validBody, amount_lbp: 1, userId: 999 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 7 });
      expect(spy).toHaveBeenCalledWith(validBody, 42);
    },
  );

  it("a service refusal is HTTP 200 with {success:false,error}", async () => {
    jest.spyOn(expenseService, "addStockExpense").mockReturnValue({
      success: false,
      error: 'Not enough stock for "Paper" (1 available)',
    } as any);

    const res = await request(app)
      .post("/api/expenses/stock-use")
      .set("x-test-role", "staff")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: 'Not enough stock for "Paper" (1 available)',
    });
  });

  it("an unknown source is refused by the shared schema; service never called", async () => {
    const spy = jest.spyOn(expenseService, "addStockExpense");

    const res = await request(app)
      .post("/api/expenses/stock-use")
      .set("x-test-role", "admin")
      .send({ ...validBody, source: "OMT_APP" });

    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("unauthenticated: 401, service never called", async () => {
    const spy = jest.spyOn(expenseService, "addStockExpense");

    const res = await request(app)
      .post("/api/expenses/stock-use")
      .send(validBody);

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});
