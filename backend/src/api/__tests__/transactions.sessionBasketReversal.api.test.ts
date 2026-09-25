/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C): two brand new
 * REST routes, `POST /api/transactions/session-basket/:sessionId/void` and
 * `POST /api/transactions/session-basket/:sessionId/refund`, replacing the
 * "Basket item — see admin to reverse" dead end. Both fail-to-exist against
 * pre-fix code, so this whole file is a rule-17 failing-first proof by
 * construction.
 *
 * Harness copied from `auditRoleGate.api.test.ts` / `transactionsRecent.api
 * .test.ts`: hits the REAL router (`../transactions.js`) through a minimal
 * Express app, faking only `../../server.js` (logger), `../../middleware/
 * audit.js` (`auditRest`) and `../../middleware/auth.js` (an
 * `x-test-role` stand-in for `authenticateJWT`/`requireRole`).
 * `TransactionService` is the REAL singleton with its methods stubbed via
 * `jest.spyOn`, so this proves the route wires the exact role/envelope
 * contract without a real DB round trip.
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
import { getTransactionService } from "@liratek/core";
import transactionsRouter from "../transactions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  return app;
}

describe("LIRA-201c: POST /api/transactions/session-basket/:sessionId/void|refund", () => {
  let app: Express;
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("admin — accepted, envelope matches IPC", () => {
    it("void: 200, calls voidSessionBasket(sessionId, userId from JWT), IPC-identical envelope", async () => {
      const voidSpy = jest
        .spyOn(txnService, "voidSessionBasket")
        .mockReturnValue({
          sessionId: 7,
          itemCount: 2,
          reversedTransactionIds: [10, 11],
          reversalIds: [20, 21],
        });

      const res = await request(app)
        .post("/api/transactions/session-basket/7/void")
        .set("x-test-role", "admin")
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        sessionId: 7,
        itemCount: 2,
        reversedTransactionIds: [10, 11],
        reversalIds: [20, 21],
      });
      // userId is derived from the JWT (req.user.userId), never trusted from
      // the client — rule 19c.
      expect(voidSpy).toHaveBeenCalledWith(7, 42);
    });

    it("refund: 200, calls refundSessionBasket(sessionId, userId from JWT)", async () => {
      const refundSpy = jest
        .spyOn(txnService, "refundSessionBasket")
        .mockReturnValue({
          sessionId: 8,
          itemCount: 1,
          reversedTransactionIds: [30],
          reversalIds: [31],
        });

      const res = await request(app)
        .post("/api/transactions/session-basket/8/refund")
        .set("x-test-role", "admin")
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        sessionId: 8,
        itemCount: 1,
        reversedTransactionIds: [30],
        reversalIds: [31],
      });
      expect(refundSpy).toHaveBeenCalledWith(8, 42);
    });

    it("void: an invalid (non-numeric) sessionId is rejected with 400 before the service is called", async () => {
      const voidSpy = jest.spyOn(txnService, "voidSessionBasket");

      const res = await request(app)
        .post("/api/transactions/session-basket/not-a-number/void")
        .set("x-test-role", "admin")
        .send();

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(voidSpy).not.toHaveBeenCalled();
    });

    it("void: a thrown business-rule error (e.g. already-reimbursed prize) is surfaced as { success: false }", async () => {
      jest.spyOn(txnService, "voidSessionBasket").mockImplementation(() => {
        throw new Error(
          "This prize was already settled with Loto on 2026-09-20. Fix it from the Loto page.",
        );
      });

      const res = await request(app)
        .post("/api/transactions/session-basket/7/void")
        .set("x-test-role", "admin")
        .send();

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("already settled with Loto");
    });
  });

  describe("staff — refused (mirrors /:id/void, /:id/refund, and /checkout-group/:groupId/void, all admin-only)", () => {
    it("void: staff gets 403, voidSessionBasket never called", async () => {
      const voidSpy = jest.spyOn(txnService, "voidSessionBasket");

      const res = await request(app)
        .post("/api/transactions/session-basket/7/void")
        .set("x-test-role", "staff")
        .send();

      expect(res.status).toBe(403);
      expect(voidSpy).not.toHaveBeenCalled();
    });

    it("refund: staff gets 403, refundSessionBasket never called", async () => {
      const refundSpy = jest.spyOn(txnService, "refundSessionBasket");

      const res = await request(app)
        .post("/api/transactions/session-basket/7/refund")
        .set("x-test-role", "staff")
        .send();

      expect(res.status).toBe(403);
      expect(refundSpy).not.toHaveBeenCalled();
    });
  });

  describe("unauthenticated — 401, service never reached", () => {
    it("void: no token gets 401", async () => {
      const voidSpy = jest.spyOn(txnService, "voidSessionBasket");

      const res = await request(app)
        .post("/api/transactions/session-basket/7/void")
        .send();

      expect(res.status).toBe(401);
      expect(voidSpy).not.toHaveBeenCalled();
    });
  });
});
