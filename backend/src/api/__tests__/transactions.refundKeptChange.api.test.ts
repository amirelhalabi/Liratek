/**
 * Refund kept change (owner decision 2026-10-07) — REST parity with the
 * IPC handler: POST /api/transactions/:id/refund validates `keptChange`
 * with the SAME core schema (`refundKeptChangeSchema`) and forwards it as
 * `{ usd, lbp }`; the session item route forwards the schema's flat
 * `kept_change_*` keys. Field names come from the schema (rule 24).
 *
 * Rule 17 disclosure: written AFTER the route change — NOT proven
 * failing-first (the repository guard was).
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
  getTransactionService,
  refundKeptChangeSchema,
  sessionItemRefundSchema,
} from "@liratek/core";
import transactionsRouter from "../transactions.js";
import salesRouter from "../sales.js";

function buildTransactionsApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  return app;
}

describe("refund kept change — REST forwarding", () => {
  const txnService = getTransactionService();
  const legs = [{ method: "CASH", currencyCode: "USD", amount: 20 }];

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("POST /api/transactions/:id/refund forwards keptChange as { usd, lbp }", async () => {
    const spy = jest.spyOn(txnService, "refundTransaction").mockReturnValue(801);
    const keptChange = refundKeptChangeSchema.parse({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    });
    const res = await request(buildTransactionsApp())
      .post("/api/transactions/42/refund")
      .set("x-test-role", "admin")
      .send({ refundLegs: legs, exchangeRate: 89000, keptChange });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 801 });
    expect(spy).toHaveBeenCalledWith(42, 42, {
      refundLegs: legs,
      refundUnitExtras: undefined,
      exchangeRate: 89000,
      keptChange: { usd: 0.12, lbp: 0 },
    });
  });

  it("POST /api/sales/:id/refund (POS Refund Sale) forwards keptChange as { usd, lbp }", async () => {
    const spy = jest.spyOn(txnService, "refundBySaleId").mockReturnValue(803);
    const app = express();
    app.use(express.json());
    app.use("/api/sales", salesRouter);
    const keptChange = refundKeptChangeSchema.parse({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    });
    const res = await request(app)
      .post("/api/sales/9/refund")
      .set("x-test-role", "admin")
      .send({ refundLegs: legs, exchangeRate: 89000, keptChange });
    expect(res.body).toEqual({ success: true, refundId: 803 });
    expect(spy).toHaveBeenCalledWith(9, 42, {
      refundLegs: legs,
      refundUnitExtras: undefined,
      exchangeRate: 89000,
      keptChange: { usd: 0.12, lbp: 0 },
    });
  });

  it("a negative kept amount is refused with the 200 envelope and never reaches the service", async () => {
    const spy = jest.spyOn(txnService, "refundTransaction").mockReturnValue(801);
    const res = await request(buildTransactionsApp())
      .post("/api/transactions/42/refund")
      .set("x-test-role", "admin")
      .send({ refundLegs: legs, keptChange: { kept_change_usd: -1 } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST session item refund forwards the schema's kept_change_* keys", async () => {
    const spy = jest
      .spyOn(txnService, "refundSessionBasketItem")
      .mockReturnValue({ refundTransactionId: 900 } as never);
    const body = sessionItemRefundSchema.parse({
      sessionId: 3,
      transactionId: 11,
      saleItemId: 5,
      quantity: 1,
      refundLegs: legs,
      kept_change_usd: 0.12,
    });
    const { sessionId: _sessionId, ...rest } = body;
    const res = await request(buildTransactionsApp())
      .post("/api/transactions/session-basket/3/items/refund")
      .set("x-test-role", "admin")
      .send(rest);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ kept_change_usd: 0.12, userId: 42 }),
    );
  });
});
