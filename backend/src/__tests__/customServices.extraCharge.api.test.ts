/**
 * LIRA-319 T055a (Custom Services) — `POST /api/custom-services/` (web)
 * carries the extra charge the same way the desktop `custom-services:add`
 * IPC handler does: both validate with core's `createCustomServiceSchema`
 * and call the same `CustomServiceService.addService`.
 *
 * Without `extra_usd` in the schema Zod strips it (rule 23) and a web
 * service is booked at the selling price with the extra silently lost.
 * Refusals come back as HTTP 200 `{ success: false, error }` (rule 19c).
 * Field names are the schema's own (rule 24): the fixture is typed as its
 * input. Not proven failing-first (written after the schema change).
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
  getCustomServiceService,
  type CreateCustomServicePayload,
} from "@liratek/core";
import customServicesRouter from "../api/customServices.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/custom-services", customServicesRouter);
  return app;
}

const SERVICE: CreateCustomServicePayload = {
  description: "Screen protector fitting",
  cost_usd: 7,
  price_usd: 9,
  paid_by: "CASH",
  payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
  exchange_rate: 89500,
};

describe("POST /api/custom-services — LIRA-319 extra charge", () => {
  const service = getCustomServiceService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards extra_usd to the service", async () => {
    const spy = jest
      .spyOn(service, "addService")
      .mockReturnValue({ success: true, id: 5 } as never);
    const body: CreateCustomServicePayload = { ...SERVICE, extra_usd: 1 };
    const res = await request(buildApp())
      .post("/api/custom-services")
      .send(body)
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ extra_usd: 1, price_usd: 9 });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(service, "addService")
      .mockReturnValue({ success: true, id: 5 } as never);
    await request(buildApp())
      .post("/api/custom-services")
      .send(SERVICE)
      .set("x-test-role", "admin");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it.each<[string, Partial<CreateCustomServicePayload>, string]>([
    [
      "discount + extra",
      { discount_usd: 1, price_usd: 8, extra_usd: 1 },
      "A sale can have a discount or an extra, not both.",
    ],
    [
      "an extra above the price",
      { extra_usd: 9.5 },
      "The extra can't be more than the sale itself.",
    ],
    [
      "extra on a for-partner service",
      { extra_usd: 1, partnerId: 3, partnerMode: "FOR", payments: [] },
      "No extra on a for-partner sale.",
    ],
  ])("refuses %s with HTTP 200 { success: false }", async (_name, patch, message) => {
    const spy = jest.spyOn(service, "addService");
    const body: CreateCustomServicePayload = { ...SERVICE, ...patch };
    const res = await request(buildApp())
      .post("/api/custom-services")
      .send(body)
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: message });
    expect(spy).not.toHaveBeenCalled();
  });
});
