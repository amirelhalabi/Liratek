/**
 * LIRA-389 — web half of the Summary view and the list drill-down:
 *
 *  - GET /api/transactions/summary parses `payload` (JSON) with the SAME core
 *    schema the IPC handler uses and hands the PARSED request to the core
 *    service; IPC-identical envelope, HTTP 200 even on a refusal (rule 19c);
 *    every signed-in role may read it (the page has no Profits gate);
 *  - GET /api/transactions/recent forwards the drill-down keys
 *    `sale_product_id` / `sale_category` (JSON, so `null` survives) through
 *    the core schema, and refuses a malformed one (rule 23).
 *
 * Written before the route changes (rule 17). Harness: the real router,
 * auth faked by `x-test-role` (as transactionsRecent.api.test.ts).
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
  getTransactionService,
  getTransactionSummaryService,
  transactionSummarySchema,
  type TransactionSummaryInput,
} from "@liratek/core";
import transactionsRouter from "../transactions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  return app;
}

const result = {
  group_by: "service" as const,
  rows: [],
  total: { count: 0, units: null, volume_usd: 0, volume_lbp: 0 },
  truncated: false,
};

describe("LIRA-389 — GET /api/transactions/summary", () => {
  let app: Express;
  const summary = getTransactionSummaryService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it.each(["admin", "staff"])(
    "summarizes the parsed request for %s",
    async (role) => {
      const spy = jest.spyOn(summary, "summarize").mockReturnValue(result);
      const payload: TransactionSummaryInput = {
        group_by: "service",
        include_refunded: true,
        options: [
          { type: "FINANCIAL_SERVICE", provider: "OMT" },
          { cash_only: true },
        ],
        day_from: "2026-11-01",
        day_to: "2026-11-30",
      };
      const res = await request(app)
        .get("/api/transactions/summary")
        .query({ payload: JSON.stringify(payload) })
        .set("x-test-role", role);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: result });
      expect(spy).toHaveBeenCalledWith(transactionSummarySchema.parse(payload));
    },
  );

  it("refuses a bad payload with HTTP 200 and the envelope", async () => {
    const spy = jest.spyOn(summary, "summarize").mockReturnValue(result);
    const res = await request(app)
      .get("/api/transactions/summary")
      .query({ payload: JSON.stringify({ group_by: "profit" }) })
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a payload that is not JSON", async () => {
    const res = await request(app)
      .get("/api/transactions/summary")
      .query({ payload: "{oops" })
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it("needs a signed-in user", async () => {
    const res = await request(app).get("/api/transactions/summary");
    expect(res.status).toBe(401);
  });
});

describe("LIRA-389 — GET /api/transactions/recent drill-down keys", () => {
  let app: Express;
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("forwards sale_product_id as a number and sale_category null", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);
    await request(app)
      .get("/api/transactions/recent")
      .query({ sale_product_id: "12", sale_category: JSON.stringify(null) })
      .set("x-test-role", "staff");
    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.sale_product_id).toBe(12);
    expect(filters).toHaveProperty("sale_category", null);
  });

  it("forwards a named category", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);
    await request(app)
      .get("/api/transactions/recent")
      .query({ sale_category: JSON.stringify("Laptops") })
      .set("x-test-role", "staff");
    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.sale_category).toBe("Laptops");
  });

  it("refuses a malformed drill-down key instead of dropping it", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);
    const res = await request(app)
      .get("/api/transactions/recent")
      .query({ sale_product_id: "abc" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
