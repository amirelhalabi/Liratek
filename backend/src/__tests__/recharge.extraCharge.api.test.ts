/**
 * LIRA-319 T055a (Recharge part) — `POST /api/recharge/process` (web) carries
 * the extra charge the same way the desktop IPC handler does: both validate
 * with core's `createRechargeSchema` and call the same
 * `RechargeService.processRecharge`.
 *
 * Without `extra_lbp`/`extra_usd` in the schema Zod strips them (rule 23)
 * and a web recharge is booked at the sale price with the extra lost.
 * Refusals come back as HTTP 200 `{ success: false, error }` (rule 19c).
 * Field names are the schema's own (rule 24): the fixture is typed as its
 * input. The money itself is proven in core
 * (`RechargeRepository.extraCharge.test.ts`).
 */
import { jest } from "@jest/globals";

jest.mock("../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
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
  getRechargeService,
  type CreateRechargePayload,
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  NO_EXTRA_FOR_PARTNER_MESSAGE,
  NO_EXTRA_ON_BUYBACK_MESSAGE,
  RECHARGE_EXTRA_CURRENCY_MESSAGE,
} from "@liratek/core";
import rechargeRouter from "../api/recharge.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/recharge", rechargeRouter);
  return app;
}

const SALE: CreateRechargePayload = {
  provider: "Alfa",
  type: "ALFA_GIFT",
  amount: 3,
  cost: 255_000,
  price: 300_000,
  currency: "LBP",
  payments: [{ method: "CASH", currencyCode: "LBP", amount: 320_000 }],
};

describe("POST /api/recharge/process — LIRA-319 extra charge", () => {
  const service = getRechargeService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards extra_lbp to the service, with the actor from the JWT", async () => {
    const spy = jest
      .spyOn(service, "processRecharge")
      .mockReturnValue({ success: true, id: 5 });
    const body: CreateRechargePayload = { ...SALE, extra_lbp: 20_000 };
    const res = await request(buildApp())
      .post("/api/recharge/process")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ extra_lbp: 20_000, userId: 7 });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(service, "processRecharge")
      .mockReturnValue({ success: true, id: 5 });
    await request(buildApp())
      .post("/api/recharge/process")
      .send(SALE)
      .set("x-test-role", "staff");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it.each([
    ["discount + extra", { discount: 10_000, extra_lbp: 20_000 }, DISCOUNT_AND_EXTRA_MESSAGE],
    [
      "extra on a for-partner sale",
      { extra_lbp: 20_000, partnerId: 3, partnerMode: "FOR" as const, payments: [] },
      NO_EXTRA_FOR_PARTNER_MESSAGE,
    ],
    ["extra above the sale", { extra_lbp: 300_001 }, EXTRA_ABOVE_TOTAL_MESSAGE],
    ["a USD extra on an LBP sale", { extra_usd: 1 }, RECHARGE_EXTRA_CURRENCY_MESSAGE],
    [
      "extra on a credit buy-back",
      { type: "CREDIT_BUYBACK" as const, extra_lbp: 20_000 },
      NO_EXTRA_ON_BUYBACK_MESSAGE,
    ],
  ])("refuses %s with HTTP 200 { success: false }", async (_name, patch, message) => {
    const spy = jest.spyOn(service, "processRecharge");
    const body: CreateRechargePayload = { ...SALE, ...patch };
    const res = await request(buildApp())
      .post("/api/recharge/process")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: message });
    expect(spy).not.toHaveBeenCalled();
  });
});
