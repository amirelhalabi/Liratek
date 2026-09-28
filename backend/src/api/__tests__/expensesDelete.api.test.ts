/**
 * Web-only bug fix — "delete expense" fails on EVERY click on web.
 * `DELETE /api/expenses/:id` (`backend/src/api/expenses.ts`) validated the
 * URL param with `deleteExpenseSchema` (`packages/core/src/validators/
 * expense.ts`), which is `z.object({ id: positiveIntegerSchema })` — a plain
 * `z.number()`. Express URL params are ALWAYS strings ("5", never 5), so
 * `.parse({ id: "5" })` threw before `ExpenseService.deleteExpense` was ever
 * called. `validateParams`'s catch branch answered
 * `{ success: false, error: "Expected number, received string" }` with HTTP
 * 400.
 *
 * The exact same bug, same shape, same fix as `GET /api/sales/:id`
 * (`salesGetById.api.test.ts`): swap the param schema for one that
 * `z.coerce`s first — `expenseIdParamSchema`, added alongside
 * `deleteExpenseSchema` (left untouched — rule 14: no caller of the old
 * schema currently passes it a string, so it's kept as-is, not repurposed).
 *
 * Follows the harness in `../__tests__/salesGetById.api.test.ts` /
 * `../__tests__/salesDeleteDraft.api.test.ts`: hits the REAL router
 * (`../expenses.js`) through a minimal Express app, faking only
 * `../../server.js` (logger) and `../../middleware/auth.js` (an
 * `x-test-role` stand-in for `authenticateJWT`). `ExpenseService` is the REAL
 * singleton with `addExpense`/`deleteExpense` stubbed via `jest.spyOn`.
 *
 * Rule 17 (failing-first) — run against the pre-fix tree (`DELETE "/:id"`
 * still wired to `validateParams(deleteExpenseSchema)`): the "valid numeric
 * id" case failed — expected `{ success: true }`-shaped envelope reaching
 * the service with `5`, got `{ success: false, error: "Expected number,
 * received string" }` and `deleteExpense` was NOT called (0 calls, not
 * `toHaveBeenCalledWith(5, 42)`). The role-gate and unauthenticated cases
 * passed unchanged both before and after (characterization, not fix-guards)
 * — recorded here so a future change cannot silently regress them while
 * "fixing" this file. Restoring the route to
 * `validateParams(expenseIdParamSchema)` made every case pass.
 *
 * LIRA-234 addition — `POST /` and `DELETE /:id` both answered a SERVICE
 * failure (not a validation failure — the request shape is fine, the
 * business rule refused it) with HTTP 400 instead of the rule-19c-mandated
 * 200 + `{success:false,error}`, unlike every other write route in this
 * codebase. This mattered on web specifically: `requestJson`
 * (`frontend/src/api/httpClient.ts`) THROWS on any non-2xx response, so the
 * frontend's `if (result.success) {...} else { alert("Error: "+result.error) }`
 * branch in `Expenses/index.tsx` was unreachable on web — a real error like
 * "insufficient drawer balance" was swallowed by the generic `catch` and
 * shown as "Failed to add expense", losing the actual reason. Both routes
 * were switched to always answer 200 (validation failures via
 * `validateRequest`/`validateParams` are untouched — those still 400, a
 * repo-wide convention this fix does not touch). The "service failure"
 * cases below (one per route) are the new fix-guards: run failing-first
 * against the pre-fix tree (`res.status(result.success ? 200 : 400)`), both
 * got HTTP 400 instead of 200 with the SAME body. Fixed by making the
 * status always 200.
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

describe("Web-only fix: DELETE /api/expenses/:id", () => {
  let app: Express;
  const expenseService = getExpenseService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("a valid numeric id (admin) reaches the service as a NUMBER and returns the IPC-identical envelope, HTTP 200", async () => {
    const deleteSpy = jest
      .spyOn(expenseService, "deleteExpense")
      .mockReturnValue({ success: true } as any);

    const res = await request(app)
      .delete("/api/expenses/5")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledWith(5, 42);
  });

  it("a non-numeric id: {success:false}, HTTP 200, service never called", async () => {
    const deleteSpy = jest.spyOn(expenseService, "deleteExpense");

    const res = await request(app)
      .delete("/api/expenses/not-a-number")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("LIRA-234: a service failure reaches the service (id already coerced) and returns HTTP 200 with {success:false,error} — rule 19c envelope parity with IPC", async () => {
    jest
      .spyOn(expenseService, "deleteExpense")
      .mockReturnValue({ success: false, error: "Expense not found" } as any);

    const res = await request(app)
      .delete("/api/expenses/999999")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Expense not found" });
  });

  it("a refused role (staff — IPC's db:delete-expense gates to admin only): 403, service never called", async () => {
    const deleteSpy = jest.spyOn(expenseService, "deleteExpense");

    const res = await request(app)
      .delete("/api/expenses/5")
      .set("x-test-role", "staff");

    expect(res.status).toBe(403);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("unauthenticated: 401, service never called", async () => {
    const deleteSpy = jest.spyOn(expenseService, "deleteExpense");

    const res = await request(app).delete("/api/expenses/5");

    expect(res.status).toBe(401);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe("LIRA-234: POST /api/expenses — service failure returns HTTP 200", () => {
  let app: Express;
  const expenseService = getExpenseService();

  const validBody = {
    category: "Shop_Supply",
    amount_usd: 50,
    expense_date: "2026-09-23T00:00:00.000Z",
  };

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("a well-formed request the service refuses returns HTTP 200 with {success:false,error} — rule 19c envelope parity with IPC", async () => {
    const addSpy = jest.spyOn(expenseService, "addExpense").mockReturnValue({
      success: false,
      error: "Insufficient drawer balance",
    } as any);

    const res = await request(app)
      .post("/api/expenses")
      .set("x-test-role", "admin")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Insufficient drawer balance",
    });
    expect(addSpy).toHaveBeenCalled();
  });

  it("a successful add still returns HTTP 200 with {success:true} (unchanged)", async () => {
    jest
      .spyOn(expenseService, "addExpense")
      .mockReturnValue({ success: true, id: 9 } as any);

    const res = await request(app)
      .post("/api/expenses")
      .set("x-test-role", "admin")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 9 });
  });

  it("a malformed body (validation failure, not a service failure) is rejected by validateRequest before the service is reached, HTTP 200 — validateRequest already answers 200 on a Zod rejection and this fix does not touch it", async () => {
    const addSpy = jest.spyOn(expenseService, "addExpense");

    const res = await request(app)
      .post("/api/expenses")
      .set("x-test-role", "admin")
      .send({ category: "Shop_Supply" }); // missing amount_usd / expense_date

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("LIRA-242 (owner decision 2026-09-28): staff CAN add an expense — routine cashier work, unlike DELETE above which stays admin-only", async () => {
    const addSpy = jest
      .spyOn(expenseService, "addExpense")
      .mockReturnValue({ success: true, id: 11 } as any);

    const res = await request(app)
      .post("/api/expenses")
      .set("x-test-role", "staff")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 11 });
    expect(addSpy).toHaveBeenCalled();
  });
});
