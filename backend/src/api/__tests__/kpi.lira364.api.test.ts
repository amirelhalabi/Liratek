/**
 * LIRA-364 — `GET /api/kpi/snapshots`, the web twin of IPC
 * `kpi:list-snapshots`: admin-only, read-only, the IPC-identical envelope
 * `{ success, enabled, snapshots }`.
 *
 * Harness copied from suppliers.lira362Archive.api.test.ts.
 *
 * RULE 17 — written before the route existed.
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
import { getKpiSnapshotService } from "@liratek/core";
import kpiRouter from "../kpi.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/kpi", kpiRouter);
  return app;
}

const OCTOBER = {
  month: "2026-10",
  taken_at: "2026-10-31 23:00:00",
  is_late: false,
  usd_lbp_buy_rate: 89000,
  usd_lbp_sell_rate: 90000,
  values: { stock_value: { usd: 9500, lbp: 0 } },
};

describe("GET /api/kpi/snapshots (LIRA-364)", () => {
  const service = getKpiSnapshotService();
  beforeEach(() => jest.restoreAllMocks());

  it("an admin gets the shop's months and whether the feature is on", async () => {
    jest
      .spyOn(service, "getProgress")
      .mockReturnValue({ enabled: true, snapshots: [OCTOBER] });
    const res = await request(buildApp())
      .get("/api/kpi/snapshots")
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      enabled: true,
      snapshots: [OCTOBER],
    });
  });

  it("a shop without the switch gets enabled: false", async () => {
    jest
      .spyOn(service, "getProgress")
      .mockReturnValue({ enabled: false, snapshots: [] });
    const res = await request(buildApp())
      .get("/api/kpi/snapshots")
      .set("x-test-role", "admin");
    expect(res.body).toEqual({ success: true, enabled: false, snapshots: [] });
  });

  it("is admin-only", async () => {
    const spy = jest.spyOn(service, "getProgress");
    const res = await request(buildApp())
      .get("/api/kpi/snapshots")
      .set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a failure answers with the failure envelope", async () => {
    jest.spyOn(service, "getProgress").mockImplementation(() => {
      throw new Error("db locked");
    });
    const res = await request(buildApp())
      .get("/api/kpi/snapshots")
      .set("x-test-role", "admin");
    expect(res.body.success).toBe(false);
  });
});
