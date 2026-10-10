/**
 * Suppliers REST route tests (CQ-9 — web/REST parity + role alignment).
 *
 * These hit the REAL router (../suppliers.js) — real Zod schemas via
 * validateRequest, real route-param → body wiring — through a minimal
 * Express app. Only two things are faked:
 *   - ../../server.js (just a `logger`; the real file would boot dotenv +
 *     the HTTP listener + a real DB connection)
 *   - ../../middleware/auth.js (a header-driven `x-test-role` stand-in for
 *     authenticateJWT/requireRole, so tests can pick a role without a real
 *     JWT/session/DB round trip)
 *
 * The SupplierService/FinancialService singletons are the REAL classes
 * (backed by jest.setup.ts's mock DB) with their public methods stubbed via
 * `jest.spyOn` — this proves the route wires body/params/user into the
 * exact core service call the IPC handler makes, without needing to fight
 * @liratek/core module-mock hoisting for suppliers.ts's module-load-time
 * `const supplierService = getSupplierService()` capture.
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
  getSupplierService,
  getFinancialService,
  type SupplierCreatePayload,
} from "@liratek/core";
import suppliersRouter from "../suppliers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/suppliers", suppliersRouter);
  return app;
}

describe("Suppliers REST routes", () => {
  let app: Express;
  const supplierService = getSupplierService();
  const financialService = getFinancialService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  // ── GET /unsettled ─────────────────────────────────────────────────────
  describe("GET /api/suppliers/unsettled", () => {
    it("400s when provider is missing (any authenticated role)", async () => {
      const res = await request(app)
        .get("/api/suppliers/unsettled")
        .set("x-test-role", "staff");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("happy path: staff (no admin requirement) hits FinancialService.getUnsettledByProvider", async () => {
      const spy = jest
        .spyOn(financialService, "getUnsettledByProvider")
        .mockReturnValue([{ id: 1 } as any]);

      const res = await request(app)
        .get("/api/suppliers/unsettled?provider=OMT")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, transactions: [{ id: 1 }] });
      expect(spy).toHaveBeenCalledWith("OMT");
    });
  });

  // ── GET /all-transactions ──────────────────────────────────────────────
  describe("GET /api/suppliers/all-transactions", () => {
    it("happy path: hits FinancialService.getAllByProvider with parsed limit", async () => {
      const spy = jest
        .spyOn(financialService, "getAllByProvider")
        .mockReturnValue([{ id: 7 } as any]);

      const res = await request(app)
        .get("/api/suppliers/all-transactions?provider=WHISH&limit=10")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, transactions: [{ id: 7 }] });
      expect(spy).toHaveBeenCalledWith("WHISH", 10);
    });
  });

  // ── GET /unsettled-summary ──────────────────────────────────────────────
  it("GET /api/suppliers/unsettled-summary happy path", async () => {
    jest
      .spyOn(financialService, "getUnsettledSummary")
      .mockReturnValue([{ provider: "OMT" } as any]);

    const res = await request(app)
      .get("/api/suppliers/unsettled-summary")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      summary: [{ provider: "OMT" }],
    });
  });

  // ── GET /product-balances ──────────────────────────────────────────────
  it("GET /api/suppliers/product-balances happy path", async () => {
    jest
      .spyOn(supplierService, "getProductSupplierBalances")
      .mockReturnValue([{ supplier_id: 1, total_usd: 5, total_lbp: 0 }]);

    const res = await request(app)
      .get("/api/suppliers/product-balances")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.balances).toEqual([
      { supplier_id: 1, total_usd: 5, total_lbp: 0 },
    ]);
  });

  // ── GET /:id/product-items ──────────────────────────────────────────────
  it("GET /api/suppliers/:id/product-items happy path", async () => {
    const spy = jest
      .spyOn(supplierService, "getProductItems")
      .mockReturnValue([{ name: "Widget" } as any]);

    const res = await request(app)
      .get("/api/suppliers/3/product-items")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ name: "Widget" }]);
    expect(spy).toHaveBeenCalledWith(3);
  });

  // ── GET /:id/purchases ──────────────────────────────────────────────────
  it("GET /api/suppliers/:id/purchases happy path", async () => {
    const spy = jest
      .spyOn(supplierService, "getSupplierPurchases")
      .mockReturnValue([{ id: 9 } as any]);

    const res = await request(app)
      .get("/api/suppliers/3/purchases")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.purchases).toEqual([{ id: 9 }]);
    expect(spy).toHaveBeenCalledWith(3);
  });

  // ── POST /:id/ledger (validation retrofit) ──────────────────────────────
  describe("POST /api/suppliers/:id/ledger", () => {
    it("rejects staff (admin-only, mirrors suppliers:add-ledger-entry)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/ledger")
        .set("x-test-role", "staff")
        .send({ entry_type: "TOP_UP", amount_usd: 10, amount_lbp: 0 });

      expect(res.status).toBe(403);
    });

    it("rejects an invalid entry_type (core supplierLedgerEntrySchema) — rule 19c: 200 + string error", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/ledger")
        .set("x-test-role", "admin")
        .send({ entry_type: "NOT_A_TYPE", amount_usd: 10, amount_lbp: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path: supplier_id comes from the URL, created_by from the JWT", async () => {
      const spy = jest
        .spyOn(supplierService, "addLedgerEntry")
        .mockReturnValue({ success: true, id: 5 });

      const res = await request(app)
        .post("/api/suppliers/1/ledger")
        .set("x-test-role", "admin")
        .send({ entry_type: "TOP_UP", amount_usd: 10, amount_lbp: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 5 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          supplier_id: 1,
          entry_type: "TOP_UP",
          amount_usd: 10,
          amount_lbp: 0,
          created_by: 42,
        }),
      );
    });
  });

  // ── POST /:id/settle ─────────────────────────────────────────────────────
  describe("POST /api/suppliers/:id/settle", () => {
    const validSettleBody = {
      financial_service_ids: [1, 2],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 5,
      commission_lbp: 0,
      drawer_name: "General",
    };

    it("rejects staff (admin-only, mirrors suppliers:settle-transactions)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/settle")
        .set("x-test-role", "staff")
        .send(validSettleBody);

      expect(res.status).toBe(403);
    });

    it("rejects when financial_service_ids is empty (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/settle")
        .set("x-test-role", "admin")
        .send({ ...validSettleBody, financial_service_ids: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path hits SupplierService.settleTransactions with supplier_id from the URL", async () => {
      const spy = jest
        .spyOn(supplierService, "settleTransactions")
        .mockReturnValue({ success: true, id: 11 });

      const res = await request(app)
        .post("/api/suppliers/7/settle")
        .set("x-test-role", "admin")
        .send(validSettleBody);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 11 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 7, created_by: 42 }),
      );
    });
  });

  // ── POST /:id/cashflow ───────────────────────────────────────────────────
  describe("POST /api/suppliers/:id/cashflow", () => {
    const validCashflowBody = {
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
    };

    it("rejects staff (admin-only, mirrors suppliers:record-cashflow)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/cashflow")
        .set("x-test-role", "staff")
        .send(validCashflowBody);

      expect(res.status).toBe(403);
    });

    it("rejects an invalid direction (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/cashflow")
        .set("x-test-role", "admin")
        .send({ ...validCashflowBody, direction: "SIDEWAYS" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path hits SupplierService.recordSupplierCashflow", async () => {
      const spy = jest
        .spyOn(supplierService, "recordSupplierCashflow")
        .mockReturnValue({ success: true, id: 3 });

      const res = await request(app)
        .post("/api/suppliers/4/cashflow")
        .set("x-test-role", "admin")
        .send(validCashflowBody);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 3 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 4, created_by: 42 }),
      );
    });
  });

  // ── POST /:id/purchases ──────────────────────────────────────────────────
  describe("POST /api/suppliers/:id/purchases", () => {
    it("rejects staff (admin-only, mirrors suppliers:purchase-create)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/purchases")
        .set("x-test-role", "staff")
        .send({ total_usd: 50 });

      expect(res.status).toBe(403);
    });

    it("rejects when total_usd is not positive (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/suppliers/1/purchases")
        .set("x-test-role", "admin")
        .send({ total_usd: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path forwards the IPC-identical envelope verbatim (no success wrapper)", async () => {
      const purchase = {
        id: 1,
        supplier_id: 2,
        total_usd: 50,
        paid_usd: 0,
        status: "UNPAID",
        note: null,
        created_by: 42,
        created_at: "now",
        updated_at: "now",
      };
      const spy = jest
        .spyOn(supplierService, "createPurchase")
        .mockReturnValue(purchase as any);

      const res = await request(app)
        .post("/api/suppliers/2/purchases")
        .set("x-test-role", "admin")
        .send({ total_usd: 50 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(purchase);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 2, created_by: 42 }),
      );
    });
  });

  // ── PUT /:id/account-link (LIRA-191) ─────────────────────────────────────
  describe("PUT /api/suppliers/:id/account-link", () => {
    it("rejects staff (admin-only, mirrors suppliers:update-account-link)", async () => {
      const res = await request(app)
        .put("/api/suppliers/1/account-link")
        .set("x-test-role", "staff")
        .send({ account_supplier_id: 2 });

      expect(res.status).toBe(403);
    });

    it("rejects a non-numeric account_supplier_id (core supplierAccountLinkSchema) — rule 19c: 200 + string error", async () => {
      const res = await request(app)
        .put("/api/suppliers/1/account-link")
        .set("x-test-role", "admin")
        .send({ account_supplier_id: "not-a-number" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("happy path: supplier_id comes from the URL, account_supplier_id from the body", async () => {
      const spy = jest
        .spyOn(supplierService, "updateSupplierAccountLink")
        .mockReturnValue({ success: true, id: 3 });

      const res = await request(app)
        .put("/api/suppliers/3/account-link")
        .set("x-test-role", "admin")
        .send({ account_supplier_id: 2 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 3 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 3, account_supplier_id: 2 }),
      );
    });

    it("accepts a null account_supplier_id (detach to standalone)", async () => {
      const spy = jest
        .spyOn(supplierService, "updateSupplierAccountLink")
        .mockReturnValue({ success: true, id: 3 });

      const res = await request(app)
        .put("/api/suppliers/3/account-link")
        .set("x-test-role", "admin")
        .send({ account_supplier_id: null });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 3 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 3, account_supplier_id: null }),
      );
    });

    it("surfaces a repository validation error verbatim (rule 19c: 200 + string error, never a 4xx/5xx)", async () => {
      jest.spyOn(supplierService, "updateSupplierAccountLink").mockReturnValue({
        success: false,
        error: 'Supplier "OMT" cannot be its own account parent',
      });

      const res = await request(app)
        .put("/api/suppliers/1/account-link")
        .set("x-test-role", "admin")
        .send({ account_supplier_id: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: 'Supplier "OMT" cannot be its own account parent',
      });
    });
  });

  // ── GET / and GET /balances — includeInactive parity (LIRA-297 B2) ─────
  // The IPC twins (suppliers:list / suppliers:balances) forward
  // includeInactive to the service; backendApi.ts sends it as
  // ?includeInactive=true. The spies model the repository's real filter
  // (inactive rows only when the flag is true) so the assertion is on what
  // the web user actually sees, not just on the call shape.
  describe("includeInactive query parameter", () => {
    const active = { id: 1, name: "Active Co", is_active: 1 };
    const inactive = { id: 2, name: "Dormant Co", is_active: 0 };
    const listImpl = (_search?: string, includeInactive?: boolean) =>
      (includeInactive ? [active, inactive] : [active]) as any;
    const balancesImpl = (includeInactive?: boolean) =>
      (includeInactive
        ? [
            { ...active, balance_usd: 0 },
            { ...inactive, balance_usd: 5 },
          ]
        : [{ ...active, balance_usd: 0 }]) as any;

    it("GET /api/suppliers?includeInactive=true returns the inactive supplier", async () => {
      const spy = jest
        .spyOn(supplierService, "listSuppliers")
        .mockImplementation(listImpl);

      const res = await request(app)
        .get("/api/suppliers?includeInactive=true")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.suppliers.map((s: any) => s.id)).toEqual([1, 2]);
      expect(spy).toHaveBeenCalledWith(undefined, true);
    });

    it("GET /api/suppliers?includeInactive=1 is accepted too, and search still forwards", async () => {
      const spy = jest
        .spyOn(supplierService, "listSuppliers")
        .mockImplementation(listImpl);

      const res = await request(app)
        .get("/api/suppliers?search=Co&includeInactive=1")
        .set("x-test-role", "staff");

      expect(res.body.suppliers.map((s: any) => s.id)).toEqual([1, 2]);
      expect(spy).toHaveBeenCalledWith("Co", true);
    });

    it("GET /api/suppliers without the flag (or with a non-true value) hides the inactive supplier", async () => {
      const spy = jest
        .spyOn(supplierService, "listSuppliers")
        .mockImplementation(listImpl);

      const plain = await request(app)
        .get("/api/suppliers")
        .set("x-test-role", "staff");
      const falsy = await request(app)
        .get("/api/suppliers?includeInactive=false")
        .set("x-test-role", "staff");

      expect(plain.body.suppliers.map((s: any) => s.id)).toEqual([1]);
      expect(falsy.body.suppliers.map((s: any) => s.id)).toEqual([1]);
      expect(spy).toHaveBeenNthCalledWith(1, undefined, false);
      expect(spy).toHaveBeenNthCalledWith(2, undefined, false);
    });

    it("GET /api/suppliers/balances?includeInactive=true returns the inactive supplier's balance", async () => {
      const spy = jest
        .spyOn(supplierService, "getSupplierBalances")
        .mockImplementation(balancesImpl);

      const res = await request(app)
        .get("/api/suppliers/balances?includeInactive=true")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.balances.map((b: any) => b.id)).toEqual([1, 2]);
      expect(spy).toHaveBeenCalledWith(true);
    });

    it("GET /api/suppliers/balances without the flag hides the inactive supplier", async () => {
      const spy = jest
        .spyOn(supplierService, "getSupplierBalances")
        .mockImplementation(balancesImpl);

      const res = await request(app)
        .get("/api/suppliers/balances")
        .set("x-test-role", "staff");

      expect(res.body.balances.map((b: any) => b.id)).toEqual([1]);
      expect(spy).toHaveBeenCalledWith(false);
    });
  });

  // ── POST / (create) ─────────────────────────────────────────────────────
  // LIRA-297: the route used to check `name` by hand (HTTP 400 when missing,
  // every other field forwarded unchecked) while desktop validated against
  // `SupplierCreateSchema`. Both now run the shared core
  // `supplierCreateSchema`, so web rejects exactly what desktop rejects, in
  // the IPC envelope (HTTP 200 + { success:false, error }, rule 19c).
  describe("POST /api/suppliers (create)", () => {
    it("rejects a missing name in the IPC envelope (HTTP 200), never reaching the service", async () => {
      const spy = jest.spyOn(supplierService, "createSupplier");

      const res = await request(app)
        .post("/api/suppliers")
        .set("x-test-role", "admin")
        .send({ phone: "70123456" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a non-string contact_name the way desktop does (service never called)", async () => {
      const spy = jest.spyOn(supplierService, "createSupplier");

      const res = await request(app)
        .post("/api/suppliers")
        .set("x-test-role", "admin")
        .send({ name: "Acme", contact_name: 42 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("forwards every schema key to SupplierService.createSupplier and strips unknown ones", async () => {
      const spy = jest
        .spyOn(supplierService, "createSupplier")
        .mockReturnValue({ success: true, id: 9 });
      const payload = {
        name: "Acme",
        contact_name: "Sam",
        phone: "70123456",
        note: "n",
        module_key: "recharge",
        provider: "MTC",
      } satisfies SupplierCreatePayload;

      const res = await request(app)
        .post("/api/suppliers")
        .set("x-test-role", "admin")
        .send({ ...payload, is_system: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 9 });
      expect(spy).toHaveBeenCalledWith(payload);
    });

    it("a service failure answers HTTP 200 + { success:false } like IPC", async () => {
      jest
        .spyOn(supplierService, "createSupplier")
        .mockReturnValue({ success: false, error: "UNIQUE constraint failed" });

      const res = await request(app)
        .post("/api/suppliers")
        .set("x-test-role", "admin")
        .send({ name: "Acme" } satisfies SupplierCreatePayload);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "UNIQUE constraint failed",
      });
    });
  });
});
