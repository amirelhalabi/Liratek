/**
 * GET /api/dashboard/chart — DC7-BACKEND-UNTESTED (chart-lane round-1
 * review, OWNER_NOTES_2026-09-21.md §7.1).
 *
 * DC-7 (`backend/src/api/dashboard.ts`) wraps `getSalesService().getChartData`
 * in a try/catch so a thrown DatabaseError answers HTTP 200
 * `{success:false,error}` instead of an uncaught 500 (rule 19c envelope
 * parity with the IPC channel, which has no try/catch of its own and simply
 * rejects on the same failure — `backendApi.getProfitSalesChart` then
 * throws on `!res.success`, proven in
 * `backendApi.getProfitSalesChart.dualmode.test.ts`). Before this file, that
 * envelope was verified only by a scratch supertest probe during the round-1
 * fix session — never a committed test. This hits the REAL router
 * (`../dashboard.js`) through a minimal Express app, mirroring
 * `profitsGate.api.test.ts` / `closing.api.test.ts`: only `../../server.js`
 * (logger) and `../../middleware/auth.js` are faked, `getSalesService()` is
 * the real singleton with `getChartData` stubbed via `jest.spyOn`.
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
  return { authenticateJWT, requireAuth: authenticateJWT };
});

import express, { type Express } from "express";
import request from "supertest";
import { getSalesService } from "@liratek/core";
import dashboardRouter from "../dashboard.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard", dashboardRouter);
  return app;
}

describe("GET /api/dashboard/chart — DC-7 envelope parity", () => {
  let app: Express;
  const salesService = getSalesService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("success: 200 {success:true, chart}", async () => {
    const chart = [{ date: "2026-09-10", usd: 75, lbp: 1_170_000 }];
    jest.spyOn(salesService, "getChartData").mockReturnValue(chart as any);

    const res = await request(app)
      .get("/api/dashboard/chart?type=Sales")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, chart });
    // DC-10: the route now also forwards `client_day` (undefined when the
    // query has none — SalesService.getChartData falls back to
    // clientDay()/localDay() itself, rule 27).
    expect(salesService.getChartData).toHaveBeenCalledWith("Sales", undefined);
  });

  it("DC-10: forwards a valid client_day query param through to the service", async () => {
    jest.spyOn(salesService, "getChartData").mockReturnValue([] as any);

    await request(app)
      .get("/api/dashboard/chart?type=Profit&client_day=2026-09-24")
      .set("x-test-role", "staff");

    expect(salesService.getChartData).toHaveBeenCalledWith(
      "Profit",
      "2026-09-24",
    );
  });

  it("DC-10: a malformed client_day degrades to undefined rather than 400ing the read", async () => {
    jest.spyOn(salesService, "getChartData").mockReturnValue([] as any);

    const res = await request(app)
      .get("/api/dashboard/chart?type=Sales&client_day=not-a-date")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(salesService.getChartData).toHaveBeenCalledWith("Sales", undefined);
  });

  it("DC-7: a thrown DatabaseError answers HTTP 200 {success:false,error} — NOT an uncaught 500", async () => {
    jest.spyOn(salesService, "getChartData").mockImplementation(() => {
      throw new Error("db is locked");
    });

    const res = await request(app)
      .get("/api/dashboard/chart?type=Profit")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "db is locked" });
  });

  it("DC-7: a non-Error throw still answers 200 with the generic fallback message", async () => {
    jest.spyOn(salesService, "getChartData").mockImplementation(() => {
      throw "not an Error instance";
    });

    const res = await request(app)
      .get("/api/dashboard/chart?type=Sales")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Failed to get chart data",
    });
  });

  it("defaults to type=Sales when the query param is anything other than 'Profit'", async () => {
    jest.spyOn(salesService, "getChartData").mockReturnValue([] as any);

    await request(app).get("/api/dashboard/chart").set("x-test-role", "staff");

    expect(salesService.getChartData).toHaveBeenCalledWith("Sales", undefined);
  });
});

describe("GET /api/dashboard/net-profit-last-30-days — DC-11", () => {
  let app: Express;
  const salesService = getSalesService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("success: 200 {success:true, netProfit}", async () => {
    const netProfit = {
      netProfitUSD: 49,
      netProfitLBP: 380_000,
      fromDate: "2026-08-26",
      toDate: "2026-09-24",
    };
    jest
      .spyOn(salesService, "getNetProfitLast30Days")
      .mockReturnValue(netProfit);

    const res = await request(app)
      .get("/api/dashboard/net-profit-last-30-days?client_day=2026-09-24")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, netProfit });
    expect(salesService.getNetProfitLast30Days).toHaveBeenCalledWith(
      "2026-09-24",
    );
  });

  it("a thrown DatabaseError answers HTTP 200 {success:false,error} — NOT an uncaught 500 (rule 19c)", async () => {
    jest
      .spyOn(salesService, "getNetProfitLast30Days")
      .mockImplementation(() => {
        throw new Error("db is locked");
      });

    const res = await request(app)
      .get("/api/dashboard/net-profit-last-30-days")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "db is locked" });
  });

  it("no client_day query param -> forwards undefined (service falls back to clientDay()/localDay())", async () => {
    jest.spyOn(salesService, "getNetProfitLast30Days").mockReturnValue({
      netProfitUSD: 0,
      netProfitLBP: 0,
      fromDate: "2026-08-26",
      toDate: "2026-09-24",
    });

    await request(app)
      .get("/api/dashboard/net-profit-last-30-days")
      .set("x-test-role", "staff");

    expect(salesService.getNetProfitLast30Days).toHaveBeenCalledWith(
      undefined,
    );
  });
});
