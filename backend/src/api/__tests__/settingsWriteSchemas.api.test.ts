/**
 * LIRA-297 (scope item 3, typed adapters) — REST twins of the currency,
 * payment-method and drawer top-up IPC write channels now validate against
 * the SAME core schema the IPC handler uses (rule 14/19), and answer every
 * failure in the IPC envelope (HTTP 200 + { success:false, error }, rule 19c).
 *
 * Pattern mirrors suppliers.api.test.ts / drawerCashout.api.test.ts: the REAL
 * routers with only ../../server.js (logger) and ../../middleware/auth.js
 * (header-driven `x-test-role`) faked; the core service singletons are REAL,
 * with their public methods stubbed via `jest.spyOn`.
 *
 * Payload fixtures are written against the schemas' own input types
 * (`satisfies …Payload`, rule 24). Note: backend `__tests__` are excluded from
 * `tsc` and ts-jest runs with diagnostics off, so those annotations document
 * the shape but are NOT compile-checked here. The compile-time guard that a
 * schema key matches what the repositories read is
 * packages/core/src/validators/__tests__/settingsWriteSchemas.test.ts (core's
 * tsconfig includes its tests).
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
      userId: 7,
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
  getAuditService,
  getCurrencyService,
  getDrawerTopUpService,
  getPaymentMethodService,
  type CreateCurrencyPayload,
  type CreatePaymentMethodPayload,
  type DrawerTopUpCreatePayload,
  type DrawerTopUpFromDrawerPayload,
  type UpdateCurrencyPayload,
  type UpdatePaymentMethodPayload,
} from "@liratek/core";
import currenciesRouter from "../currencies.js";
import paymentMethodsRouter from "../paymentMethods.js";
import drawerTopUpRouter from "../drawerTopUp.js";

function buildApp(mount: string, router: express.Router): Express {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
});

// ── currencies ──────────────────────────────────────────────────────────────
describe("POST /api/currencies", () => {
  const app = buildApp("/api/currencies", currenciesRouter);

  it("forwards every schema key to CurrencyService.createCurrency", async () => {
    const spy = jest
      .spyOn(getCurrencyService(), "createCurrency")
      .mockReturnValue({ success: true, id: 3 });
    const payload = {
      code: "EUR",
      name: "Euro",
      symbol: "€",
      decimal_places: 2,
    } satisfies CreateCurrencyPayload;

    const res = await request(app)
      .post("/api/currencies")
      .set("x-test-role", "admin")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 3 });
    expect(spy).toHaveBeenCalledWith(payload);
  });

  // The web bug this fixes: the route answered a duplicate code with HTTP
  // 400, `requestJson` throws on any non-2xx, and Settings → Currencies
  // ("Add") has no catch — so on the web the cashier saw nothing at all,
  // where desktop shows "Currency code already exists".
  it("a duplicate code answers HTTP 200 + { success:false } like IPC", async () => {
    jest.spyOn(getCurrencyService(), "createCurrency").mockReturnValue({
      success: false,
      error: "Currency code already exists",
    });

    const res = await request(app)
      .post("/api/currencies")
      .set("x-test-role", "admin")
      .send({ code: "USD", name: "US Dollar" } satisfies CreateCurrencyPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Currency code already exists",
    });
  });

  it("rejects a missing code without reaching the service", async () => {
    const spy = jest.spyOn(getCurrencyService(), "createCurrency");

    const res = await request(app)
      .post("/api/currencies")
      .set("x-test-role", "admin")
      .send({ name: "Euro" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/currencies/:id", () => {
  const app = buildApp("/api/currencies", currenciesRouter);

  it("forwards every schema key (id from the URL)", async () => {
    const spy = jest
      .spyOn(getCurrencyService(), "updateCurrency")
      .mockReturnValue({ success: true });
    const payload = {
      code: "EUR",
      name: "Euro",
      symbol: "€",
      decimal_places: 2,
      is_active: 0,
    } satisfies UpdateCurrencyPayload;

    const res = await request(app)
      .put("/api/currencies/5")
      .set("x-test-role", "admin")
      .send(payload);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(5, payload);
  });

  it("a not-found answers HTTP 200 + { success:false } like IPC", async () => {
    jest
      .spyOn(getCurrencyService(), "updateCurrency")
      .mockReturnValue({ success: false, error: "Not found" });

    const res = await request(app)
      .put("/api/currencies/999")
      .set("x-test-role", "admin")
      .send({ is_active: 1 } satisfies UpdateCurrencyPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Not found" });
  });

  it("rejects a non-numeric is_active without reaching the service", async () => {
    const spy = jest.spyOn(getCurrencyService(), "updateCurrency");

    const res = await request(app)
      .put("/api/currencies/5")
      .set("x-test-role", "admin")
      .send({ is_active: "yes" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── payment methods ─────────────────────────────────────────────────────────
describe("POST /api/payment-methods", () => {
  const app = buildApp("/api/payment-methods", paymentMethodsRouter);

  it("forwards every schema key (incl. sort_order) to PaymentMethodService.create", async () => {
    const spy = jest
      .spyOn(getPaymentMethodService(), "create")
      .mockReturnValue({ success: true, id: 11 });
    const payload = {
      code: "CARD",
      label: "Card",
      drawer_name: "General",
      affects_drawer: 0,
      sort_order: 4,
    } satisfies CreatePaymentMethodPayload;

    const res = await request(app)
      .post("/api/payment-methods")
      .set("x-test-role", "admin")
      .send(payload);

    expect(res.body).toEqual({ success: true, id: 11 });
    expect(spy).toHaveBeenCalledWith(payload);
  });

  it("rejects a missing drawer_name without reaching the service", async () => {
    const spy = jest.spyOn(getPaymentMethodService(), "create");

    const res = await request(app)
      .post("/api/payment-methods")
      .set("x-test-role", "admin")
      .send({ code: "CARD", label: "Card" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/payment-methods/:id", () => {
  const app = buildApp("/api/payment-methods", paymentMethodsRouter);

  it("forwards every schema key", async () => {
    const spy = jest
      .spyOn(getPaymentMethodService(), "update")
      .mockReturnValue({ success: true });
    const payload = {
      label: "Card",
      drawer_name: "General",
      affects_drawer: 1,
      is_active: 0,
      sort_order: 2,
    } satisfies UpdatePaymentMethodPayload;

    const res = await request(app)
      .put("/api/payment-methods/7")
      .set("x-test-role", "admin")
      .send(payload);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(7, payload);
  });

  it("rejects a non-numeric is_active without reaching the service", async () => {
    const spy = jest.spyOn(getPaymentMethodService(), "update");

    const res = await request(app)
      .put("/api/payment-methods/7")
      .set("x-test-role", "admin")
      .send({ is_active: "no" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── drawer top-up ───────────────────────────────────────────────────────────
describe("POST /api/drawer-topup", () => {
  const app = buildApp("/api/drawer-topup", drawerTopUpRouter);

  it("forwards every schema key (incl. extra_currencies entries) and injects userId from the JWT", async () => {
    const spy = jest
      .spyOn(getDrawerTopUpService(), "addTopUp")
      .mockReturnValue({ success: true, id: 21 });
    const payload = {
      amount_usd: 10,
      amount_lbp: 0,
      notes: "float",
      transaction_time: "2026-10-01T08:00:00.000Z",
      extra_currencies: [
        {
          currency_code: "EUR",
          amount: 50,
          acquisition_usd_per_unit: 1.08,
          market_usd_per_unit_hint: 1.07,
        },
      ],
    } satisfies DrawerTopUpCreatePayload;

    const res = await request(app)
      .post("/api/drawer-topup")
      .set("x-test-role", "staff")
      .send(payload);

    expect(res.body).toEqual({ success: true, id: 21 });
    expect(spy).toHaveBeenCalledWith(payload, 7);
  });

  // Desktop has always refused a negative amount (`nonnegative()` in the IPC
  // schema); the web route only did `Number(x) || 0`, and the service only
  // refuses when BOTH amounts are <= 0 — so the web accepted it and stored a
  // top-up row with a negative USD amount the drawer never received.
  it("rejects a negative amount the way desktop does (service never called)", async () => {
    const spy = jest.spyOn(getDrawerTopUpService(), "addTopUp");

    const res = await request(app)
      .post("/api/drawer-topup")
      .set("x-test-role", "staff")
      .send({ amount_usd: -50, amount_lbp: 100000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("POST /api/drawer-topup/from-drawer", () => {
  const app = buildApp("/api/drawer-topup", drawerTopUpRouter);

  it("forwards every schema key and injects userId from the JWT", async () => {
    const spy = jest
      .spyOn(getDrawerTopUpService(), "topUpFromDrawer")
      .mockReturnValue({ success: true, id: 22 });
    const payload = {
      amount_usd: 5,
      amount_lbp: 450000,
      source_drawer: "MTC",
      notes: "n",
      transaction_time: "2026-10-01T08:00:00.000Z",
    } satisfies DrawerTopUpFromDrawerPayload;

    const res = await request(app)
      .post("/api/drawer-topup/from-drawer")
      .set("x-test-role", "staff")
      .send(payload);

    expect(res.body).toEqual({ success: true, id: 22 });
    expect(spy).toHaveBeenCalledWith(payload, 7);
  });

  it("rejects a negative amount (service never called)", async () => {
    const spy = jest.spyOn(getDrawerTopUpService(), "topUpFromDrawer");

    const res = await request(app)
      .post("/api/drawer-topup/from-drawer")
      .set("x-test-role", "staff")
      .send({ amount_usd: -5, amount_lbp: 450000, source_drawer: "MTC" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
