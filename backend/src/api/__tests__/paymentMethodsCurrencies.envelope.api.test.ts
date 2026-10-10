/**
 * /api/payment-methods (POST, PUT /reorder, PUT /:id) and
 * PUT /api/currencies/:id — a refusal answers HTTP 200 with the
 * IPC-identical envelope `{ success: false, error }` (CLAUDE.md rule 19c).
 * `requestJson` throws on any non-2xx status, so the old HTTP 400 turned a
 * plain refusal into a thrown error on the web app only.
 *
 * Expected bodies are the services' own result objects (rule 24).
 *
 * Rule 17: written before the route fix and run against the unfixed routes
 * (2026-10-10). All five cases FAILED there with
 * `expect(res.status).toBe(200)` receiving 400.
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
import { getPaymentMethodService, getCurrencyService } from "@liratek/core";
import paymentMethodsRouter from "../paymentMethods.js";
import currenciesRouter from "../currencies.js";
import { auditRest } from "../../middleware/audit.js";

function buildApp(mount: string, router: express.Router): Express {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app;
}

describe("payment methods — refusal envelope (rule 19c)", () => {
  const app = buildApp("/api/payment-methods", paymentMethodsRouter);

  beforeEach(() => {
    jest.restoreAllMocks();
    (auditRest as jest.Mock).mockClear();
  });

  it("POST: a service refusal answers HTTP 200 + the service envelope", async () => {
    const serviceResult = {
      success: false,
      error: "UNIQUE constraint failed: payment_methods.code",
    };
    jest
      .spyOn(getPaymentMethodService(), "create")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .post("/api/payment-methods")
      .set("x-test-role", "admin")
      .send({ code: "CASH", label: "Cash", drawer_name: "General" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("PUT /:id: a service refusal answers HTTP 200 + the service envelope", async () => {
    const serviceResult = { success: false, error: "Payment method not found" };
    jest
      .spyOn(getPaymentMethodService(), "update")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .put("/api/payment-methods/999")
      .set("x-test-role", "admin")
      .send({ label: "New Label" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("PUT /:id: a non-numeric id answers HTTP 200 + {success:false, error}", async () => {
    const spy = jest.spyOn(getPaymentMethodService(), "update");

    const res = await request(app)
      .put("/api/payment-methods/abc")
      .set("x-test-role", "admin")
      .send({ label: "New Label" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Invalid id" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("PUT /reorder: a service refusal answers HTTP 200 + the service envelope", async () => {
    const serviceResult = {
      success: false,
      error: "ids must be a non-empty array",
    };
    jest
      .spyOn(getPaymentMethodService(), "reorder")
      .mockReturnValue(serviceResult);

    const res = await request(app)
      .put("/api/payment-methods/reorder")
      .set("x-test-role", "admin")
      .send({ ids: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
    expect(auditRest).not.toHaveBeenCalled();
  });
});

describe("PUT /api/currencies/:id — refusal envelope (rule 19c)", () => {
  const app = buildApp("/api/currencies", currenciesRouter);

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("a non-numeric id answers HTTP 200 + {success:false, error}", async () => {
    const spy = jest.spyOn(getCurrencyService(), "updateCurrency");

    const res = await request(app)
      .put("/api/currencies/abc")
      .set("x-test-role", "admin")
      .send({ name: "Dollar" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Invalid currency ID",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
