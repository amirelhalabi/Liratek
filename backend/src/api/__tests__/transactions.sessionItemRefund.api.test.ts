/**
 * LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — two brand new REST
 * routes, `POST /api/transactions/session-basket/:sessionId/items/refund`
 * and `GET /api/transactions/session-basket/:sessionId/items/refund-preview`,
 * the item-level sibling of `POST .../session-basket/:sessionId/refund`
 * (LIRA-201c). Both routes 404 against pre-change code (neither path is
 * registered on the router), so this whole file is a rule-17 failing-first
 * proof by construction.
 *
 * Harness copied from `transactions.sessionBasketReversal.api.test.ts`: hits
 * the REAL router (`../transactions.js`) through a minimal Express app,
 * faking only `../../server.js` (logger), `../../middleware/audit.js`
 * (`auditRest`) and `../../middleware/auth.js` (an `x-test-role` stand-in
 * for `authenticateJWT`/`requireRole`). `TransactionService` is the REAL
 * singleton with its methods stubbed via `jest.spyOn`, so this proves the
 * routes wire the exact role/payload/envelope contract without a real DB
 * round trip. Every failure path (validation AND business-rule) asserts
 * HTTP 200 (rule 19c — IPC-identical envelope, never a 4xx/5xx status for a
 * business-rule refusal); this deliberately does NOT copy the older
 * `/session-basket/:sessionId/void|refund` routes' 400-on-bad-sessionId
 * convention.
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

describe("LIRA-232 phase 2: POST .../session-basket/:sessionId/items/refund, GET .../items/refund-preview", () => {
  let app: Express;
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("admin — accepted, envelope matches IPC", () => {
    it("POST items/refund: 200, calls refundSessionBasketItem with userId from JWT (never the body)", async () => {
      const refundSpy = jest
        .spyOn(txnService, "refundSessionBasketItem")
        .mockReturnValue({
          refundTransactionId: 99,
          sessionId: 7,
          memberTransactionId: 42,
          itemAmountUsd: 1500,
          itemAmountLbp: 0,
          accountReductionUsd: 1500,
          accountReductionLbp: 0,
          remainderUsd: 0,
          remainderLbp: 0,
          legs: [],
        });

      const res = await request(app)
        .post("/api/transactions/session-basket/7/items/refund")
        .set("x-test-role", "admin")
        .send({ transactionId: 42, saleItemId: 5, quantity: 1, userId: 999 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmountUsd: 1500,
        itemAmountLbp: 0,
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderUsd: 0,
        remainderLbp: 0,
        legs: [],
      });
      // userId is derived from the JWT (req.user.userId = 42), never trusted
      // from the client body (which sent 999) — rule 19c.
      expect(refundSpy).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 42,
        saleItemId: 5,
        quantity: 1,
        refundLegs: undefined,
        unitExtras: undefined,
        clientDay: undefined,
        userId: 42,
      });
    });

    it("POST items/refund: forwards an operator-chosen refundLegs override", async () => {
      const refundSpy = jest
        .spyOn(txnService, "refundSessionBasketItem")
        .mockReturnValue({
          refundTransactionId: 100,
          sessionId: 7,
          memberTransactionId: 42,
          itemAmountUsd: 15,
          itemAmountLbp: 0,
          accountReductionUsd: 0,
          accountReductionLbp: 0,
          remainderUsd: 15,
          remainderLbp: 0,
          legs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
        });

      const res = await request(app)
        .post("/api/transactions/session-basket/7/items/refund")
        .set("x-test-role", "admin")
        .send({
          transactionId: 42,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
        });

      expect(res.status).toBe(200);
      expect(refundSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
        }),
      );
    });

    it("POST items/refund: a malformed body (missing transactionId) is rejected with HTTP 200 { success: false } BEFORE the service is called", async () => {
      const refundSpy = jest.spyOn(txnService, "refundSessionBasketItem");

      const res = await request(app)
        .post("/api/transactions/session-basket/7/items/refund")
        .set("x-test-role", "admin")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it("POST items/refund: an invalid (non-numeric) sessionId is rejected with HTTP 200 { success: false } (rule 19c)", async () => {
      const refundSpy = jest.spyOn(txnService, "refundSessionBasketItem");

      const res = await request(app)
        .post("/api/transactions/session-basket/not-a-number/items/refund")
        .set("x-test-role", "admin")
        .send({ transactionId: 42 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it("POST items/refund: a thrown business-rule error (e.g. already whole-reversed basket) is surfaced as { success: false }, HTTP 200", async () => {
      jest
        .spyOn(txnService, "refundSessionBasketItem")
        .mockImplementation(() => {
          throw new Error("This basket was already whole-reversed.");
        });

      const res = await request(app)
        .post("/api/transactions/session-basket/7/items/refund")
        .set("x-test-role", "admin")
        .send({ transactionId: 42 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "This basket was already whole-reversed.",
      });
    });

    it("GET items/refund-preview: 200, forwards query params coerced to numbers", async () => {
      const previewSpy = jest
        .spyOn(txnService, "getSessionItemRefundPreview")
        .mockReturnValue({
          success: true,
          itemAmountUsd: 1500,
          itemAmountLbp: 0,
          accountReductionUsd: 1500,
          accountReductionLbp: 0,
          remainderUsd: 0,
          remainderLbp: 0,
          defaultLegs: [],
        });

      const res = await request(app)
        .get("/api/transactions/session-basket/7/items/refund-preview")
        .query({ transactionId: "42", saleItemId: "5", quantity: "1" })
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        itemAmountUsd: 1500,
        itemAmountLbp: 0,
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderUsd: 0,
        remainderLbp: 0,
        defaultLegs: [],
      });
      expect(previewSpy).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 42,
        saleItemId: 5,
        quantity: 1,
      });
    });

    it("GET items/refund-preview: a malformed query (missing transactionId) is rejected with HTTP 200 { success: false }", async () => {
      const previewSpy = jest.spyOn(txnService, "getSessionItemRefundPreview");

      const res = await request(app)
        .get("/api/transactions/session-basket/7/items/refund-preview")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(previewSpy).not.toHaveBeenCalled();
    });
  });

  describe("staff — refused, service never called", () => {
    it("POST items/refund: staff gets 403", async () => {
      const refundSpy = jest.spyOn(txnService, "refundSessionBasketItem");

      const res = await request(app)
        .post("/api/transactions/session-basket/7/items/refund")
        .set("x-test-role", "staff")
        .send({ transactionId: 42 });

      expect(res.status).toBe(403);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it("GET items/refund-preview: staff gets 403", async () => {
      const previewSpy = jest.spyOn(txnService, "getSessionItemRefundPreview");

      const res = await request(app)
        .get("/api/transactions/session-basket/7/items/refund-preview")
        .query({ transactionId: "42" })
        .set("x-test-role", "staff");

      expect(res.status).toBe(403);
      expect(previewSpy).not.toHaveBeenCalled();
    });
  });

  describe("unauthenticated — 401, service never reached", () => {
    it("POST items/refund: no token gets 401", async () => {
      const refundSpy = jest.spyOn(txnService, "refundSessionBasketItem");

      const res = await request(app)
        .post("/api/transactions/session-basket/7/items/refund")
        .send({ transactionId: 42 });

      expect(res.status).toBe(401);
      expect(refundSpy).not.toHaveBeenCalled();
    });
  });
});
