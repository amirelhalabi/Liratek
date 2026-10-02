/**
 * GET /api/transactions/:id/customer-legs REST route — rule 19 fix.
 *
 * THE BUG THIS FILE GUARDS: `serviceReceipt.ts`'s
 * `buildServiceReceiptTextByTransaction` (the Transactions page's reprint
 * button, and every module History modal's Print button) called
 * `window.api.transactions.getCustomerLegs(id)` directly — desktop-only,
 * with no REST twin. In a browser `window.api` is `undefined`, so the
 * reprint button silently couldn't work on web. This route is the REST
 * mirror of IPC `transactions:get-customer-legs`
 * (`TransactionService.getCustomerFacingLegs`), feeding the dual-mode
 * adapter's new `getCustomerFacingLegs` (`frontend/src/api/backendApi.ts`).
 *
 * Pattern mirrors `transactionsRecent.api.test.ts`: the REAL router
 * (../transactions.js) with only ../../middleware/auth.js faked
 * (header-driven `x-test-role`); `TransactionService` is the REAL singleton
 * with `getCustomerFacingLegs` stubbed via `jest.spyOn` so this needs no
 * real DB.
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
import { getTransactionService } from "@liratek/core";
import transactionsRouter from "../transactions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  return app;
}

describe("GET /api/transactions/:id/customer-legs — rule 19 web-reprint fix", () => {
  let app: Express;
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("returns the customer-facing legs array under `legs`, mirroring the IPC shape", async () => {
    const legs = [
      { method: "CASH", currency_code: "USD", amount: 102, direction: "IN" },
    ];
    const spy = jest
      .spyOn(txnService, "getCustomerFacingLegs")
      .mockReturnValue(legs);

    const res = await request(app)
      .get("/api/transactions/501/customer-legs")
      .set("x-test-role", "cashier");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, legs });
    expect(spy).toHaveBeenCalledWith(501);
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/transactions/501/customer-legs");
    expect(res.status).toBe(401);
  });

  it("answers the IPC-identical envelope (success:false, HTTP 200) when the service throws", async () => {
    jest.spyOn(txnService, "getCustomerFacingLegs").mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await request(app)
      .get("/api/transactions/501/customer-legs")
      .set("x-test-role", "cashier");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
