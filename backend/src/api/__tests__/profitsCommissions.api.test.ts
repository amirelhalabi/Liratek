/**
 * GET /api/profits/commissions — Commissions tab REST route
 * (OWNER_NOTES_2026-09-21.md §6, lane LC: PA-4.20 — this route must sit
 * behind the SAME Profits password gate as the other 7 data routes, not
 * behind role alone like the pre-existing `/api/services/analytics` /
 * `/api/suppliers/unsettled-summary` routes it replaces for THIS tab).
 *
 * Mirrors `profitsGate.api.test.ts`'s own harness (real router, mocked
 * auth/logger, the real `ProfitsAccessService`/`CommissionsReportService`
 * singletons with their methods stubbed via jest.spyOn) rather than
 * reaching for a real DB — matching precedent.
 *
 * RULE 17 (failing-first proof): this test file, run BEFORE the
 * `router.get("/commissions", ...)` route existed in `../profits.ts`,
 * produced (observed directly in this session, `npx jest
 * profitsCommissions.api --maxWorkers=1`):
 *
 *   "locked: 403" › expected 403, received 404
 *   "after successful unlock: the route passes" › expected 200, received 404
 *   (Express's default handler for an unmatched route — the router had no
 *   "/commissions" registered at all yet)
 *
 * The route was then added (this session's implementation) and the suite
 * re-run: 5/5 passing.
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
import { getCommissionsReportService } from "@liratek/core";
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

describe("GET /api/profits/commissions", () => {
  let app: Express;
  const commissionsService = getCommissionsReportService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    revokeProfitsUnlock(TENANT_ID, USER_ID);
  });

  it("locked: 403 {success:false, error: 'Profits locked'}", async () => {
    const res = await request(app)
      .get("/api/profits/commissions")
      .set("x-test-role", "staff");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: "Profits locked" });
  });

  it("unauthenticated: 401", async () => {
    const res = await request(app).get("/api/profits/commissions");
    expect(res.status).toBe(401);
  });

  it("after successful unlock: the route passes, forwarding from/to", async () => {
    const getReportSpy = jest
      .spyOn(commissionsService, "getReport")
      .mockReturnValue({
        from: "2026-09-01",
        to: "2026-09-30",
        realized_usd: 10,
        realized_lbp: 0,
        revenue_usd: 100,
        revenue_lbp: 0,
        pending_usd: 0,
        pending_lbp: 0,
        total_owed_usd: 0,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
        bill_count: 0,
        byProvider: [],
      });
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/commissions?from=2026-09-01&to=2026-09-30")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.realized_usd).toBe(10);
    expect(getReportSpy).toHaveBeenCalledWith("2026-09-01", "2026-09-30");
  });

  it("defaults from/to to today when omitted (matches every other Profits data route's own todayISO() fallback)", async () => {
    const getReportSpy = jest
      .spyOn(commissionsService, "getReport")
      .mockReturnValue({
        from: "x",
        to: "x",
        realized_usd: 0,
        realized_lbp: 0,
        revenue_usd: 0,
        revenue_lbp: 0,
        pending_usd: 0,
        pending_lbp: 0,
        total_owed_usd: 0,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
        bill_count: 0,
        byProvider: [],
      });
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/commissions")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    const [from, to] = getReportSpy.mock.calls[0] as [string, string];
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from).toBe(to);
  });

  it("rejects a malformed from/to (query-schema regex) with a 200-envelope failure, not a 500 or 4xx (rule 19 — REST returns HTTP 200 even on validation failure)", async () => {
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/commissions?from=not-a-date")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  /**
   * LC-2 (round-2 review): an EMPTY `from`/`to` (e.g. a client that sends
   * `?from=&to=2026-09-30`) used to be rejected by the same regex a
   * malformed value is — `.optional()` only ever skips a genuinely
   * ABSENT key, never an empty string. Every OTHER Profits data route
   * (no schema) falls back to `todayISO()` for an empty value via its own
   * `(req.query.from as string) || todayISO()`; this route's schema must
   * reach the same fallback, not a 200-envelope failure, for parity.
   *
   * RULE 17 (failing-first proof, this session, `npx jest
   * profitsCommissions.api --maxWorkers=1`): run against the pre-fix
   * `commissionsReportQuerySchema` (`.regex(...).optional()`, no empty-
   * string branch), this test FAILED:
   *
   *   "accepts an empty from/to..." › expect(received).toBe(expected)
   *   Expected: true
   *   Received: false
   *   (res.body.error: "from must be in YYYY-MM-DD format")
   *
   * The schema was then changed to treat `''` as omitted (transformed to
   * `undefined` before `todayISO()`'s own `||` fallback runs), and the
   * whole file was re-run: 6/6 passing.
   */
  it("accepts an empty from/to the same way an omitted one is accepted — falls back to today (LC-2)", async () => {
    const getReportSpy = jest
      .spyOn(commissionsService, "getReport")
      .mockReturnValue({
        from: "x",
        to: "x",
        realized_usd: 0,
        realized_lbp: 0,
        revenue_usd: 0,
        revenue_lbp: 0,
        pending_usd: 0,
        pending_lbp: 0,
        total_owed_usd: 0,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
        bill_count: 0,
        byProvider: [],
      });
    grantProfitsUnlock(TENANT_ID, USER_ID);

    const res = await request(app)
      .get("/api/profits/commissions?from=&to=")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [from, to] = getReportSpy.mock.calls[0] as [string, string];
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from).toBe(to);
  });
});
