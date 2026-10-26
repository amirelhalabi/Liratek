/**
 * LIRA-343 T033a (FR-016c) — web (REST) side of the supplier Transactions
 * window's server-side day range: `?from=YYYY-MM-DD&to=YYYY-MM-DD` on
 *  - GET /api/suppliers/all-transactions            (plain supplier)
 *  - GET /api/suppliers/:id/account-transactions    (account parent: every member)
 *  - GET /api/suppliers/:id/account-ledger          (account Payments)
 * checked with the SAME core schema as the IPC handlers
 * (`supplierDayRangeSchema`, rule 14) and refused with the HTTP-200 envelope
 * (rule 19c). Absent range → the service is called exactly as before.
 *
 * Harness copied from suppliers.lira343MonthRows.api.test.ts.
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
import { getSupplierService, getFinancialService } from "@liratek/core";
import suppliersRouter from "../suppliers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/suppliers", suppliersRouter);
  return app;
}

// Loose views so this file compiles against the unfixed service too.
type Spyable = Record<string, (...args: unknown[]) => unknown>;

describe("LIRA-343 T033a — day range on the supplier Transactions REST reads", () => {
  let app: Express;
  const supplierService = getSupplierService() as unknown as Spyable;
  const financialService = getFinancialService() as unknown as Spyable;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("GET /api/suppliers/all-transactions", () => {
    it("forwards (provider, limit, { from, to })", async () => {
      const spy = jest
        .spyOn(financialService, "getAllByProvider")
        .mockReturnValue([{ id: 7 }]);
      const res = await request(app)
        .get(
          "/api/suppliers/all-transactions?provider=OMT&limit=50&from=2026-10-01&to=2026-10-25",
        )
        .set("x-test-role", "staff");
      expect(res.body).toEqual({ success: true, transactions: [{ id: 7 }] });
      expect(spy).toHaveBeenCalledWith("OMT", 50, {
        from: "2026-10-01",
        to: "2026-10-25",
      });
    });

    it("no range → called exactly as before (provider, limit)", async () => {
      const spy = jest
        .spyOn(financialService, "getAllByProvider")
        .mockReturnValue([]);
      await request(app)
        .get("/api/suppliers/all-transactions?provider=OMT")
        .set("x-test-role", "staff");
      expect(spy).toHaveBeenCalledWith("OMT", undefined, undefined);
    });

    it.each([
      "from=2026-10-31&to=2026-10-01",
      "from=2026-13-01",
      "to=25-10-2026",
      "from=2026-10-01&from=2026-10-02",
    ])("refuses %s with an HTTP-200 envelope, service not called", async (q) => {
      const spy = jest
        .spyOn(financialService, "getAllByProvider")
        .mockReturnValue([]);
      const res = await request(app)
        .get(`/api/suppliers/all-transactions?provider=OMT&${q}`)
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/suppliers/:id/account-transactions", () => {
    it("forwards (id, limit, { from, to }) to getAllByAccount", async () => {
      const spy = jest
        .spyOn(financialService, "getAllByAccount")
        .mockReturnValue([{ id: 9 }]);
      const res = await request(app)
        .get("/api/suppliers/3/account-transactions?from=2026-10-25&to=2026-10-25")
        .set("x-test-role", "staff");
      expect(res.body).toEqual({ success: true, transactions: [{ id: 9 }] });
      expect(spy).toHaveBeenCalledWith(3, undefined, {
        from: "2026-10-25",
        to: "2026-10-25",
      });
    });

    it("refuses a bad range and a non-numeric id", async () => {
      const spy = jest
        .spyOn(financialService, "getAllByAccount")
        .mockReturnValue([]);
      const bad = await request(app)
        .get("/api/suppliers/3/account-transactions?from=2026-10-31&to=2026-10-01")
        .set("x-test-role", "staff");
      expect(bad.status).toBe(200);
      expect(bad.body.success).toBe(false);
      const badId = await request(app)
        .get("/api/suppliers/abc/account-transactions")
        .set("x-test-role", "staff");
      expect(badId.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller", async () => {
      const res = await request(app).get("/api/suppliers/3/account-transactions");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/suppliers/:id/account-ledger", () => {
    it("forwards (id, limit, { from, to })", async () => {
      const spy = jest
        .spyOn(supplierService, "getAccountLedger")
        .mockReturnValue([{ id: 4 }]);
      const res = await request(app)
        .get("/api/suppliers/3/account-ledger?limit=20&from=2026-10-01")
        .set("x-test-role", "staff");
      expect(res.body).toEqual({ success: true, ledger: [{ id: 4 }] });
      expect(spy).toHaveBeenCalledWith(3, 20, { from: "2026-10-01" });
    });

    it("refuses a bad range with an HTTP-200 envelope", async () => {
      const spy = jest
        .spyOn(supplierService, "getAccountLedger")
        .mockReturnValue([]);
      const res = await request(app)
        .get("/api/suppliers/3/account-ledger?from=2026-10-31&to=2026-10-01")
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
