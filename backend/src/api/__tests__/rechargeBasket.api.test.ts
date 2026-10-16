/**
 * LIRA-326 — POST /api/recharge-basket/checkout: the REST twin of the
 * `recharge-basket:checkout` IPC handler. Auth first, then admin/staff; the
 * shared core schema (rule 14/23 — every key reaches the service); the
 * operator from the JWT, never the body; HTTP 200 with the IPC envelope on
 * failure too.
 *
 * Written with the new route: there was no prior behaviour to fail against
 * (not proven failing-first in the rule-17 sense).
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

const auditRest = jest.fn();
jest.mock("../../middleware/audit.js", () => ({
  auditRest: (...a: unknown[]) => auditRest(...a),
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
      sessionToken: "s",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

const checkout = jest.fn(
  async (..._a: unknown[]): Promise<unknown> => ({
    success: true,
    sessionId: 7,
    results: [],
    checkoutTotalUsd: 0,
    checkoutTotalLbp: 800000,
  }),
);

const partnerSubmit = jest.fn((..._a: unknown[]): unknown => ({
  success: true,
  ids: [1, 2],
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getRechargeBasketService: () => ({ checkout }),
    getRechargePartnerOrderService: () => ({ submit: partnerSubmit }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import {
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  type RechargeBasketCheckoutPayload,
  type RechargePartnerOrderPayload,
} from "@liratek/core";
import rechargeBasketRoutes from "../rechargeBasket.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/recharge-basket", rechargeBasketRoutes);
  return app;
}

const BODY: RechargeBasketCheckoutPayload = {
  cartItems: [
    {
      id: "katsh",
      module: "katsh",
      label: "Katsh: mtc 7.58",
      amount: 800000,
      currency: "LBP",
      ipcChannel: "financial:create",
      formData: {
        _batch: true,
        items: [{ provider: "Katsh", amount: 800000 }],
      },
    },
  ],
  payments: [
    { method: "CASH", currency_code: "LBP", amount: 800000, direction: "IN" },
  ],
  exchangeRate: 89500,
  clientName: "Rami",
  clientPhone: "70111222",
  userId: 999, // must be replaced by the JWT's user
};

describe("POST /api/recharge-basket/checkout", () => {
  let app: Express;
  beforeEach(() => {
    app = buildApp();
    checkout.mockClear();
    auditRest.mockClear();
  });

  it("401 without a token; the service never runs", async () => {
    const res = await request(app)
      .post("/api/recharge-basket/checkout")
      .send(BODY);
    expect(res.status).toBe(401);
    expect(checkout).not.toHaveBeenCalled();
  });

  it("403 for a role outside admin/staff", async () => {
    const res = await request(app)
      .post("/api/recharge-basket/checkout")
      .set("x-test-role", "viewer")
      .send(BODY);
    expect(res.status).toBe(403);
    expect(checkout).not.toHaveBeenCalled();
  });

  it.each(["admin", "staff"])(
    "%s: forwards every schema key with the JWT operator",
    async (role) => {
      const res = await request(app)
        .post("/api/recharge-basket/checkout")
        .set("x-test-role", role)
        .send(BODY);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, sessionId: 7 });
      expect(checkout).toHaveBeenCalledTimes(1);
      const [req, ctx] = checkout.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];
      const parsed = rechargeBasketCheckoutSchema.parse(BODY);
      expect(req).toEqual({ ...parsed, userId: 42 });
      expect(req.clientPhone).toBe("70111222");
      expect(ctx).toEqual({ username: "tester" });
      expect(auditRest).toHaveBeenCalledTimes(1);
    },
  );

  it("a body without userId is accepted (the JWT supplies it)", async () => {
    const { userId: _u, ...noUser } = BODY;
    const res = await request(app)
      .post("/api/recharge-basket/checkout")
      .set("x-test-role", "staff")
      .send(noUser);
    expect(res.body.success).toBe(true);
    expect((checkout.mock.calls[0][0] as { userId: number }).userId).toBe(42);
  });

  it("an invalid body: HTTP 200 + { success:false }, service not called", async () => {
    const res = await request(app)
      .post("/api/recharge-basket/checkout")
      .set("x-test-role", "staff")
      .send({ ...BODY, cartItems: [] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Validation failed/);
    expect(checkout).not.toHaveBeenCalled();
  });

  it("a refused checkout: HTTP 200 with the service's envelope, no audit", async () => {
    checkout.mockResolvedValueOnce({
      success: false,
      error: "mixes providers",
    });
    const res = await request(app)
      .post("/api/recharge-basket/checkout")
      .set("x-test-role", "staff")
      .send(BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "mixes providers" });
    expect(auditRest).not.toHaveBeenCalled();
  });
});

// LIRA-327 — POST /api/recharge-basket/partner-order: the REST twin of
// `recharge-basket:partner-order`. New route: not proven failing-first.
const ORDER: RechargePartnerOrderPayload = {
  partnerId: 7,
  sales: [
    {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 500000,
      cost: 500000,
      price: 500000,
      currency: "LBP",
      commission: 0,
      payments: [],
    },
  ],
  userId: 999, // must be replaced by the JWT's user
};

describe("POST /api/recharge-basket/partner-order", () => {
  let app: Express;
  beforeEach(() => {
    app = buildApp();
    partnerSubmit.mockClear();
    auditRest.mockClear();
  });

  it("401 without a token, 403 for a viewer; the service never runs", async () => {
    const noToken = await request(app)
      .post("/api/recharge-basket/partner-order")
      .send(ORDER);
    expect(noToken.status).toBe(401);
    const viewer = await request(app)
      .post("/api/recharge-basket/partner-order")
      .set("x-test-role", "viewer")
      .send(ORDER);
    expect(viewer.status).toBe(403);
    expect(partnerSubmit).not.toHaveBeenCalled();
  });

  it.each(["admin", "staff"])(
    "%s: forwards the schema's own parse with the JWT operator, and audits",
    async (role) => {
      const res = await request(app)
        .post("/api/recharge-basket/partner-order")
        .set("x-test-role", role)
        .send(ORDER);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, ids: [1, 2] });
      const parsed = rechargePartnerOrderSchema.parse(ORDER);
      expect(partnerSubmit.mock.calls[0]![0]).toEqual({
        ...parsed,
        userId: 42,
      });
      expect(auditRest).toHaveBeenCalledTimes(1);
    },
  );

  it("an invalid body: HTTP 200 + { success:false }, service not called", async () => {
    const res = await request(app)
      .post("/api/recharge-basket/partner-order")
      .set("x-test-role", "staff")
      .send({ ...ORDER, sales: [] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Validation failed/);
    expect(partnerSubmit).not.toHaveBeenCalled();
  });

  it("a refused order: HTTP 200 with the service's envelope, no audit", async () => {
    partnerSubmit.mockReturnValueOnce({ success: false, error: "Nope" });
    const res = await request(app)
      .post("/api/recharge-basket/partner-order")
      .set("x-test-role", "staff")
      .send(ORDER);
    expect(res.body).toEqual({ success: false, error: "Nope" });
    expect(auditRest).not.toHaveBeenCalled();
  });
});
