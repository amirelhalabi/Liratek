/**
 * Profits password gate REST route tests (LIRA-177 §5 verification gap —
 * this feature previously had ZERO REST-transport coverage).
 *
 * Hits the REAL router (../profits.js) through a minimal Express app; only
 * ../../server.js (logger) and ../../middleware/auth.js (x-test-role
 * stand-in for authenticateJWT/requireRole) are faked, mirroring
 * closing.api.test.ts / suppliers.api.test.ts. ProfitsAccessService and
 * ProfitService are the REAL singletons with their methods stubbed via
 * jest.spyOn — this proves the route wires the exact envelope/status-code
 * contract the frontend depends on, without a real DB round trip.
 *
 * `requireProfitsUnlock` (middleware/profitsUnlock.ts) keeps module-level
 * state (a `Map<"tenantId:userId", timestamp>`) — the mocked auth below
 * always produces the SAME user (tenantId 1, userId 42), so every test
 * explicitly revokes that user's unlock in beforeEach to stop state leaking
 * across cases (the file header's own warning).
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
  getProfitsAccessService,
  getProfitService,
  PROFITS_UNLOCK_TTL_MS,
} from "@liratek/core";
import profitsRouter from "../profits.js";
import { revokeProfitsUnlock, grantProfitsUnlock } from "../../middleware/profitsUnlock.js";

const TENANT_ID = 1;
const USER_ID = 42;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/profits", profitsRouter);
  return app;
}

describe("Profits password gate REST routes", () => {
  let app: Express;
  const accessService = getProfitsAccessService();
  const profitService = getProfitService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    // The middleware's unlock map is module-level state shared across every
    // test in this file (mocked auth always resolves to the same user) —
    // start every test from a known-locked baseline.
    revokeProfitsUnlock(TENANT_ID, USER_ID);
  });

  // ── GET /password-status ─────────────────────────────────────────────────
  describe("GET /api/profits/password-status", () => {
    it("401s without auth", async () => {
      const res = await request(app).get("/api/profits/password-status");
      expect(res.status).toBe(401);
    });

    it("admin: reflects isSet:true", async () => {
      jest.spyOn(accessService, "isPasswordSet").mockReturnValue(true);
      const res = await request(app)
        .get("/api/profits/password-status")
        .set("x-test-role", "admin");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { isSet: true } });
    });

    it("staff: reflects isSet:false — no password required to ask", async () => {
      jest.spyOn(accessService, "isPasswordSet").mockReturnValue(false);
      const res = await request(app)
        .get("/api/profits/password-status")
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { isSet: false } });
    });
  });

  // ── PUT /password — admin-only boundary ─────────────────────────────────
  describe("PUT /api/profits/password", () => {
    it("admin succeeds", async () => {
      jest
        .spyOn(accessService, "setPassword")
        .mockReturnValue({ success: true });
      const res = await request(app)
        .put("/api/profits/password")
        .set("x-test-role", "admin")
        .send({ password: "abcd" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it("staff gets 403 — admin-only boundary", async () => {
      const setPasswordSpy = jest.spyOn(accessService, "setPassword");
      const res = await request(app)
        .put("/api/profits/password")
        .set("x-test-role", "staff")
        .send({ password: "abcd" });
      expect(res.status).toBe(403);
      expect(setPasswordSpy).not.toHaveBeenCalled();
    });
  });

  // ── POST /unlock ──────────────────────────────────────────────────────────
  describe("POST /api/profits/unlock", () => {
    it("wrong password: {success:false}, HTTP 200, no unlock granted", async () => {
      jest.spyOn(accessService, "verify").mockReturnValue(false);
      jest.spyOn(profitService, "getSummary").mockReturnValue({} as any);

      const unlockRes = await request(app)
        .post("/api/profits/unlock")
        .set("x-test-role", "staff")
        .send({ password: "wrong" });
      expect(unlockRes.status).toBe(200);
      expect(unlockRes.body).toEqual({
        success: false,
        error: "Incorrect password",
      });

      const dataRes = await request(app)
        .get("/api/profits/summary")
        .set("x-test-role", "staff");
      expect(dataRes.status).toBe(403);
      expect(dataRes.body).toEqual({
        success: false,
        error: "Profits locked",
      });
    });

    it("correct password: {success:true}", async () => {
      jest.spyOn(accessService, "verify").mockReturnValue(true);
      const res = await request(app)
        .post("/api/profits/unlock")
        .set("x-test-role", "staff")
        .send({ password: "correct" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it("fail-closed: no password set → {success:false}, grants nothing", async () => {
      // ProfitsAccessService.verify() is itself fail-closed when no password
      // has been set — mirror that contract here rather than the route.
      jest.spyOn(accessService, "verify").mockReturnValue(false);
      jest.spyOn(profitService, "getSummary").mockReturnValue({} as any);

      const unlockRes = await request(app)
        .post("/api/profits/unlock")
        .set("x-test-role", "admin")
        .send({ password: "anything" });
      expect(unlockRes.body).toEqual({
        success: false,
        error: "Incorrect password",
      });

      const dataRes = await request(app)
        .get("/api/profits/summary")
        .set("x-test-role", "admin");
      expect(dataRes.status).toBe(403);
    });
  });

  // ── Gate on the 7 data routes ─────────────────────────────────────────────
  describe("gate on data routes (/api/profits/summary as representative)", () => {
    it("locked: 403 {success:false, error: 'Profits locked'}", async () => {
      const res = await request(app)
        .get("/api/profits/summary")
        .set("x-test-role", "staff");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: "Profits locked" });
    });

    it("after successful unlock: the route passes", async () => {
      jest.spyOn(profitService, "getSummary").mockReturnValue({
        total_profit_usd: 100,
      } as any);
      grantProfitsUnlock(TENANT_ID, USER_ID);

      const res = await request(app)
        .get("/api/profits/summary")
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("unauthenticated: 401", async () => {
      const res = await request(app).get("/api/profits/summary");
      expect(res.status).toBe(401);
    });
  });

  // ── Both roles can unlock and read — the point of the feature ───────────
  describe("staff and admin can both unlock then read (password gates, not role)", () => {
    it.each(["staff", "admin"] as const)(
      "%s: unlock then read succeeds",
      async (role) => {
        jest.spyOn(accessService, "verify").mockReturnValue(true);
        jest
          .spyOn(profitService, "getSummary")
          .mockReturnValue({ total_profit_usd: 1 } as any);

        const unlockRes = await request(app)
          .post("/api/profits/unlock")
          .set("x-test-role", role)
          .send({ password: "correct" });
        expect(unlockRes.body).toEqual({ success: true });

        const dataRes = await request(app)
          .get("/api/profits/summary")
          .set("x-test-role", role);
        expect(dataRes.status).toBe(200);
        expect(dataRes.body.success).toBe(true);
      },
    );
  });

  // ── TTL expiry ────────────────────────────────────────────────────────────
  describe("TTL expiry", () => {
    it("a granted unlock re-locks the data route once its TTL has elapsed — never sleeps, drives Date.now() forward instead", async () => {
      jest.spyOn(profitService, "getSummary").mockReturnValue({} as any);

      const start = 2_000_000_000_000; // arbitrary fixed epoch ms
      const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(start);
      try {
        // Grant with the real (mocked) clock, exactly like the /unlock route
        // does internally (it calls grantProfitsUnlock with no `now` arg).
        grantProfitsUnlock(TENANT_ID, USER_ID);

        dateNowSpy.mockReturnValue(start + PROFITS_UNLOCK_TTL_MS - 1);
        const stillLive = await request(app)
          .get("/api/profits/summary")
          .set("x-test-role", "staff");
        expect(stillLive.status).toBe(200);

        dateNowSpy.mockReturnValue(start + PROFITS_UNLOCK_TTL_MS);
        const expired = await request(app)
          .get("/api/profits/summary")
          .set("x-test-role", "staff");
        expect(expired.status).toBe(403);
        expect(expired.body).toEqual({
          success: false,
          error: "Profits locked",
        });
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });
});
