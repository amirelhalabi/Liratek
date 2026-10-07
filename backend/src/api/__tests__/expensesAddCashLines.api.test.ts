/**
 * Owner decision 2026-10-07 (Expenses, payer = "shop") — `POST /api/expenses`
 * must carry the cash lines (`payments`, OUT = change the vendor hands
 * back), the not-returned claim (`kept_change_*`) and `tender_exchange_rate`
 * through the shared core schema to `ExpenseService.addExpense` (rule 19 —
 * the web transport of the same payload the desktop handler validates).
 * The money behaviour is proven in core
 * (`ExpenseRepository.keptChange.test.ts`); this file proves the transport.
 * Same harness as `expensesStockUse.api.test.ts`.
 *
 * Rule 17 note: written after the schema change, so NOT proven failing-first.
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
import { getExpenseService, createExpenseSchema } from "@liratek/core";
import expensesRouter from "../expenses.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/expenses", expensesRouter);
  return app;
}

const body = {
  category: "Shop_Supply",
  description: "Printer ink",
  amount_usd: 18.5,
  amount_lbp: 0,
  paid_by_method: "CASH",
  expense_date: "2026-10-07T00:00:00.000Z",
  payments: [
    { method: "CASH", currencyCode: "USD", amount: 20 },
    { method: "CASH", currencyCode: "USD", amount: 1, direction: "OUT" },
  ],
  kept_change_usd: 0.5,
  tender_exchange_rate: 89500,
};

describe("POST /api/expenses — bill + cash lines + change back", () => {
  let app: Express;
  const expenseService = getExpenseService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("reaches the service with the cash lines, the not-returned claim and the tender rate intact", async () => {
    const spy = jest
      .spyOn(expenseService, "addExpense")
      .mockReturnValue({ success: true, id: 9 } as any);

    const res = await request(app)
      .post("/api/expenses")
      .set("x-test-role", "staff")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 9 });
    // Field names from the schema itself (rule 24).
    expect(spy).toHaveBeenCalledWith(createExpenseSchema.parse(body), 42);
    const sent = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.payments).toEqual(body.payments);
    expect(sent.kept_change_usd).toBe(0.5);
    expect(sent.tender_exchange_rate).toBe(89500);
  });

  it("a negative not-returned claim is refused by the shared schema; service never called", async () => {
    const spy = jest.spyOn(expenseService, "addExpense");

    const res = await request(app)
      .post("/api/expenses")
      .set("x-test-role", "admin")
      .send({ ...body, kept_change_usd: -0.5 });

    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
