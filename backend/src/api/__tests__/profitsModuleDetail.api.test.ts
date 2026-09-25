/**
 * NOT RUN — proven at the end-of-batch gate (OWNER_NOTES_REMAINING_BUILD.md
 * #14 slice 2 batch process rule: implement first, verify at the end).
 *
 * GET /api/profits/module-detail — the By Module drill-down's "Show
 * transactions" list (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice
 * 2). This route must sit behind the SAME Profits password gate as every
 * other data route, and forward `(module, from, to)` to
 * `ProfitService.getModuleDetail` unchanged.
 *
 * Mirrors `profitsCommissions.api.test.ts`'s own harness (real router,
 * mocked auth/logger, the real `ProfitsAccessService`/`ProfitService`
 * singletons with their methods stubbed via jest.spyOn).
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
import { getProfitService } from "@liratek/core";
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

const EMPTY_DETAIL = {
  module: "SALE",
  counted: [],
  not_counted: [],
  counted_total_profit_usd: 0,
  counted_total_profit_lbp: 0,
};

describe("GET /api/profits/module-detail (PROF-DD, #14 slice 2)", () => {
  let app: Express;
  const profitService = getProfitService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    revokeProfitsUnlock(TENANT_ID, USER_ID);
  });

  it("locked: 403 {success:false, error: 'Profits locked'}", async () => {
    const res = await request(app)
      .get("/api/profits/module-detail?module=SALE")
      .set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: "Profits locked" });
  });

  it("unauthenticated: 401", async () => {
    const res = await request(app).get(
      "/api/profits/module-detail?module=SALE",
    );
    expect(res.status).toBe(401);
  });

  it("after successful unlock: the route passes, forwarding module/from/to", async () => {
    const getModuleDetailSpy = jest
      .spyOn(profitService, "getModuleDetail")
      .mockReturnValue(EMPTY_DETAIL);
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get(
        "/api/profits/module-detail?module=RECHARGE_MTC&from=2026-09-01&to=2026-09-30",
      )
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(EMPTY_DETAIL);
    expect(getModuleDetailSpy).toHaveBeenCalledWith(
      "RECHARGE_MTC",
      "2026-09-01",
      "2026-09-30",
    );
  });

  it("missing module: rejected with a 200-envelope failure (rule 19 — REST returns HTTP 200 even on validation failure)", async () => {
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/module-detail")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it("a module the service doesn't support yet (slice 3) surfaces the service's own error message as a 200-envelope failure, not a 500", async () => {
    // PROF-DD-FIX (review round, m3) — was `expect(res.status).toBe(500)`.
    // Rule 19c: REST answers the IPC-identical envelope — HTTP 200 even on
    // failure — so `requestJson` never rejects before the adapter's own
    // `!res.success` check runs (see `backendApi.ts`'s "LC-2 precedent"
    // comment on `getProfitModuleDetail`, which already documented this 200
    // contract). A 500 here made that documented contract false.
    jest.spyOn(profitService, "getModuleDetail").mockImplementation(() => {
      throw new Error(
        'No transaction-level detail is available for "LOTO" yet (slice 3, a later ticket).',
      );
    });
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/module-detail?module=LOTO")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/slice 3/);
  });

  it("an UNEXPECTED error (not the service's own deliberate message) surfaces a generic message, never the raw error text", async () => {
    // PROF-DD-FIX (m3) — a raw DB/driver error message could leak SQL text
    // to the browser; only a recognised, deliberately-thrown "not built yet"
    // message passes through unchanged.
    jest.spyOn(profitService, "getModuleDetail").mockImplementation(() => {
      throw new Error("ambiguous column name: discount_usd");
    });
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/module-detail?module=SALE")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).not.toMatch(/ambiguous column/);
    expect(res.body.error).toBe("Failed to get profit module detail");
  });

  it("defaults from/to to today when omitted (matches every other Profits data route's own todayISO() fallback)", async () => {
    const getModuleDetailSpy = jest
      .spyOn(profitService, "getModuleDetail")
      .mockReturnValue(EMPTY_DETAIL);
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/module-detail?module=SALE")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    const [, from, to] = getModuleDetailSpy.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from).toBe(to);
  });
});
