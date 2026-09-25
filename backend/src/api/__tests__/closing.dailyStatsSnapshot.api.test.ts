/**
 * LIRA-219 (C.4) — GET /api/closing/daily-stats-snapshot REST route.
 *
 * Hits the REAL router (../closing.js) through a minimal Express app, same
 * harness as closing.api.test.ts. `ClosingService.getDailyStatsSnapshot` is
 * spied so this file proves ROUTING/GATING (query forwarding, envelope
 * shape, the admin-or-unlocked gate), not the service's own arithmetic
 * (covered by `packages/core/src/services/__tests__/ClosingService.profitParity.test.ts`).
 *
 * `../../middleware/profitsUnlock.js` is the REAL module (not mocked) — its
 * `grantProfitsUnlock`/`revokeProfitsUnlock` let each test set up its own
 * live-or-locked state for the (tenantId, userId) pair the fake JWT uses,
 * proving the route reads real unlock state rather than a stub.
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
      userId: Number(req.headers["x-test-user-id"] ?? 42),
      username: "tester",
      role,
      tenantId: Number(req.headers["x-test-tenant-id"] ?? 1),
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
import { getClosingService } from "@liratek/core";
import {
  grantProfitsUnlock,
  revokeProfitsUnlock,
} from "../../middleware/profitsUnlock.js";
import closingRouter from "../closing.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/closing", closingRouter);
  return app;
}

describe("GET /api/closing/daily-stats-snapshot", () => {
  let app: Express;
  const closingService = getClosingService();
  const TENANT_ID = 1;
  const USER_ID = 42;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    revokeProfitsUnlock(TENANT_ID, USER_ID);
  });

  it("401s without auth", async () => {
    const res = await request(app).get("/api/closing/daily-stats-snapshot");
    expect(res.status).toBe(401);
  });

  it("forwards ?day= to the service as {day}", async () => {
    const spy = jest
      .spyOn(closingService, "getDailyStatsSnapshot")
      .mockReturnValue({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        profitDay: "2026-09-20",
        profitHidden: true,
      });

    const res = await request(app)
      .get("/api/closing/daily-stats-snapshot?day=2026-09-20")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      { day: "2026-09-20" },
      { includeProfit: false },
    );
  });

  it("omits day (undefined) when the query string carries none — the service falls back to clientDay()", async () => {
    const spy = jest
      .spyOn(closingService, "getDailyStatsSnapshot")
      .mockReturnValue({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        profitDay: "2026-09-24",
        profitHidden: true,
      });

    const res = await request(app)
      .get("/api/closing/daily-stats-snapshot")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      { day: undefined },
      { includeProfit: false },
    );
  });

  it("rejects a malformed day with a 400-shaped validation failure, never reaching the service", async () => {
    const spy = jest.spyOn(closingService, "getDailyStatsSnapshot");

    const res = await request(app)
      .get("/api/closing/daily-stats-snapshot?day=not-a-date")
      .set("x-test-role", "staff");

    expect(spy).not.toHaveBeenCalled();
    expect(res.body.success).toBe(false);
  });

  // ── E-Q6: admin-or-Profits-unlocked gate ──────────────────────────────────
  describe("E-Q6 profit gate", () => {
    it("staff WITHOUT a live unlock gets includeProfit:false", async () => {
      const spy = jest
        .spyOn(closingService, "getDailyStatsSnapshot")
        .mockReturnValue({
          salesCount: 0,
          totalSalesUSD: 0,
          totalSalesLBP: 0,
          debtPaymentsUSD: 0,
          debtPaymentsLBP: 0,
          totalExpensesUSD: 0,
          totalExpensesLBP: 0,
          profitDay: "2026-09-24",
          profitHidden: true,
        });

      const res = await request(app)
        .get("/api/closing/daily-stats-snapshot")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.stats.profitHidden).toBe(true);
      expect(res.body.stats.totalProfitUSD).toBeUndefined();
      expect(spy).toHaveBeenCalledWith(expect.anything(), {
        includeProfit: false,
      });
    });

    it("staff WITH a live unlock gets includeProfit:true", async () => {
      grantProfitsUnlock(TENANT_ID, USER_ID);
      const spy = jest
        .spyOn(closingService, "getDailyStatsSnapshot")
        .mockReturnValue({
          salesCount: 0,
          totalSalesUSD: 0,
          totalSalesLBP: 0,
          debtPaymentsUSD: 0,
          debtPaymentsLBP: 0,
          totalExpensesUSD: 0,
          totalExpensesLBP: 0,
          profitDay: "2026-09-24",
          totalProfitUSD: 12,
          totalProfitLBP: 0,
        });

      const res = await request(app)
        .get("/api/closing/daily-stats-snapshot")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.stats.totalProfitUSD).toBe(12);
      expect(spy).toHaveBeenCalledWith(expect.anything(), {
        includeProfit: true,
      });
    });

    it("admin WITHOUT a live unlock still gets includeProfit:true", async () => {
      const spy = jest
        .spyOn(closingService, "getDailyStatsSnapshot")
        .mockReturnValue({
          salesCount: 0,
          totalSalesUSD: 0,
          totalSalesLBP: 0,
          debtPaymentsUSD: 0,
          debtPaymentsLBP: 0,
          totalExpensesUSD: 0,
          totalExpensesLBP: 0,
          profitDay: "2026-09-24",
          totalProfitUSD: 5,
          totalProfitLBP: 0,
        });

      const res = await request(app)
        .get("/api/closing/daily-stats-snapshot")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body.stats.totalProfitUSD).toBe(5);
      expect(spy).toHaveBeenCalledWith(expect.anything(), {
        includeProfit: true,
      });
    });

    it("the unlock is read per (tenantId, userId) — a different user on the same tenant is NOT unlocked by another user's grant", async () => {
      grantProfitsUnlock(TENANT_ID, USER_ID); // unlocks user 42
      const spy = jest
        .spyOn(closingService, "getDailyStatsSnapshot")
        .mockReturnValue({
          salesCount: 0,
          totalSalesUSD: 0,
          totalSalesLBP: 0,
          debtPaymentsUSD: 0,
          debtPaymentsLBP: 0,
          totalExpensesUSD: 0,
          totalExpensesLBP: 0,
          profitDay: "2026-09-24",
          profitHidden: true,
        });

      const res = await request(app)
        .get("/api/closing/daily-stats-snapshot")
        .set("x-test-role", "staff")
        .set("x-test-user-id", "99"); // a DIFFERENT user, same tenant

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(expect.anything(), {
        includeProfit: false,
      });
    });
  });

  // ── Rule 19c: HTTP 200 on failure, matching the IPC envelope ──────────────
  it("returns HTTP 200 {success:false} on a service throw — never 500", async () => {
    jest
      .spyOn(closingService, "getDailyStatsSnapshot")
      .mockImplementation(() => {
        throw new Error("boom");
      });

    const res = await request(app)
      .get("/api/closing/daily-stats-snapshot")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
