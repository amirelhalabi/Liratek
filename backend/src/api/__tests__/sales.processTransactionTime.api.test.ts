/**
 * LIRA-298 — `POST /api/sales/process` (web) forwards the cashier's backdated
 * `transaction_time` to `SalesService.processSale`. The route validates with
 * core's `saleProcessSchema`; while that schema had no `transaction_time`
 * key Zod stripped it (rule 23) and every backdated web sale was booked at
 * "now". `deferPayment` stays server-only (session basket) and must never be
 * forwarded from a client.
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../websocket/io.js", () => ({ emitEvent: jest.fn() }));
jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

jest.mock("../../middleware/auth.js", () => {
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
import { getSalesService } from "@liratek/core";
import salesRouter from "../sales.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

const SALE = {
  client_id: null,
  items: [{ product_id: 1, quantity: 1, price: 10 }],
  total_amount: 10,
  discount: 0,
  final_amount: 10,
  payment_usd: 10,
  payment_lbp: 0,
  exchange_rate: 89500,
  status: "completed",
};

describe("POST /api/sales/process — LIRA-298 backdating", () => {
  const service = getSalesService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards transaction_time to the service", async () => {
    const spy = jest
      .spyOn(service, "processSale")
      .mockReturnValue({ success: true, id: 5 } as never);
    const res = await request(buildApp())
      .post("/api/sales/process")
      .send({ ...SALE, transaction_time: "2026-10-05T09:00:00.000Z" })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      transaction_time: "2026-10-05T09:00:00.000Z",
    });
    expect(spy.mock.calls[0]![1]).toBe(7);
  });

  it("does not forward a client-sent deferPayment", async () => {
    const spy = jest
      .spyOn(service, "processSale")
      .mockReturnValue({ success: true, id: 5 } as never);
    await request(buildApp())
      .post("/api/sales/process")
      .send({ ...SALE, deferPayment: true })
      .set("x-test-role", "staff");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("deferPayment");
  });
});
