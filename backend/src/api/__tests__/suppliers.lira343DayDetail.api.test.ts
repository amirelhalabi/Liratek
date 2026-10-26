/**
 * LIRA-343 (T032, contracts/calendar-reads.md §3) — one shop day's details,
 * web (REST) side: `GET /api/suppliers/:id/account-day-detail
 * ?day=YYYY-MM-DD`. Mirrors `suppliers:account-day-detail`: same no-role
 * gate as account-unsettled (`requireAuth` only), the SAME core schema
 * (`accountDaySchema`, rule 14), and the HTTP-200 envelope even when the
 * day is refused (rule 19c).
 *
 * Harness copied from suppliers.api.test.ts: the REAL router, a
 * header-driven auth stand-in, and the real SupplierService singleton with
 * its method stubbed via jest.spyOn.
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
import { getSupplierService, type AccountDayDetailRow } from "@liratek/core";
import suppliersRouter from "../suppliers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/suppliers", suppliersRouter);
  return app;
}

describe("GET /api/suppliers/:id/account-day-detail (LIRA-343)", () => {
  let app: Express;
  const supplierService = getSupplierService();
  const rows = [
    { id: 1, shop_day: "2026-10-21", settlements: [], added_after_settlement: false },
  ];

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("forwards (id, day) and returns { success: true, rows }", async () => {
    const spy = jest
      .spyOn(supplierService, "getAccountDayDetail")
      .mockReturnValue(rows as unknown as AccountDayDetailRow[]);
    const res = await request(app)
      .get("/api/suppliers/3/account-day-detail?day=2026-10-21")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, rows });
    expect(spy).toHaveBeenCalledWith(3, "2026-10-21");
  });

  it("refuses an unauthenticated caller", async () => {
    const spy = jest
      .spyOn(supplierService, "getAccountDayDetail")
      .mockReturnValue([]);
    const res = await request(app).get(
      "/api/suppliers/3/account-day-detail?day=2026-10-21",
    );
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["2026-10", "2026-1-21", "21/10/2026", ""])(
    "refuses day=%p with an HTTP-200 envelope, service not called",
    async (bad) => {
      const spy = jest
        .spyOn(supplierService, "getAccountDayDetail")
        .mockReturnValue([]);
      const res = await request(app)
        .get(`/api/suppliers/3/account-day-detail?day=${encodeURIComponent(bad)}`)
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "day must be YYYY-MM-DD",
      });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("refuses a missing day with an HTTP-200 envelope", async () => {
    const spy = jest
      .spyOn(supplierService, "getAccountDayDetail")
      .mockReturnValue([]);
    const res = await request(app)
      .get("/api/suppliers/3/account-day-detail")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric id", async () => {
    const spy = jest
      .spyOn(supplierService, "getAccountDayDetail")
      .mockReturnValue([]);
    const res = await request(app)
      .get("/api/suppliers/abc/account-day-detail?day=2026-10-21")
      .set("x-test-role", "staff");
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
