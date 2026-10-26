/**
 * LIRA-348 — the Audit & Transactions tables open on today, 50 at a time.
 * The web routes they read from take the SAME paging keys as the desktop
 * handlers (rule 19), validated with the shared core schema
 * (`validators/tablePaging.ts`) and merged into the filters each route
 * already builds — no existing filter key is dropped (rule 23):
 *   GET  /api/transactions/recent  ?day_from=&day_to=&before=<json>
 *   POST /api/audit/search          { dayFrom, dayTo, beforeId }
 *
 * Written before the route changes (rule 17).
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
      sessionToken: "s",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
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
  getAuditService,
  getTransactionService,
  transactionPageFiltersSchema,
  auditPageFiltersSchema,
} from "@liratek/core";
import transactionsRouter from "../transactions.js";
import auditRouter from "../audit.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/audit", auditRouter);
  return app;
}

describe("LIRA-348 — paging keys on the Transactions and Audit routes", () => {
  let app: Express;
  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("GET /api/transactions/recent forwards day_from/day_to and the parsed cursor, keeping the other filters", async () => {
    const spy = jest
      .spyOn(getTransactionService(), "getRecent")
      .mockReturnValue([]);
    // Field names come from the shared schema (rule 24).
    const paging = transactionPageFiltersSchema.parse({
      day_from: "2026-10-26",
      day_to: "2026-10-26",
      before: { created_at: "2026-10-26 07:00:01", id: 41 },
    });

    const res = await request(app)
      .get("/api/transactions/recent")
      .query({
        limit: "150",
        search: "screen",
        day_from: paging.day_from,
        day_to: paging.day_to,
        before: JSON.stringify(paging.before),
      })
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    const [limit, filters] = spy.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(limit).toBe(150);
    expect(filters).toMatchObject({ search: "screen", ...paging });
  });

  it("GET /api/transactions/recent refuses a malformed day or cursor instead of ignoring it", async () => {
    const spy = jest
      .spyOn(getTransactionService(), "getRecent")
      .mockReturnValue([]);
    const bad = await request(app)
      .get("/api/transactions/recent")
      .query({ day_from: "26/10/2026" })
      .set("x-test-role", "staff");
    // Rule 19c: the IPC-identical envelope, HTTP 200 even on failure.
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({ success: false, error: expect.any(String) });
    const badCursor = await request(app)
      .get("/api/transactions/recent")
      .query({ before: "{not json" })
      .set("x-test-role", "staff");
    expect(badCursor.status).toBe(200);
    expect(badCursor.body).toEqual({
      success: false,
      error: expect.any(String),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST /api/audit/search forwards dayFrom/dayTo/beforeId with the other filters", async () => {
    const spy = jest
      .spyOn(getAuditService(), "search")
      .mockReturnValue({ rows: [], total: 0 });
    const paging = auditPageFiltersSchema.parse({
      dayFrom: "2026-10-25",
      dayTo: "2026-10-26",
      beforeId: 900,
    });

    const res = await request(app)
      .post("/api/audit/search")
      .send({ action: "VOID", limit: 50, ...paging })
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, rows: [], total: 0 });
    expect(spy.mock.calls[0][0]).toMatchObject({
      action: "VOID",
      limit: 50,
      ...paging,
    });
  });

  it("POST /api/audit/search answers a malformed day with the 200 envelope and never queries", async () => {
    const spy = jest
      .spyOn(getAuditService(), "search")
      .mockReturnValue({ rows: [], total: 0 });
    const res = await request(app)
      .post("/api/audit/search")
      .send({ dayFrom: "yesterday" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
