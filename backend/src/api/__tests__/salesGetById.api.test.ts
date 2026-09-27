/**
 * Web-only bug fix — "Sale not found" on EVERY click of a POS "Today's
 * Sales" row, on web. Root cause: `GET /api/sales/:id` validated the URL
 * param with `getSaleSchema` (`packages/core/src/validators/sale.ts`),
 * which is `z.object({ id: z.number().int().positive() })` — but Express
 * URL params are ALWAYS strings ("67", never 67), so `.parse({ id: "67" })`
 * threw on every single request, before `SalesService.getSale` was ever
 * called. `validateParams`'s catch branch then answered
 * `{ success: false, error: "Expected number, received string" }` with HTTP
 * 200 (rule 19c) and no `sale` key — `SaleDetailModal.tsx`'s `loadSale()`
 * set `sale` to `undefined` and rendered "Sale not found" for every id,
 * valid or not.
 *
 * The fix swaps `getSaleSchema` for a NEW `saleIdParamSchema`
 * (`z.coerce.number().int().positive()`), the same param-coercing pattern
 * already used by `productUnitIdSchema`/`lotBreakdownSchema` elsewhere in
 * this codebase (rule 14 — reused shape, not a fourth copy). `getSaleSchema`
 * itself is left untouched (no caller currently uses it, but rule 14 says
 * don't repurpose a differently-shaped export out from under a hypothetical
 * caller — add the correctly-shaped one instead).
 *
 * Follows the harness in `../__tests__/salesDeleteDraft.api.test.ts`: hits
 * the REAL router (`../sales.js`) through a minimal Express app, faking only
 * `../../server.js` (logger) and `../../middleware/auth.js` (an
 * `x-test-role` stand-in for `authenticateJWT`). `SalesService` is the REAL
 * singleton with `getSale` stubbed via `jest.spyOn`.
 *
 * Rule 17 (failing-first) — run against the pre-fix tree (`GET "/:id"` still
 * wired to `validateParams(getSaleSchema)`): the "valid numeric id" and
 * "unknown id" cases below both failed —
 *   - valid id: expected `{ success: true, sale: {...} }`, got
 *     `{ success: false, error: "Expected number, received string" }"`
 *     (Zod v4's actual message text), and `getSale` was NOT called
 *     (`toHaveBeenCalledWith(67)` failed with 0 calls).
 *   - unknown id: same failure shape — the route never reached the service,
 *     so `getSale` was never called with `999999` either.
 * The "non-numeric id" and "unauthenticated" cases passed unchanged both
 * before and after (characterization, not fix-guards) — recorded here so a
 * future change cannot silently regress them while "fixing" this file.
 * Restoring the route to `validateParams(saleIdParamSchema)` made every case
 * pass.
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
import { getSalesService } from "@liratek/core";
import salesRouter from "../sales.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

describe("Web-only fix: GET /api/sales/:id", () => {
  let app: Express;
  const salesService = getSalesService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("a valid numeric id reaches the service (as a NUMBER) and returns the sale", async () => {
    const sale = { id: 67, total_amount: 10, client_name: "Walk-in" };
    const getSaleSpy = jest.spyOn(salesService, "getSale").mockReturnValue(sale as any);

    const res = await request(app)
      .get("/api/sales/67")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sale });
    expect(getSaleSpy).toHaveBeenCalledWith(67);
  });

  it("an unknown id: {success:true, sale:null} — frontend still renders 'Sale not found'", async () => {
    const getSaleSpy = jest
      .spyOn(salesService, "getSale")
      .mockReturnValue(null as any);

    const res = await request(app)
      .get("/api/sales/999999")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sale: null });
    expect(getSaleSpy).toHaveBeenCalledWith(999999);
  });

  it("a service error: {success:false}, HTTP 200 (rule 19c), not a 404", async () => {
    jest.spyOn(salesService, "getSale").mockImplementation(() => {
      throw new Error("DB exploded");
    });

    const res = await request(app)
      .get("/api/sales/5")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "DB exploded" });
  });

  it("a non-numeric id: {success:false}, HTTP 200, service never called", async () => {
    const getSaleSpy = jest.spyOn(salesService, "getSale");

    const res = await request(app)
      .get("/api/sales/not-a-number")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(getSaleSpy).not.toHaveBeenCalled();
  });

  it("unauthenticated: 401, service never called", async () => {
    const getSaleSpy = jest.spyOn(salesService, "getSale");

    const res = await request(app).get("/api/sales/67");

    expect(res.status).toBe(401);
    expect(getSaleSpy).not.toHaveBeenCalled();
  });
});
