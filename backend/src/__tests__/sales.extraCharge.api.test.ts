/**
 * LIRA-319 T018 — `POST /api/sales/process` (web) carries the extra charge
 * the same way the desktop IPC handler does: both validate with core's
 * `saleProcessSchema` and call the same `SalesService.processSale`.
 *
 * Without `extra_usd` in the schema Zod strips it (rule 23) and a web sale
 * is booked at the item price with the extra silently lost. Refusals come
 * back as HTTP 200 `{ success: false, error }` (rule 19c). Field names are
 * the schema's own (rule 24): the fixture is typed as its input.
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
import type { z } from "zod";
import { getSalesService, saleProcessSchema } from "@liratek/core";
import salesRouter from "../api/sales.js";

type SalePayload = z.input<typeof saleProcessSchema>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

const SALE: SalePayload = {
  client_id: null,
  items: [{ product_id: 1, quantity: 1, price: 6 }],
  total_amount: 6,
  discount: 0,
  final_amount: 6,
  payment_usd: 0,
  payment_lbp: 0,
  payments: [{ method: "CASH", currency_code: "USD", amount: 7 }],
  exchange_rate: 89500,
  status: "completed",
};

describe("POST /api/sales/process — LIRA-319 extra charge", () => {
  const service = getSalesService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards extra_usd to the service", async () => {
    const spy = jest
      .spyOn(service, "processSale")
      .mockReturnValue({ success: true, id: 5 } as never);
    const body: SalePayload = { ...SALE, extra_usd: 1 };
    const res = await request(buildApp())
      .post("/api/sales/process")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ extra_usd: 1 });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(service, "processSale")
      .mockReturnValue({ success: true, id: 5 } as never);
    await request(buildApp())
      .post("/api/sales/process")
      .send(SALE)
      .set("x-test-role", "staff");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it.each([
    [
      "discount + extra",
      { discount: 1, final_amount: 5, extra_usd: 1 },
      "A sale can have a discount or an extra, not both.",
    ],
    [
      "extra on a for-partner sale",
      { extra_usd: 1, partnerId: 3, partnerMode: "FOR" as const, payments: [] },
      "No extra on a for-partner sale.",
    ],
    [
      "an LBP extra on a POS sale",
      { extra_lbp: 10_000 },
      "A POS sale's extra is in dollars — enter it in USD.",
    ],
  ])("refuses %s with HTTP 200 { success: false }", async (_name, patch, message) => {
    const spy = jest.spyOn(service, "processSale");
    const body: SalePayload = { ...SALE, ...patch };
    const res = await request(buildApp())
      .post("/api/sales/process")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: message });
    expect(spy).not.toHaveBeenCalled();
  });
});
