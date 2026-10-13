/**
 * LIRA-319 T055a (session basket) — `POST /api/sessions/checkout` (web)
 * carries the basket extra the same way the desktop `session:checkout` IPC
 * handler does: both validate with core's `sessionCheckoutSchema` and call
 * the same `SessionCheckoutService.checkout`, which books the EXTRA_CHARGE
 * row and verifies the cap (covered by core's
 * SessionCheckoutService.extraCharge.test.ts).
 *
 * Without `extra_usd` in the schema Zod strips it (rule 23) and a web basket
 * would be charged without its extra. Refusals come back as HTTP 200
 * `{ success: false, error }` (rule 19c). Field names are the schema's own
 * (rule 24): the fixture is typed as its input. Not proven failing-first
 * (the schema is `.passthrough()`, so the forwarding cases passed before the
 * keys were declared; the negative-extra case describes new validation).
 */
import { jest } from "@jest/globals";

jest.mock("../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../websocket/io.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../middleware/audit.js", () => ({ auditRest: jest.fn() }));

jest.mock("../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = { userId: 7, username: "t", role, tenantId: 1, sessionToken: "s" };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user?.role)) {
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
  getSessionCheckoutService,
  type SessionCheckoutPayload,
} from "@liratek/core";
import sessionsRouter from "../api/sessions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
  return app;
}

const BASKET: SessionCheckoutPayload = {
  sessionId: 3,
  cartItems: [
    {
      id: "a",
      module: "custom_service",
      label: "Fitting",
      amount: 10,
      currency: "USD",
      formData: { description: "Fitting", price_usd: 10, cost_usd: 1 },
      ipcChannel: "custom-services:add",
    },
  ],
  payments: [{ method: "CASH", currency_code: "USD", amount: 12 }],
  exchangeRate: 89500,
  userId: 1,
};

describe("POST /api/sessions/checkout — LIRA-319 basket extra", () => {
  const service = getSessionCheckoutService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards extra_usd / extra_lbp to the checkout service (actor from the JWT)", async () => {
    const spy = jest
      .spyOn(service, "checkout")
      .mockResolvedValue({ success: true, itemCount: 1 } as never);
    const body: SessionCheckoutPayload = {
      ...BASKET,
      extra_usd: 2,
      extra_lbp: 0,
    };
    const res = await request(buildApp())
      .post("/api/sessions/checkout")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      extra_usd: 2,
      extra_lbp: 0,
      userId: 7,
    });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(service, "checkout")
      .mockResolvedValue({ success: true, itemCount: 1 } as never);
    await request(buildApp())
      .post("/api/sessions/checkout")
      .send(BASKET)
      .set("x-test-role", "staff");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it("refuses a negative extra with HTTP 200 { success: false } before the service runs", async () => {
    const spy = jest.spyOn(service, "checkout");
    const res = await request(buildApp())
      .post("/api/sessions/checkout")
      .send({ ...BASKET, extra_usd: -1 })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error)).toMatch(/extra_usd/);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra above the basket", "The extra can't be more than the sale itself."],
    ["an extra with a waive", "A sale can have a discount or an extra, not both."],
  ])("the service's refusal of %s comes back as HTTP 200 { success: false }", async (_n, message) => {
    jest
      .spyOn(service, "checkout")
      .mockResolvedValue({ success: false, error: message });
    const res = await request(buildApp())
      .post("/api/sessions/checkout")
      .send({ ...BASKET, extra_usd: 50 })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: message });
  });
});
