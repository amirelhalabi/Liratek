/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — REST parity: `exchangeRate`
 * is forwarded to the SAME core service the Electron IPC handlers use, on
 * every refund route it was added to:
 *   - POST /api/sales/:id/refund            → TransactionService.refundBySaleId
 *   - POST /api/sales/:id/refund-item       → SalesService.refundSaleItem
 *   - POST /api/transactions/:id/refund     → TransactionService.refundTransaction
 *   - GET  /api/transactions/:id/refund-booked-rate → TransactionService.getRefundBookedRate
 *   - POST /api/transactions/session-basket/:sessionId/items/refund →
 *     TransactionService.refundSessionBasketItem
 *
 * Harness copied from `salesRefundOverride.api.test.ts` /
 * `transactions.sessionItemRefund.api.test.ts` (rule 14 — the established
 * "real router, real service singleton, spied methods, no DB" pattern):
 * hits the REAL routers through a minimal Express app, faking only the
 * logger, `auditRest`, and auth middleware. Every case here is a genuine
 * rule-17 failing-first proof: before this ticket, `exchangeRate` was not a
 * field either route's schema accepted, so a body/query carrying it was
 * silently STRIPPED before reaching the service (Zod strips unknown keys —
 * CLAUDE.md rule 23) — the assertion `toHaveBeenCalledWith(..., {
 * exchangeRate: 89000, ... })` would have failed with `exchangeRate:
 * undefined` on the pre-fix schema.
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
import { getSalesService, getTransactionService } from "@liratek/core";
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

