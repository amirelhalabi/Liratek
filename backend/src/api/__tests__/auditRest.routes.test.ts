/**
 * REST audit-wiring tests (LIRA-104, Implementer B's route slice).
 *
 * Representative sample across the different envelope shapes touched by
 * this ticket (`auditRest` calls added to backend/src/api/{modules,
 * paymentMethods, suppliers, transactions, walletExchange}.ts) — proving:
 *   (a) a successful mutation records exactly one audit entry with the
 *       IPC-mirrored action/entity_type/summary,
 *   (b) a business failure (`{ success: false }` OR a thrown error caught
 *       as a 500) records NOTHING,
 *   (c) the actor on the audit entry always comes from `req.user` (the JWT),
 *       never from the request body.
 *
 * Pattern mirrors suppliers.api.test.ts / partners.api.test.ts: the REAL
 * router with only ../../server.js (logger) and ../../middleware/auth.js
 * (header-driven `x-test-role`) faked. Core services are the REAL
 * singletons with the ONE method under test stubbed via `jest.spyOn`;
 * `getAuditService().log` is spied directly to assert on the exact audit
 * entry a route wrote, without depending on the mocked DB's `.get()`/`.all()`
 * (which always return empty — see backend/src/__mocks__/better-sqlite3.ts).
 *
 * Suppliers' createPurchase case specifically exercises the "raw entity, no
 * `success` key" envelope (SupplierService.createPurchase) to prove the
 * route's `isAuditableSuccess`-style gate (`!("success" in result &&
 * result.success === false)`) treats "not explicitly false" as success,
 * not `result.success === true`.
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
  getModuleService,
  getPaymentMethodService,
  getSupplierService,
  getTransactionService,
  getWalletExchangeService,
  getAuditService,
} from "@liratek/core";
import modulesRouter from "../modules.js";
import paymentMethodsRouter from "../paymentMethods.js";
import suppliersRouter from "../suppliers.js";
import transactionsRouter from "../transactions.js";
import walletExchangeRouter from "../walletExchange.js";

function buildApp(mount: string, router: express.Router): Express {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app;
}

describe("REST audit wiring (LIRA-104, Implementer B)", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.restoreAllMocks();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  // ── modules.ts — PATCH /:key/enabled ──────────────────────────────────────
  describe("PATCH /api/modules/:key/enabled", () => {
    const app = buildApp("/api/modules", modulesRouter);

    it("success: records exactly one audit entry, actor from JWT", async () => {
      jest
        .spyOn(getModuleService(), "setModuleEnabled")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .patch("/api/modules/loto/enabled")
        .set("x-test-role", "admin")
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "toggle",
          entity_type: "module",
          entity_id: "loto",
          // Actor MUST come from req.user (the mocked JWT), never req.body —
          // the request body has no user_id/username/role fields at all.
          user_id: 42,
          username: "tester",
          role: "admin",
        }),
      );
    });

    it("business failure: records nothing", async () => {
      jest.spyOn(getModuleService(), "setModuleEnabled").mockReturnValue({
        success: false,
        error: 'System module "pos" cannot be toggled',
      });

      const res = await request(app)
        .patch("/api/modules/pos/enabled")
        .set("x-test-role", "admin")
        .send({ enabled: false });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ── paymentMethods.ts — PUT /:id ───────────────────────────────────────────
  describe("PUT /api/payment-methods/:id", () => {
    const app = buildApp("/api/payment-methods", paymentMethodsRouter);

    it("success: records exactly one audit entry, actor from JWT", async () => {
      jest.spyOn(getPaymentMethodService(), "update").mockReturnValue({
        success: true,
        id: 7,
      } as any);

      const res = await request(app)
        .put("/api/payment-methods/7")
        .set("x-test-role", "admin")
        .send({ label: "New Label" });

      expect(res.status).toBe(200);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "update",
          entity_type: "payment_method",
          entity_id: "7",
          user_id: 42,
          username: "tester",
          role: "admin",
        }),
      );
    });

    it("business failure: records nothing", async () => {
      jest.spyOn(getPaymentMethodService(), "update").mockReturnValue({
        success: false,
        error: "Payment method not found",
      });

      const res = await request(app)
        .put("/api/payment-methods/999")
        .set("x-test-role", "admin")
        .send({ label: "New Label" });

      expect(res.status).toBe(400);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ── suppliers.ts — POST /:id/purchases (raw-entity envelope) ──────────────
  describe("POST /api/suppliers/:id/purchases", () => {
    const app = buildApp("/api/suppliers", suppliersRouter);

    it("success (raw entity, no `success` key): records exactly one audit entry", async () => {
      jest.spyOn(getSupplierService(), "createPurchase").mockReturnValue({
        id: 55,
        supplier_id: 1,
        total_usd: 100,
        created_by: 42,
      } as any);

      const res = await request(app)
        .post("/api/suppliers/1/purchases")
        .set("x-test-role", "admin")
        .send({ total_usd: 100, total_lbp: 0 });

      expect(res.status).toBe(200);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "create",
          entity_type: "supplier_purchase",
          user_id: 42,
          username: "tester",
          role: "admin",
        }),
      );
    });

    it("business failure (`{ success: false }` return, no throw): records nothing", async () => {
      jest.spyOn(getSupplierService(), "createPurchase").mockReturnValue({
        success: false,
        error: "Amount must be greater than 0",
      });

      const res = await request(app)
        .post("/api/suppliers/1/purchases")
        .set("x-test-role", "admin")
        .send({ total_usd: 0, total_lbp: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ── transactions.ts — POST /:id/void ───────────────────────────────────────
  describe("POST /api/transactions/:id/void", () => {
    const app = buildApp("/api/transactions", transactionsRouter);

    it("success: records exactly one audit entry, actor from JWT", async () => {
      jest
        .spyOn(getTransactionService(), "voidTransaction")
        .mockReturnValue(999);

      const res = await request(app)
        .post("/api/transactions/123/void")
        .set("x-test-role", "admin")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "void",
          entity_type: "transaction",
          entity_id: "123",
          user_id: 42,
          username: "tester",
          role: "admin",
        }),
      );
    });

    it("business failure (voidTransaction throws, caught as 500): records nothing", async () => {
      jest
        .spyOn(getTransactionService(), "voidTransaction")
        .mockImplementation(() => {
          throw new Error("Transaction already voided");
        });

      const res = await request(app)
        .post("/api/transactions/123/void")
        .set("x-test-role", "admin")
        .send({});

      expect(res.status).toBe(500);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ── walletExchange.ts — POST / ─────────────────────────────────────────────
  describe("POST /api/wallet-exchange", () => {
    const app = buildApp("/api/wallet-exchange", walletExchangeRouter);
    const validBody = {
      drawerName: "OMT_App",
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 10,
      rate: 90000,
    };

    it("success: records exactly one audit entry, actor from JWT", async () => {
      jest.spyOn(getWalletExchangeService(), "exchange").mockReturnValue({
        success: true,
        amountOut: 900000,
      } as any);

      const res = await request(app)
        .post("/api/wallet-exchange")
        .set("x-test-role", "staff")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "create",
          entity_type: "wallet_exchange",
          user_id: 42,
          username: "tester",
          role: "staff",
        }),
      );
    });

    it("business failure: records nothing", async () => {
      jest.spyOn(getWalletExchangeService(), "exchange").mockReturnValue({
        success: false,
        error: "Insufficient balance",
      } as any);

      const res = await request(app)
        .post("/api/wallet-exchange")
        .set("x-test-role", "staff")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
