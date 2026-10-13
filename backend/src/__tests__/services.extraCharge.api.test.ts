/**
 * LIRA-319 T055a (financial-send part) — `POST /api/services/transactions`
 * (web) carries the extra charge the same way the desktop `omt:add-transaction`
 * IPC handler does: both validate with core's `createFinancialServiceSchema`
 * and call the same `FinancialService.addTransaction`.
 *
 * Without `extra_usd`/`extra_lbp` in the schema Zod strips them (rule 23) and
 * a web OMT/Whish send, Katsh cart or crypto send is booked with the extra
 * lost (the legs would then fail to reconcile). Refusals come back as HTTP
 * 200 `{ success: false, error }` (rule 19c). Field names are the schema's
 * own (rule 24): fixtures are typed as its input. The money itself is proven
 * in core (`FinancialServiceRepository.extraCharge.test.ts`).
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
  getFinancialService,
  getFinancialServiceRepository,
  BusinessRuleError,
  type CreateFinancialServicePayload,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  EXTRA_ON_SESSION_ITEM_MESSAGE,
  NO_EXTRA_FOR_PARTNER_MESSAGE,
  NO_EXTRA_ON_PAYOUT_MESSAGE,
} from "@liratek/core";
import servicesRouter from "../api/services.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/services", servicesRouter);
  return app;
}

const SEND: CreateFinancialServicePayload = {
  provider: "OMT",
  serviceType: "SEND",
  amount: 100,
  currency: "USD",
  omtFee: 1,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
};

describe("POST /api/services/transactions — LIRA-319 extra charge", () => {
  const service = getFinancialService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards extra_usd to the service, with the actor from the JWT", async () => {
    const spy = jest
      .spyOn(service, "addTransaction")
      .mockReturnValue({ success: true, id: 5 });
    const body: CreateFinancialServicePayload = { ...SEND, extra_usd: 1 };
    const res = await request(buildApp())
      .post("/api/services/transactions")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ extra_usd: 1, userId: 7 });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(service, "addTransaction")
      .mockReturnValue({ success: true, id: 5 });
    await request(buildApp())
      .post("/api/services/transactions")
      .send(SEND)
      .set("x-test-role", "staff");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it.each([
    [
      "extra on a RECEIVE payout",
      { serviceType: "RECEIVE" as const, payments: undefined, extra_usd: 1 },
      NO_EXTRA_ON_PAYOUT_MESSAGE,
    ],
    [
      "extra on a for-partner send",
      { partnerId: 3, partnerMode: "FOR" as const, payments: [], extra_usd: 1 },
      NO_EXTRA_FOR_PARTNER_MESSAGE,
    ],
    [
      "extra on a deferred (session-basket / cart-sibling) unit",
      { deferPayment: true, payments: undefined, extra_usd: 1 },
      EXTRA_ON_SESSION_ITEM_MESSAGE,
    ],
  ])("refuses %s with HTTP 200 { success: false }", async (_name, patch, message) => {
    const spy = jest.spyOn(service, "addTransaction");
    const body: CreateFinancialServicePayload = { ...SEND, ...patch };
    const res = await request(buildApp())
      .post("/api/services/transactions")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: message });
    expect(spy).not.toHaveBeenCalled();
  });

  it("an over-limit extra (refused by the repository, both transports) comes back as HTTP 200 { success: false }", async () => {
    jest
      .spyOn(getFinancialServiceRepository(), "createTransaction")
      .mockImplementation(() => {
        throw new BusinessRuleError(EXTRA_ABOVE_TOTAL_MESSAGE);
      });
    const body: CreateFinancialServicePayload = {
      ...SEND,
      extra_usd: 500,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 601 }],
    };
    const res = await request(buildApp())
      .post("/api/services/transactions")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: false,
      error: EXTRA_ABOVE_TOTAL_MESSAGE,
    });
  });
});
