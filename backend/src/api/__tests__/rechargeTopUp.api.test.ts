/**
 * Recharge top-up-arm REST route tests — CARRIER_LINES_VALIDITY_PLAN.md
 * Phase 8.4 (dual-transport parity for the four kept top-up arms).
 *
 * `topUpApp`, `topUpFromSupplier`, `topUpFromPartner` and `topUpFromClient`
 * were raw `window.api.*` calls with ZERO REST routes before this phase.
 * These tests prove, per the task's stated bar (lighter than
 * recharge.api.test.ts's real-DB drawer-delta proof):
 *   1. Role parity — a `staff`-excluded... actually all four IPC handlers
 *      are `requireRole(["admin", "staff"])`, so the REAL parity check here
 *      is that an UNAUTHENTICATED/wrong-role caller (neither admin nor
 *      staff — there is no third role) is refused and never reaches the
 *      service.
 *   2. The route reaches the SAME core service method the IPC handler does,
 *      with the body + the JWT-derived `userId` (never a client-supplied
 *      one) forwarded.
 *
 * Pattern: like suppliers.api.test.ts, this stubs the REAL RechargeService
 * singleton's public methods via `jest.spyOn` rather than standing up a real
 * DB — the assertion that matters here is wiring (body/user → service call),
 * not the money math (already proven at the repository layer by
 * RechargeRepository.topup.test.ts and the RechargeRepository jest suite).
 *
 * Also covers GET /drawer-balances — the follow-up fix for a finding that
 * `handleTopUpClick` (Recharge/index.tsx), the entry point opening the
 * top-up modal for all four arms above, still made a raw, unguarded
 * `window.api.recharge.getDrawerBalances()` call with no REST twin. In the
 * browser that throws before `setShowTopUpModal(true)`, so the modal for
 * all four arms never opened on web even though their submit routes were
 * already wired. `recharge:get-drawer-balances` (rechargeHandlers.ts) has no
 * `requireRole`, so this route is deliberately NOT role-gated either —
 * parity here means "any authenticated session", not "admin/staff only".
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
import { getRechargeService } from "@liratek/core";
import rechargeRouter from "../recharge.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/recharge", rechargeRouter);
  return app;
}

describe("Recharge top-up-arm REST routes (Phase 8.4)", () => {
  let app: Express;
  const rechargeService = getRechargeService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  // ── GET /drawer-balances ─────────────────────────────────────────────────
  describe("GET /api/recharge/drawer-balances", () => {
    it("any authenticated role reaches the service (no requireRole, matching the IPC handler)", async () => {
      const spy = jest
        .spyOn(rechargeService, "getDrawerBalances")
        .mockReturnValue([
          { name: "General", usdBalance: 100, lbpBalance: 0, usdtBalance: 0 },
          { name: "OMT_App", usdBalance: 25, lbpBalance: 0, usdtBalance: 0 },
        ]);

      const res = await request(app)
        .get("/api/recharge/drawer-balances")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        balances: [
          { name: "General", usdBalance: 100, lbpBalance: 0, usdtBalance: 0 },
          { name: "OMT_App", usdBalance: 25, lbpBalance: 0, usdtBalance: 0 },
        ],
      });
      expect(spy).toHaveBeenCalledWith();
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "getDrawerBalances");

      const res = await request(app).get("/api/recharge/drawer-balances");

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it("surfaces a service exception as { success: false, error } instead of an unhandled 500", async () => {
      jest
        .spyOn(rechargeService, "getDrawerBalances")
        .mockImplementation(() => {
          throw new Error("db exploded");
        });

      const res = await request(app)
        .get("/api/recharge/drawer-balances")
        .set("x-test-role", "admin");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── GET /history (LIRA-103) ──────────────────────────────────────────────
  describe("GET /api/recharge/history", () => {
    it("any authenticated role reaches the service with the query provider (no requireRole, matching the IPC handler)", async () => {
      const spy = jest.spyOn(rechargeService, "getHistory").mockReturnValue([
        {
          id: 1,
          carrier: "MTC",
          recharge_type: "CREDIT_TRANSFER",
          amount: 5,
          cost: 4,
          price: 5,
          default_price_to_client: null,
          currency_code: "USD",
          paid_by: "CASH",
          phone_number: "03000091",
          client_id: null,
          client_name: null,
          note: null,
          created_at: "2026-08-08T00:00:00.000Z",
          created_by: 42,
          edited_by: null,
          edited_at: null,
        },
      ]);

      const res = await request(app)
        .get("/api/recharge/history?provider=MTC")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.history).toHaveLength(1);
      expect(res.body.history[0]).toMatchObject({
        id: 1,
        carrier: "MTC",
      });
      expect(spy).toHaveBeenCalledWith("MTC");
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "getHistory");

      const res = await request(app).get(
        "/api/recharge/history?provider=MTC",
      );

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a missing provider — rule 19c: 200 + string error, never a 4xx", async () => {
      const spy = jest.spyOn(rechargeService, "getHistory");

      const res = await request(app)
        .get("/api/recharge/history")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a provider outside MTC/Alfa — rule 19c: 200 + string error, never a 4xx", async () => {
      const spy = jest.spyOn(rechargeService, "getHistory");

      const res = await request(app)
        .get("/api/recharge/history?provider=OMT")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("surfaces a service exception as { success: false, error } instead of an unhandled 500", async () => {
      jest.spyOn(rechargeService, "getHistory").mockImplementation(() => {
        throw new Error("db exploded");
      });

      const res = await request(app)
        .get("/api/recharge/history?provider=Alfa")
        .set("x-test-role", "admin");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── POST /top-up-app ─────────────────────────────────────────────────────
  describe("POST /api/recharge/top-up-app", () => {
    it("reaches RechargeService.topUpApp with the body + JWT-derived userId", async () => {
      const spy = jest
        .spyOn(rechargeService, "topUpApp")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .post("/api/recharge/top-up-app")
        .set("x-test-role", "admin")
        .send({
          provider: "OMT_APP",
          amount: 50,
          currency: "USD",
          sourceDrawer: "General",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith({
        provider: "OMT_APP",
        amount: 50,
        currency: "USD",
        sourceDrawer: "General",
        userId: 42,
      });
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "topUpApp");

      const res = await request(app).post("/api/recharge/top-up-app").send({
        provider: "OMT_APP",
        amount: 50,
        currency: "USD",
        sourceDrawer: "General",
      });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a missing amount (Zod, before the service is ever reached) — rule 19c: 200 + string error", async () => {
      const spy = jest.spyOn(rechargeService, "topUpApp");

      const res = await request(app)
        .post("/api/recharge/top-up-app")
        .set("x-test-role", "admin")
        .send({
          provider: "OMT_APP",
          currency: "USD",
          sourceDrawer: "General",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── POST /top-up-from-supplier ───────────────────────────────────────────
  describe("POST /api/recharge/top-up-from-supplier", () => {
    it("reaches RechargeService.topUpFromSupplier with the body + JWT-derived userId (role parity: staff)", async () => {
      const spy = jest
        .spyOn(rechargeService, "topUpFromSupplier")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .post("/api/recharge/top-up-from-supplier")
        .set("x-test-role", "staff")
        .send({ provider: "iPick", amount: 20, currency: "USD" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith({
        provider: "iPick",
        amount: 20,
        currency: "USD",
        userId: 42,
      });
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "topUpFromSupplier");

      const res = await request(app)
        .post("/api/recharge/top-up-from-supplier")
        .send({ provider: "iPick", amount: 20, currency: "USD" });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── POST /top-up-from-partner ────────────────────────────────────────────
  describe("POST /api/recharge/top-up-from-partner", () => {
    it("reaches RechargeService.topUpFromPartner with the body + JWT-derived userId (role parity: staff)", async () => {
      const spy = jest
        .spyOn(rechargeService, "topUpFromPartner")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .post("/api/recharge/top-up-from-partner")
        .set("x-test-role", "staff")
        .send({
          provider: "WHISH_APP",
          partnerId: 7,
          amount: 30,
          currency: "USD",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith({
        provider: "WHISH_APP",
        partnerId: 7,
        amount: 30,
        currency: "USD",
        userId: 42,
      });
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "topUpFromPartner");

      const res = await request(app)
        .post("/api/recharge/top-up-from-partner")
        .send({
          provider: "WHISH_APP",
          partnerId: 7,
          amount: 30,
          currency: "USD",
        });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── POST /top-up-from-client ─────────────────────────────────────────────
  describe("POST /api/recharge/top-up-from-client", () => {
    it("reaches RechargeService.topUpFromClient with the body + JWT-derived userId (role parity: staff)", async () => {
      const spy = jest
        .spyOn(rechargeService, "topUpFromClient")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .post("/api/recharge/top-up-from-client")
        .set("x-test-role", "staff")
        .send({
          amount: 40,
          cashPaid: 38,
          currency: "USD",
          clientName: "Walk-in",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledWith({
        amount: 40,
        cashPaid: 38,
        currency: "USD",
        clientName: "Walk-in",
        userId: 42,
      });
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "topUpFromClient");

      const res = await request(app)
        .post("/api/recharge/top-up-from-client")
        .send({ amount: 40, cashPaid: 38, currency: "USD" });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── POST /update-metadata (LIRA-109) ─────────────────────────────────────
  //
  // `recharge:update-metadata` (rechargeHandlers.ts) requires
  // requireRole(["admin", "staff"]) — same gate as the four top-up arms
  // above. Before this ticket the IPC handler had NO Zod validation at all
  // (a raw typed arg); `updateRechargeMetadataSchema` closes that gap on
  // BOTH transports (rules 14 + 19b), so the validation-rejection case below
  // is new for this endpoint specifically, not just a REST-vs-IPC parity
  // check.
  describe("POST /api/recharge/update-metadata", () => {
    it("staff reaches RechargeService.updateRechargeMetadata with the body + JWT-derived editedBy (never a client-supplied one)", async () => {
      const spy = jest
        .spyOn(rechargeService, "updateRechargeMetadata")
        .mockReturnValue({
          success: true,
          entity: { id: 7, phone_number: "70123456" } as any,
        });

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "staff")
        .send({
          id: 7,
          phone_number: "70123456",
          client_name: "Walk-in",
          note: "corrected number",
          // Not part of the schema — must be stripped before the service is
          // called, and must NEVER be used as editedBy even if a client
          // tried to smuggle one in.
          editedBy: "someone-else",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { id: 7, phone_number: "70123456" },
      });
      // "tester" is the mocked JWT's username (see the auth.js mock above,
      // req.user.username) — proves the actor comes from the token, not the
      // request body, mirroring the IPC handler's server-side username
      // resolution (rechargeHandlers.ts: userRepo.findById(auth.userId)).
      expect(spy).toHaveBeenCalledWith(
        7,
        {
          phone_number: "70123456",
          client_name: "Walk-in",
          note: "corrected number",
        },
        "tester",
      );
    });

    it("admin reaches the service too (role parity: both admin and staff, matching the IPC handler)", async () => {
      const spy = jest
        .spyOn(rechargeService, "updateRechargeMetadata")
        .mockReturnValue({ success: true, entity: { id: 9 } as any });

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "admin")
        .send({ id: 9, note: "admin edit" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(9, { note: "admin edit" }, "tester");
    });

    it("an unauthenticated caller is refused with 401 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "updateRechargeMetadata");

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .send({ id: 7, note: "x" });

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it("a role outside admin/staff is refused with 403 and never reaches the service", async () => {
      const spy = jest.spyOn(rechargeService, "updateRechargeMetadata");

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "viewer")
        .send({ id: 7, note: "x" });

      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a missing id (Zod, before the service is ever reached) — rule 19c: 200 + string error, never a 4xx", async () => {
      const spy = jest.spyOn(rechargeService, "updateRechargeMetadata");

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "admin")
        .send({ note: "no id" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a non-positive id (Zod) — rule 19c: 200 + string error, never a 4xx", async () => {
      const spy = jest.spyOn(rechargeService, "updateRechargeMetadata");

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "admin")
        .send({ id: -1, note: "bad id" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("maps a business-rule failure (e.g. row not found) to the IPC-identical envelope — HTTP 200, success: false", async () => {
      const spy = jest
        .spyOn(rechargeService, "updateRechargeMetadata")
        .mockReturnValue({ success: false, error: "Recharge not found" });

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "admin")
        .send({ id: 999, note: "ghost row" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "Recharge not found",
      });
      expect(spy).toHaveBeenCalledWith(999, { note: "ghost row" }, "tester");
    });

    it("surfaces a service exception as { success: false, error } instead of an unhandled 500", async () => {
      jest
        .spyOn(rechargeService, "updateRechargeMetadata")
        .mockImplementation(() => {
          throw new Error("db exploded");
        });

      const res = await request(app)
        .post("/api/recharge/update-metadata")
        .set("x-test-role", "admin")
        .send({ id: 7, note: "x" });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
