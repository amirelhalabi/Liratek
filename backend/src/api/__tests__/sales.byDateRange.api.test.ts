/**
 * LIRA-296 SF-2 (T025) — "sales by date range" on the web app.
 *
 * IPC `sales:get-by-date-range` (desktop) had no REST twin. `GET
 * /api/sales/by-date-range?from&to` now calls the SAME
 * `SalesService.findByDateRange` with the days validated by the shared core
 * schema, and returns the same rows in the IPC-identical envelope.
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../websocket/io.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = { userId: 7, username: "t", role, tenantId: 1, sessionToken: "s" };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user?.role)) {
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

describe("GET /api/sales/by-date-range (SF-2)", () => {
  const service = getSalesService();
  beforeEach(() => jest.restoreAllMocks());

  it("returns the service's rows for the range", async () => {
    const ROWS = [{ id: 3, item_count: 2 }];
    const spy = jest
      .spyOn(service, "findByDateRange")
      .mockReturnValue(ROWS as never);
    const res = await request(buildApp())
      .get("/api/sales/by-date-range")
      .query({ from: "2026-10-01", to: "2026-10-10" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: ROWS });
    expect(spy).toHaveBeenCalledWith("2026-10-01", "2026-10-10");
  });

  it("is not swallowed by GET /:id", async () => {
    const spy = jest.spyOn(service, "getSale");
    jest.spyOn(service, "findByDateRange").mockReturnValue([]);
    await request(buildApp())
      .get("/api/sales/by-date-range")
      .query({ from: "2026-10-01", to: "2026-10-10" })
      .set("x-test-role", "staff");
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [{ from: "2026-10-01" }],
    [{ from: "2026-10-10", to: "2026-10-01" }],
    [{ from: "1/10/2026", to: "2026-10-10" }],
  ])("refuses %p with a 200 failure envelope", async (query) => {
    const spy = jest.spyOn(service, "findByDateRange");
    const res = await request(buildApp())
      .get("/api/sales/by-date-range")
      .query(query)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
