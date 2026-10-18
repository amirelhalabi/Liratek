/**
 * LIRA-335 (T026) — checkpoint-difference REST routes, the twins of the IPC
 * channels in electron-app/handlers/dbHandlers.ts:
 *   GET  /api/closing/differences/open-after?at=…   (admin + staff; no names for staff)
 *   POST /api/closing/differences/close   {difference_id}  (admin)
 *   POST /api/closing/differences/reopen  {difference_id}  (admin)
 * plus `open_only` on GET /api/closing/checkpoint-timeline.
 *
 * Rule 17: written before the routes existed and run against them.
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

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
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
import { getClosingService } from "@liratek/core";
import { auditRest } from "../../middleware/audit.js";
import closingRouter from "../closing.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/closing", closingRouter);
  return app;
}

function makeDifference() {
  return {
    id: 7,
    closing_id: 3,
    closing_created_at: "2026-10-18 18:00:00",
    drawer_name: "General",
    currency_code: "USD",
    amount: -50,
    direction: "SHORT",
    resolved: 20,
    open: 30,
    status: "PARTLY_RESOLVED",
    closed_at: "2026-10-18 19:00:00",
    closed_by_name: "OwnerAlice",
    shortage_expense_id: null,
    resolutions: [
      {
        transaction_id: 99,
        transaction_type: "SALE",
        summary: "Sale #99",
        amount: -20,
        effective_time: "2026-10-18 17:30:00",
        entered_at: "2026-10-18 18:30:00",
        user_name: "CashierBob",
      },
    ],
  };
}

type Stub = jest.Mock<(...args: unknown[]) => unknown>;

describe("LIRA-335 checkpoint-difference REST routes", () => {
  let app: Express;
  const service = getClosingService() as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();

  /** Install a stub on the service singleton (works whether or not the
   *  method exists yet) and restore it after the test. */
  function stub(name: string, value: unknown): Stub {
    if (!originals.has(name)) originals.set(name, service[name]);
    const fn = jest.fn(() => value) as Stub;
    service[name] = fn;
    return fn;
  }

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const [name, original] of originals) service[name] = original;
    originals.clear();
  });

  describe("GET /differences/open-after", () => {
    const path = "/api/closing/differences/open-after";

    it("returns the full view to admin", async () => {
      const fn = stub("getOpenDifferencesAfter", {
        success: true,
        data: [makeDifference()],
      });
      const res = await request(app)
        .get(path)
        .query({ at: "2026-10-18 17:00:00" })
        .set("x-test-role", "admin");
      expect(res.status).toBe(200);
      expect(fn).toHaveBeenCalledWith({ at: "2026-10-18 17:00:00" });
      expect(res.body).toEqual({ success: true, data: [makeDifference()] });
    });

    it("lets staff read it, with resolutions and closed_by_name blanked", async () => {
      stub("getOpenDifferencesAfter", {
        success: true,
        data: [makeDifference()],
      });
      const res = await request(app)
        .get(path)
        .query({ at: "2026-10-18 17:00:00" })
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].resolutions).toEqual([]);
      expect(res.body.data[0].closed_by_name).toBeNull();
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          drawer_name: "General",
          currency_code: "USD",
          open: 30,
          closing_created_at: "2026-10-18 18:00:00",
        }),
      );
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("OwnerAlice");
      expect(text).not.toContain("CashierBob");
    });

    it("refuses an unauthenticated caller", async () => {
      const fn = stub("getOpenDifferencesAfter", { success: true, data: [] });
      const res = await request(app)
        .get(path)
        .query({ at: "2026-10-18 17:00:00" });
      expect(res.status).toBe(401);
      expect(fn).not.toHaveBeenCalled();
    });

    it("refuses a missing `at` with the 200 envelope", async () => {
      const fn = stub("getOpenDifferencesAfter", { success: true, data: [] });
      const res = await request(app).get(path).set("x-test-role", "admin");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      path: "/api/closing/differences/close",
      method: "closeCheckpointDifference",
      action: "close_checkpoint_difference",
    },
    {
      path: "/api/closing/differences/reopen",
      method: "reopenCheckpointDifference",
      action: "reopen_checkpoint_difference",
    },
  ])("POST $path", ({ path, method, action }) => {
    it("is admin only", async () => {
      const fn = stub(method, { success: true });
      const res = await request(app)
        .post(path)
        .set("x-test-role", "staff")
        .send({ difference_id: 7 });
      expect(res.status).toBe(403);
      expect(fn).not.toHaveBeenCalled();
    });

    it("validates difference_id (HTTP 200 envelope)", async () => {
      const fn = stub(method, { success: true });
      for (const bad of [{}, { difference_id: 0 }, { difference_id: "7" }]) {
        const res = await request(app)
          .post(path)
          .set("x-test-role", "admin")
          .send(bad);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("takes userId from the JWT, never the body, and audits on success", async () => {
      const diff = makeDifference();
      const fn = stub(method, { success: true, data: diff });
      const res = await request(app)
        .post(path)
        .set("x-test-role", "admin")
        .send({ difference_id: 7, userId: 999 });
      expect(res.status).toBe(200);
      expect(fn).toHaveBeenCalledWith({ difference_id: 7, userId: 42 });
      expect(res.body).toEqual({ success: true, data: diff });
      expect(auditRest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action,
          entity_type: "checkpoint_differences",
          entity_id: "7",
        }),
      );
    });

    it("passes a refusal through with HTTP 200 and no audit", async () => {
      stub(method, { success: false, error: "Already closed" });
      const res = await request(app)
        .post(path)
        .set("x-test-role", "admin")
        .send({ difference_id: 7 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, error: "Already closed" });
      expect(auditRest).not.toHaveBeenCalled();
    });
  });

  describe("GET /checkpoint-timeline open_only", () => {
    const path = "/api/closing/checkpoint-timeline";

    it.each(["1", "true"])(
      "open_only=%s reaches the service as true",
      async (v) => {
        const fn = stub("getCheckpointTimeline", {
          success: true,
          checkpoints: [],
          open_count: 0,
        });
        const res = await request(app)
          .get(path)
          .query({ open_only: v })
          .set("x-test-role", "admin");
        expect(res.status).toBe(200);
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({ open_only: true }),
        );
        expect(res.body).toEqual({
          success: true,
          checkpoints: [],
          open_count: 0,
        });
      },
    );

    it.each(["0", "false", ""])(
      "open_only=%s does not turn the filter on",
      async (v) => {
        const fn = stub("getCheckpointTimeline", {
          success: true,
          checkpoints: [],
        });
        await request(app)
          .get(path)
          .query({ open_only: v })
          .set("x-test-role", "admin");
        expect(fn).toHaveBeenCalledTimes(1);
        const filters = fn.mock.calls[0][0] as Record<string, unknown>;
        expect(filters.open_only).not.toBe(true);
      },
    );
  });
});
