/**
 * Debts REST route tests (CQ-9 — web/REST parity + role alignment).
 *
 * Hits the REAL router (../debts.js) — real Zod schemas via validateRequest
 * — through a minimal Express app. Only ../../middleware/auth.js is faked (a
 * header-driven `x-test-role` stand-in for authenticateJWT/requireRole).
 * DebtService is the REAL singleton (backed by jest.setup.ts's mock DB) with
 * public methods stubbed via `jest.spyOn` per test.
 */

import { jest } from "@jest/globals";

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
import { getDebtService, getAuditService } from "@liratek/core";
import debtsRouter from "../debts.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/debts", debtsRouter);
  return app;
}

describe("Debts REST routes", () => {
  let app: Express;
  const debtService = getDebtService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  // ── Role-alignment regression guards (CQ-9) ─────────────────────────────
  describe("role alignment with the IPC twins", () => {
    it("POST /repayments now allows staff (was admin-only; debt:add-repayment allows admin+staff)", async () => {
      const spy = jest
        .spyOn(debtService, "addRepayment")
        .mockReturnValue({ success: true, id: 1 });

      const res = await request(app)
        .post("/api/debts/repayments")
        .set("x-test-role", "staff")
        .send({ clientId: 1, amountUSD: 10, amountLBP: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 1 });
      expect(spy).toHaveBeenCalled();
    });

    it("POST /repayments still rejects a role outside admin+staff", async () => {
      const res = await request(app)
        .post("/api/debts/repayments")
        .set("x-test-role", "nobody")
        .send({ clientId: 1, amountUSD: 10, amountLBP: 0 });

      expect(res.status).toBe(403);
    });

    it("GET /clients/:clientId/balance now requires admin+staff (was open to any authenticated role; debt:client-balance gates admin+staff)", async () => {
      const res = await request(app)
        .get("/api/debts/clients/1/balance")
        .set("x-test-role", "nobody");

      expect(res.status).toBe(403);
    });

    it("GET /clients/:clientId/balance still allows staff", async () => {
      jest
        .spyOn(debtService, "getClientBalance")
        .mockReturnValue({ balance_usd: 5, balance_lbp: 0 });

      const res = await request(app)
        .get("/api/debts/clients/1/balance")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { balance_usd: 5, balance_lbp: 0 },
      });
    });
  });

  // ── POST /use-credit (new CQ-9 route) ───────────────────────────────────
  describe("POST /api/debts/use-credit", () => {
    it("rejects a role outside admin+staff (mirrors debt:use-credit)", async () => {
      const res = await request(app)
        .post("/api/debts/use-credit")
        .set("x-test-role", "nobody")
        .send({ clientId: 1, amountUsd: 10, amountLbp: 0 });

      expect(res.status).toBe(403);
    });

    it("rejects when neither amount is greater than 0 (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/debts/use-credit")
        .set("x-test-role", "admin")
        .send({ clientId: 1, amountUsd: 0, amountLbp: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path hits DebtService.useCredit with userId from the JWT", async () => {
      const spy = jest
        .spyOn(debtService, "useCredit")
        .mockReturnValue({ success: true, id: 8 });

      const res = await request(app)
        .post("/api/debts/use-credit")
        .set("x-test-role", "staff")
        .send({ clientId: 1, amountUsd: 15, amountLbp: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 8 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 1, amountUsd: 15, userId: 42 }),
      );
    });
  });

  // ── POST /update-metadata (new CQ-9 route) ──────────────────────────────
  describe("POST /api/debts/update-metadata", () => {
    it("rejects a role outside admin+staff (mirrors debts:update-metadata)", async () => {
      const res = await request(app)
        .post("/api/debts/update-metadata")
        .set("x-test-role", "nobody")
        .send({ id: 1, note: "hi" });

      expect(res.status).toBe(403);
    });

    it("rejects when id is missing (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/debts/update-metadata")
        .set("x-test-role", "admin")
        .send({ note: "hi" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path reshapes the envelope to { success, data } like the IPC handler", async () => {
      const entity = { id: 1, note: "updated" };
      const spy = jest
        .spyOn(debtService, "updateDebtMetadata")
        .mockReturnValue({ success: true, entity: entity as any });

      const res = await request(app)
        .post("/api/debts/update-metadata")
        .set("x-test-role", "admin")
        .send({ id: 1, note: "updated" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: entity });
      expect(spy).toHaveBeenCalledWith(1, { note: "updated" }, "tester");
    });

    it("failure path surfaces { success: false, error } like the IPC handler", async () => {
      jest.spyOn(debtService, "updateDebtMetadata").mockReturnValue({
        success: false,
        error: "Debt entry not found",
      });

      const res = await request(app)
        .post("/api/debts/update-metadata")
        .set("x-test-role", "admin")
        .send({ id: 999, note: "updated" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "Debt entry not found",
      });
    });
  });

  // ── Audit trail (LIRA-104) ──────────────────────────────────────────────
  describe("audit trail — POST /api/debts/repayments", () => {
    it("a successful repayment records an audit entry with the JWT's actor, never the body's", async () => {
      jest.spyOn(debtService, "addRepayment").mockReturnValue({
        success: true,
        id: 1,
      });
      const auditSpy = jest
        .spyOn(getAuditService(), "log")
        .mockImplementation(() => {});

      await request(app)
        .post("/api/debts/repayments")
        .set("x-test-role", "staff")
        // A spoofed user_id/username in the body must be ignored — the
        // actor comes ONLY from req.user (the mocked auth middleware sets
        // userId 42 / "tester" regardless of what's sent here.
        .send({
          clientId: 1,
          amountUSD: 10,
          amountLBP: 0,
          user_id: 999,
          username: "attacker",
        });

      expect(auditSpy).toHaveBeenCalledTimes(1);
      const entry = auditSpy.mock.calls[0][0];
      expect(entry.action).toBe("create");
      expect(entry.entity_type).toBe("repayment");
      expect(entry.user_id).toBe(42);
      expect(entry.username).toBe("tester");
      expect(entry.role).toBe("staff");
    });

    it("a business failure (service returns success:false) records NO audit entry", async () => {
      jest.spyOn(debtService, "addRepayment").mockReturnValue({
        success: false,
        error: "Client not found",
      });
      const auditSpy = jest
        .spyOn(getAuditService(), "log")
        .mockImplementation(() => {});

      const res = await request(app)
        .post("/api/debts/repayments")
        .set("x-test-role", "admin")
        .send({ clientId: 999, amountUSD: 10, amountLBP: 0 });

      expect(res.body.success).toBe(false);
      expect(auditSpy).not.toHaveBeenCalled();
    });
  });
});
