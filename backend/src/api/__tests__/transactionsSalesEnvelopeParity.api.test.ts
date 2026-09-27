/**
 * Rule 19c sweep (follow-up to F13 on `/api/transactions/:id/refund`'s
 * exchangeRate block) — every WRITE route's failure path on
 * `backend/src/api/transactions.ts` and `backend/src/api/sales.ts` must
 * answer HTTP 200 with `{ success: false, error }`, never a 4xx/5xx, so the
 * frontend adapter can branch on `result.success` alone (never the status
 * code). Each case here pins a route that still answered a real status
 * before this fix — a genuine rule-17 failing-first proof: every assertion
 * below was seen RED against the pre-fix code (400/500) before the routes
 * were changed to always `res.json(...)`.
 *
 * Harness copied from `refundExchangeRate.api.test.ts` /
 * `transactions.sessionBasketReversal.api.test.ts` (rule 14): real routers,
 * real service singletons, spied methods, no DB.
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
import {
  getSalesService,
  getTransactionService,
} from "@liratek/core";
import salesRouter from "../sales.js";
import transactionsRouter from "../transactions.js";

function buildSalesApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

function buildTransactionsApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  return app;
}

describe("Rule 19c envelope-parity sweep", () => {
  const txnService = getTransactionService();
  const salesService = getSalesService();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /api/transactions/:id/void", () => {
    it("a thrown business-rule error is HTTP 200 { success: false }, not 500", async () => {
      jest.spyOn(txnService, "voidTransaction").mockImplementation(() => {
        throw new Error("Cannot void a member of a split checkout group.");
      });
      const app = buildTransactionsApp();

      const res = await request(app)
        .post("/api/transactions/7/void")
        .set("x-test-role", "admin")
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("split checkout group");
    });
  });

  describe("POST /api/transactions/:id/refund", () => {
    it("an invalid refundLegs (empty array) is HTTP 200 { success: false }, not 400", async () => {
      const refundSpy = jest.spyOn(txnService, "refundTransaction");
      const app = buildTransactionsApp();

      const res = await request(app)
        .post("/api/transactions/7/refund")
        .set("x-test-role", "admin")
        .send({ refundLegs: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it("an invalid refundUnitExtras (empty array) is HTTP 200 { success: false }, not 400", async () => {
      const refundSpy = jest.spyOn(txnService, "refundTransaction");
      const app = buildTransactionsApp();

      const res = await request(app)
        .post("/api/transactions/7/refund")
        .set("x-test-role", "admin")
        .send({ refundUnitExtras: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it("a thrown business-rule error is HTTP 200 { success: false }, not 500", async () => {
      jest.spyOn(txnService, "refundTransaction").mockImplementation(() => {
        throw new Error("This transaction was already refunded.");
      });
      const app = buildTransactionsApp();

      const res = await request(app)
        .post("/api/transactions/7/refund")
        .set("x-test-role", "admin")
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("already refunded");
    });
  });

  describe("POST /api/transactions/checkout-group/:groupId/void", () => {
    it("a thrown business-rule error is HTTP 200 { success: false }, not 500", async () => {
      jest.spyOn(txnService, "voidCheckoutGroup").mockImplementation(() => {
        throw new Error("Checkout group already fully voided.");
      });
      const app = buildTransactionsApp();

      const res = await request(app)
        .post(
          "/api/transactions/checkout-group/3fa85f64-5717-4562-b3fc-2c963f66afa6/void",
        )
        .set("x-test-role", "admin")
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("already fully voided");
    });
  });

  describe("POST /api/sales/process", () => {
    it("a business-rule failure (e.g. out of stock) from the service is HTTP 200 { success: false }, not 400", async () => {
      jest.spyOn(salesService, "processSale").mockReturnValue({
        success: false,
        error: "Not enough stock for SKU-123",
      } as ReturnType<typeof salesService.processSale>);
      const app = buildSalesApp();

      const res = await request(app)
        .post("/api/sales/process")
        .set("x-test-role", "admin")
        .send({
          client_id: null,
          items: [{ product_id: 1, quantity: 1, price: 10 }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 10,
          payment_lbp: 0,
          exchange_rate: 89000,
          status: "completed",
        });

      // Rule 19c: this route used to answer
      // `res.status(result.success ? 200 : 400).json(result)` — a genuine
      // dual-transport bug (POS/index.tsx's handleCompleteSale reads
      // `result.error` on the resolved envelope; a thrown ApiError from a
      // non-2xx status bypassed that branch entirely and surfaced only a
      // generic "unexpected error" toast on web).
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "Not enough stock for SKU-123",
      });
    });

    it("a successful sale still returns 200 (unchanged)", async () => {
      jest.spyOn(salesService, "processSale").mockReturnValue({
        success: true,
        id: 55,
      } as ReturnType<typeof salesService.processSale>);
      const app = buildSalesApp();

      const res = await request(app)
        .post("/api/sales/process")
        .set("x-test-role", "admin")
        .send({
          client_id: null,
          items: [{ product_id: 1, quantity: 1, price: 10 }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 10,
          payment_lbp: 0,
          exchange_rate: 89000,
          status: "completed",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 55 });
    });
  });
});
