/**
 * LIRA-296 SF-1 (T024) — the web "recent sales" list honours the picked day.
 *
 * `backendApi.getTodaysSales(date)` sends `?date=YYYY-MM-DD`, and the IPC
 * twin (`sales:get-todays-sales`) passes it to
 * `SalesService.getTodaysSales(date)`. Both REST routes ignored it and
 * always answered TODAY's sales. They now validate the day and pass it on,
 * so a past day returns that day's sales, the same as desktop.
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
import dashboardRouter from "../dashboard.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  app.use("/api/dashboard", dashboardRouter);
  return app;
}

const ROUTES = ["/api/sales/today", "/api/dashboard/todays-sales"];

describe.each(ROUTES)("GET %s — the picked day (SF-1)", (route) => {
  const service = getSalesService();
  beforeEach(() => jest.restoreAllMocks());

  it("passes a past day to the service, as IPC does", async () => {
    const PAST = [{ id: 9, created_at: "2026-10-01 10:00:00" }];
    const spy = jest
      .spyOn(service, "getTodaysSales")
      .mockReturnValue(PAST as never);
    const res = await request(buildApp())
      .get(route)
      .query({ date: "2026-10-01" })
      .set("x-test-role", "staff");
    expect(spy).toHaveBeenCalledWith("2026-10-01");
    expect(res.body).toEqual({ success: true, sales: PAST });
  });

  it("without a day, asks for today (unchanged)", async () => {
    const spy = jest.spyOn(service, "getTodaysSales").mockReturnValue([]);
    await request(buildApp()).get(route).set("x-test-role", "staff");
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  it("refuses a malformed day with a 200 failure envelope", async () => {
    const spy = jest.spyOn(service, "getTodaysSales");
    const res = await request(buildApp())
      .get(route)
      .query({ date: "01/10/2026" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
