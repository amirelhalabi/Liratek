/**
 * LIRA-339 (T041) — REST twin of the voucher IPC handlers: `POST /` forwards
 * the tender keys; `POST /:id/cancel` validates with the core cancel schema,
 * stays admin-only, takes the actor from the JWT, and answers HTTP 200 +
 * success:false on failure (rule 19c).
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = { userId: 42, username: "t", role, tenantId: 1, sessionToken: "s" };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

const createVoucher = jest.fn<(...a: any[]) => any>();
const cancelVoucher = jest.fn<(...a: any[]) => any>();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getVoucherService: () => ({ createVoucher, cancelVoucher }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import { getAuditService, voucherCreateSchema, voucherCancelSchema } from "@liratek/core";
import voucherRoutes from "../vouchers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/vouchers", voucherRoutes);
  return app;
}

describe("vouchers REST (LIRA-339)", () => {
  let app: Express;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    app = buildApp();
    createVoucher.mockReset();
    cancelVoucher.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it("POST / forwards payments, exchange_rate and transaction_time; actor from JWT", async () => {
    createVoucher.mockReturnValue({ success: true });
    const body = voucherCreateSchema.parse({
      clientId: 7,
      amount: 50,
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
      exchange_rate: 89500,
      transaction_time: "2026-10-24 10:00:00",
    });
    await request(app).post("/api/vouchers").set("x-test-role", "staff").send(body);
    expect(createVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: body.payments,
        exchange_rate: 89500,
        transaction_time: body.transaction_time,
      }),
      42,
    );
  });

  it("POST /:id/cancel validates and forwards the refund input with the JWT actor", async () => {
    cancelVoucher.mockReturnValue({ success: true });
    const body = voucherCancelSchema.parse({
      payments: [{ method: "CASH", currency_code: "LBP", amount: 900000 }],
      exchange_rate: 89500,
      client_day: "2026-10-24",
    });
    const res = await request(app)
      .post("/api/vouchers/5/cancel")
      .set("x-test-role", "admin")
      .send({ ...body, userId: 1 });
    expect(res.status).toBe(200);
    expect(cancelVoucher).toHaveBeenCalledWith(5, expect.objectContaining(body), 42);
    expect(cancelVoucher.mock.calls[0][1]).not.toHaveProperty("userId");
  });

  it("POST /:id/cancel refuses a non-drawer refund leg without calling the service", async () => {
    const res = await request(app)
      .post("/api/vouchers/5/cancel")
      .set("x-test-role", "admin")
      .send({ payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 }] });
    expect(res.body.success).toBe(false);
    expect(cancelVoucher).not.toHaveBeenCalled();
  });

  it("a service failure answers HTTP 200 with success:false", async () => {
    cancelVoucher.mockReturnValue({ success: false, error: "Already redeemed" });
    const res = await request(app).post("/api/vouchers/5/cancel").set("x-test-role", "admin").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Already redeemed" });
  });

  it("cancel stays admin-only", async () => {
    const res = await request(app).post("/api/vouchers/5/cancel").set("x-test-role", "staff").send({});
    expect(res.status).toBe(403);
    expect(cancelVoucher).not.toHaveBeenCalled();
  });
});
