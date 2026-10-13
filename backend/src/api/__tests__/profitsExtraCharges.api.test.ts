/**
 * LIRA-319 (T030) — the REST profits routes hand the core service's new
 * "Extra charges" By Module row and Overview `extra_charges` field to the
 * client unchanged (the IPC handler returns the same service values). The
 * routes are pass-throughs, so this guard is NOT proven failing-first; its
 * job is to fail if a route ever reshapes or filters the payload, and (by
 * typing the fixtures from core) to stop compiling if core renames them.
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
import {
  getProfitService,
  type ProfitByModule,
  type ProfitSummary,
} from "@liratek/core";
import profitsRouter from "../profits.js";
import {
  revokeProfitsUnlock,
  grantProfitsUnlock,
} from "../../middleware/profitsUnlock.js";

const TENANT_ID = 1;
const USER_ID = 42;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/profits", profitsRouter);
  return app;
}

// Typed from core (rule 21/24): if core drops or renames the field, this
// file stops compiling instead of asserting a hand-typed shape.
const EXTRA_ROW: ProfitByModule = {
  module: "EXTRA_CHARGE",
  label: "Extra charges",
  revenue_usd: 3,
  revenue_lbp: 50000,
  cost_usd: 0,
  cost_lbp: 0,
  profit_usd: 3,
  profit_lbp: 50000,
  count: 2,
  margin_pct: null,
  margin_converted: true,
};
const EXTRA_CHARGES: ProfitSummary["extra_charges"] = { usd: 3, lbp: 50000 };

describe("LIRA-319 (T030) — REST profits routes carry Extra charges", () => {
  let app: Express;
  const profitService = getProfitService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    revokeProfitsUnlock(TENANT_ID, USER_ID);
    grantProfitsUnlock(TENANT_ID, USER_ID);
  });
  afterEach(() => revokeProfitsUnlock(TENANT_ID, USER_ID));

  it("GET /by-module returns the EXTRA_CHARGE row unchanged", async () => {
    jest.spyOn(profitService, "getByModule").mockReturnValue([EXTRA_ROW]);
    const res = await request(app)
      .get("/api/profits/by-module?from=2026-10-01&to=2026-10-13")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [EXTRA_ROW] });
  });

  it("GET /summary returns extra_charges unchanged", async () => {
    const summary = {
      extra_charges: EXTRA_CHARGES,
    } as unknown as ProfitSummary;
    jest.spyOn(profitService, "getSummary").mockReturnValue(summary);
    const res = await request(app)
      .get("/api/profits/summary?from=2026-10-01&to=2026-10-13")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.extra_charges).toEqual(EXTRA_CHARGES);
  });
});
