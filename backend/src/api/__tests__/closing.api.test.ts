/**
 * Closing REST route tests — CQ-9 follow-up (rule 19): REST mirrors for the
 * three Dashboard.tsx reads that previously had no REST route and were
 * gated behind isElectron() (getLastCheckpointPerDrawer, hasInitialBalancesSet,
 * hasStartingCheckpoint — see docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md).
 *
 * Hits the REAL router (../closing.js) through a minimal Express app; only
 * ../../server.js (logger) and ../../middleware/auth.js (x-test-role stand-in
 * for authenticateJWT/requireRole) are faked, mirroring suppliers.api.test.ts.
 * ClosingService is the REAL singleton with its two/three methods under test
 * stubbed via jest.spyOn, proving the route wires the exact same envelope
 * shape the IPC handlers (electron-app/handlers/dbHandlers.ts) return.
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
import { getClosingService } from "@liratek/core";
import closingRouter from "../closing.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/closing", closingRouter);
  return app;
}

describe("Closing REST routes — CQ-9 follow-up", () => {
  let app: Express;
  const closingService = getClosingService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  // ── GET /api/closing/last-checkpoint-per-drawer ───────────────────────────
  describe("GET /api/closing/last-checkpoint-per-drawer", () => {
    it("401s without auth", async () => {
      const res = await request(app).get(
        "/api/closing/last-checkpoint-per-drawer",
      );
      expect(res.status).toBe(401);
    });

    it("200s with {success:true, data} — matches IPC's envelope", async () => {
      const fake = {
        General: {
          drawer_name: "General",
          checked_at: "2026-07-18T10:00:00Z",
          amounts: { USD: { physical: 100, expected: 100 } },
        },
      };
      jest
        .spyOn(closingService, "getLastCheckpointPerDrawer")
        .mockReturnValue(fake as any);

      const res = await request(app)
        .get("/api/closing/last-checkpoint-per-drawer")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: fake });
    });

    it("500s with {success:false, error} on service failure — matches IPC's failure shape", async () => {
      jest
        .spyOn(closingService, "getLastCheckpointPerDrawer")
        .mockImplementation(() => {
          throw new Error("boom");
        });

      const res = await request(app)
        .get("/api/closing/last-checkpoint-per-drawer")
        .set("x-test-role", "staff");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── GET /api/closing/has-initial-balances-set ─────────────────────────────
  describe("GET /api/closing/has-initial-balances-set", () => {
    it("401s without auth", async () => {
      const res = await request(app).get(
        "/api/closing/has-initial-balances-set",
      );
      expect(res.status).toBe(401);
    });

    it("200s with {success:true, isSet:true} when set", async () => {
      jest
        .spyOn(closingService, "hasInitialBalancesSet")
        .mockReturnValue(true);

      const res = await request(app)
        .get("/api/closing/has-initial-balances-set")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, isSet: true });
    });

    it("never hard-fails — resolves {success:false, isSet:false} on service throw (matches the IPC handler's conservative default)", async () => {
      jest
        .spyOn(closingService, "hasInitialBalancesSet")
        .mockImplementation(() => {
          throw new Error("boom");
        });

      const res = await request(app)
        .get("/api/closing/has-initial-balances-set")
        .set("x-test-role", "staff");

      // Always HTTP 200 — the two-transport contract for this read never
      // throws to the caller, it degrades to a safe default instead.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, isSet: false });
    });
  });

  // ── GET /api/closing/has-starting-checkpoint ──────────────────────────────
  describe("GET /api/closing/has-starting-checkpoint", () => {
    it("401s without auth", async () => {
      const res = await request(app).get(
        "/api/closing/has-starting-checkpoint",
      );
      expect(res.status).toBe(401);
    });

    it("200s with {success:true, isSet:false} when not yet recorded", async () => {
      jest
        .spyOn(closingService, "hasStartingCheckpoint")
        .mockReturnValue(false);

      const res = await request(app)
        .get("/api/closing/has-starting-checkpoint")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, isSet: false });
    });

    it("never hard-fails — resolves {success:false, isSet:true} on service throw (opposite default of has-initial-balances-set, so the setup banner never wrongly fires)", async () => {
      jest
        .spyOn(closingService, "hasStartingCheckpoint")
        .mockImplementation(() => {
          throw new Error("boom");
        });

      const res = await request(app)
        .get("/api/closing/has-starting-checkpoint")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, isSet: true });
    });
  });
});