describe("LIRA-236: exchangeRate REST forwarding", () => {
  const salesService = getSalesService();
  const txnService = getTransactionService();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("POST /api/sales/:id/refund forwards exchangeRate to TransactionService.refundBySaleId", async () => {
    const app = buildSalesApp();
    const refundSpy = jest
      .spyOn(txnService, "refundBySaleId")
      .mockReturnValue(501);

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send({
        refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
        exchangeRate: 89000,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 501 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
      refundUnitExtras: undefined,
      exchangeRate: 89000,
    });
  });

  it("POST /api/sales/:id/refund-item forwards exchangeRate to SalesService.refundSaleItem", async () => {
    const app = buildSalesApp();
    const refundSpy = jest
      .spyOn(salesService, "refundSaleItem")
      .mockReturnValue({ success: true, refundId: 601 });

    const res = await request(app)
      .post("/api/sales/7/refund-item")
      .set("x-test-role", "admin")
      .send({ saleItemId: 3, refundQuantity: 1, exchangeRate: 89000 });

    expect(res.status).toBe(200);
    expect(refundSpy).toHaveBeenCalledWith({
      saleId: 7,
      saleItemId: 3,
      refundQuantity: 1,
      refundLegs: undefined,
      unitExtras: undefined,
      exchangeRate: 89000,
      userId: 42,
    });
  });

  it("POST /api/sales/:id/refund with no exchangeRate keeps working exactly as before (backward compatible)", async () => {
    const app = buildSalesApp();
    const refundSpy = jest
      .spyOn(txnService, "refundBySaleId")
      .mockReturnValue(502);

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send();

    expect(res.status).toBe(200);
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: undefined,
      refundUnitExtras: undefined,
      exchangeRate: undefined,
    });
  });

  it("POST /api/transactions/:id/refund forwards exchangeRate to TransactionService.refundTransaction", async () => {
    const app = buildTransactionsApp();
    const refundSpy = jest
      .spyOn(txnService, "refundTransaction")
      .mockReturnValue(701);

    const res = await request(app)
      .post("/api/transactions/7/refund")
      .set("x-test-role", "admin")
      .send({
        refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
        exchangeRate: 89000,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 701 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
      refundUnitExtras: undefined,
      exchangeRate: 89000,
    });
  });

  it("POST /api/transactions/:id/refund rejects a garbage exchangeRate (invalid, negative) with the schema's own error, as HTTP 200 (rule 19c — F13, round-3 review)", async () => {
    const app = buildTransactionsApp();
    const refundSpy = jest.spyOn(txnService, "refundTransaction");

    const res = await request(app)
      .post("/api/transactions/7/refund")
      .set("x-test-role", "admin")
      .send({ exchangeRate: -5 });

    // Rule 19c: envelope parity means every failure — including a bad
    // exchangeRate — is HTTP 200 with { success: false, error }, so the
    // adapter can branch on `success` alone instead of the status code.
    // Pre-fix, this route's exchangeRate block was the one place on this
    // ticket that still 400'd (copy-pasted from the pre-existing
    // refundLegs/refundUnitExtras blocks above it).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("POST /api/transactions/:id/refund treats a null exchangeRate as absent, not a validation error (F13, round-3 review)", async () => {
    const app = buildTransactionsApp();
    const refundSpy = jest
      .spyOn(txnService, "refundTransaction")
      .mockReturnValue(703);

    const res = await request(app)
      .post("/api/transactions/7/refund")
      .set("x-test-role", "admin")
      .send({ exchangeRate: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 703 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: undefined,
      refundUnitExtras: undefined,
      exchangeRate: undefined,
    });
  });

  it("POST /api/sales/:id/refund treats a null exchangeRate as absent, not a validation error (F13, round-3 review)", async () => {
    const app = buildSalesApp();
    const refundSpy = jest
      .spyOn(txnService, "refundBySaleId")
      .mockReturnValue(503);

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send({ exchangeRate: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 503 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: undefined,
      refundUnitExtras: undefined,
      exchangeRate: undefined,
    });
  });

  it("POST /api/sales/:id/refund-item treats a null exchangeRate as absent, not a validation error (F13, round-3 review)", async () => {
    const app = buildSalesApp();
    const refundSpy = jest.spyOn(salesService, "refundSaleItem").mockReturnValue({
      success: true,
    } as ReturnType<typeof salesService.refundSaleItem>);

    const res = await request(app)
      .post("/api/sales/7/refund-item")
      .set("x-test-role", "admin")
      .send({ saleItemId: 3, refundQuantity: 1, exchangeRate: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(refundSpy).toHaveBeenCalledWith({
      saleId: 7,
      saleItemId: 3,
      refundQuantity: 1,
      refundLegs: undefined,
      unitExtras: undefined,
      exchangeRate: undefined,
      userId: 42,
    });
  });

  it("GET /api/transactions/:id/refund-booked-rate forwards to TransactionService.getRefundBookedRate", async () => {
    const app = buildTransactionsApp();
    jest.spyOn(txnService, "getRefundBookedRate").mockReturnValue({
      success: true,
      bookedRate: 90000,
      bookedRateSource: "sale",
    });

    const res = await request(app)
      .get("/api/transactions/7/refund-booked-rate")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      bookedRate: 90000,
      bookedRateSource: "sale",
    });
  });

  it("POST /api/transactions/session-basket/:sessionId/items/refund forwards exchangeRate to TransactionService.refundSessionBasketItem", async () => {
    const app = buildTransactionsApp();
    const refundSpy = jest
      .spyOn(txnService, "refundSessionBasketItem")
      .mockReturnValue({
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmountUsd: 50,
        itemAmountLbp: 0,
        accountReductionUsd: 0,
        accountReductionLbp: 4450000,
        remainderUsd: 0,
        remainderLbp: 0,
        legs: [],
      });

    const res = await request(app)
      .post("/api/transactions/session-basket/7/items/refund")
      .set("x-test-role", "admin")
      .send({ transactionId: 42, exchangeRate: 89000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(refundSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 7, transactionId: 42, exchangeRate: 89000, userId: 42 }),
    );
  });

  it("GET .../items/refund-preview forwards exchangeRate to TransactionService.getSessionItemRefundPreview", async () => {
    const app = buildTransactionsApp();
    const previewSpy = jest
      .spyOn(txnService, "getSessionItemRefundPreview")
      .mockReturnValue({
        success: true,
        itemAmountUsd: 50,
        itemAmountLbp: 0,
        accountReductionUsd: 0,
        accountReductionLbp: 4450000,
        remainderUsd: 0,
        remainderLbp: 0,
        defaultLegs: [],
        bookedRate: 89000,
        bookedRateSource: "fallback",
      });

    const res = await request(app)
      .get("/api/transactions/session-basket/7/items/refund-preview")
      .query({ transactionId: 42, exchangeRate: 89000 })
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.bookedRate).toBe(89000);
    expect(previewSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 7, transactionId: 42, exchangeRate: 89000 }),
    );
  });
});
