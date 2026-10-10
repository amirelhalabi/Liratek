/**
 * GET /api/closing/since-last-count (LIRA-289 FR-010). Real router and Zod
 * schema; auth faked by header (x-test-role). The service is spied on: the
 * query itself is covered on a real schema in core's
 * ClosingRepository.sinceLastCount.test.ts.
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../middleware/auth.js", () => {
  const requireAuth = (req: any, _res: any, next: any) => {
    req.user = { userId: 1, role: req.headers["x-test-role"] ?? "admin", tenantId: 1 };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) =>
    roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false, error: "Forbidden" });
  return { requireAuth, authenticateJWT: requireAuth, requireRole };
});

import express from "express";
import request from "supertest";
import { getClosingService } from "@liratek/core";
import closingRouter from "../closing.js";

const app = express();
app.use(express.json());
app.use("/api/closing", closingRouter);

describe("GET /api/closing/since-last-count", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("passes the comma list as a de-duplicated array and returns the envelope", async () => {
    const data = [{ drawer: "Whish_App", lastCountAt: "2026-10-09 18:00:00", transactions: [] }];
    const spy = jest.spyOn(getClosingService(), "getTransactionsSinceLastCount").mockReturnValue(data as never);
    const res = await request(app).get("/api/closing/since-last-count?drawers=Whish_App,%20OMT_App,Whish_App");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data });
    expect(spy).toHaveBeenCalledWith(["Whish_App", "OMT_App"]);
  });

  it("is admin-only", async () => {
    const spy = jest.spyOn(getClosingService(), "getTransactionsSinceLastCount");
    const res = await request(app).get("/api/closing/since-last-count?drawers=Whish_App").set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a missing drawer list", async () => {
    const spy = jest.spyOn(getClosingService(), "getTransactionsSinceLastCount");
    const res = await request(app).get("/api/closing/since-last-count");
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
