/**
 * LIRA-258 rollout — the loto REST routes forward the keys the G14/G23 core
 * checks depend on (rule 23: Zod strips unknown keys silently, so a key the
 * schema lacks, or a route that never passes it on, vanishes with no error).
 *
 *   - POST /sell: `tender_exchange_rate` and a GIFT_CARD leg's `voucherCode`
 *     reach `LotoService.sellTicket`.
 *   - POST /checkpoints/settle-batch: the Settle dialog's split `payments`
 *     and `tender_exchange_rate` reach `settleCheckpoints` (legacy single
 *     `payment` still works).
 *   - POST /checkpoints/:id/settle: `tender_exchange_rate` reaches
 *     `settleCheckpoint`.
 *
 * Real core schemas (jest.requireActual); only getLotoService is stubbed —
 * same pattern as lotoUpdateMetadataRoles.api.test.ts.
 *
 * Not proven failing-first (rule 17): written after the route changes.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = { userId: 42, username: "tester", role, tenantId: 1, sessionToken: "s" };
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

const sellTicket = jest.fn((..._a: unknown[]) => ({ id: 1 }));
const settleCheckpoint = jest.fn((..._a: unknown[]) => ({ id: 5 }));
const settleCheckpoints = jest.fn((..._a: unknown[]) => [{ id: 5 }, { id: 6 }]);

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getLotoService: () => ({ sellTicket, settleCheckpoint, settleCheckpoints }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import lotoRoutes from "../loto.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/loto", lotoRoutes);
  return app;
}

describe("Loto REST — LIRA-258 keys are forwarded to the service", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    sellTicket.mockClear();
    settleCheckpoint.mockClear();
    settleCheckpoints.mockClear();
  });

  it("POST /sell forwards tender_exchange_rate and a GIFT_CARD leg's voucherCode", async () => {
    const res = await request(app)
      .post("/api/loto/sell")
      .set("x-test-role", "admin")
      .send({
        sale_amount: 500_000,
        payments: [
          { method: "GIFT_CARD", currencyCode: "LBP", amount: 300_000, voucherCode: "GC-1" },
          { method: "CASH", currencyCode: "USD", amount: 2 },
        ],
        tender_exchange_rate: 100_000,
      });

    expect(res.body.success).toBe(true);
    const arg = sellTicket.mock.calls[0][0] as Record<string, any>;
    expect(arg.tender_exchange_rate).toBe(100_000);
    expect(arg.payments[0].voucherCode).toBe("GC-1");
    expect(arg.userId).toBe(42);
  });

  it("POST /checkpoints/settle-batch forwards split payments + tender_exchange_rate", async () => {
    const payments = [
      { method: "CASH", currency_code: "USD", amount: -2 },
      { method: "CASH", currency_code: "LBP", amount: -13_100 },
    ];
    const res = await request(app)
      .post("/api/loto/checkpoints/settle-batch")
      .set("x-test-role", "admin")
      .send({
        checkpointIds: [5, 6],
        totalSales: 200_000,
        totalCommission: 8_900,
        payments,
        tender_exchange_rate: 89_000,
      });

    expect(res.body.success).toBe(true);
    const call = settleCheckpoints.mock.calls[0];
    expect(call[0]).toEqual([5, 6]);
    expect(call[4]).toBe(42);
    expect(call[5]).toEqual(payments);
    expect(call[6]).toBe(89_000);
  });

  it("POST /checkpoints/settle-batch still accepts the legacy single payment", async () => {
    const payment = { method: "CASH", drawer_name: "General", currency_code: "LBP", amount: -95_550 };
    const res = await request(app)
      .post("/api/loto/checkpoints/settle-batch")
      .set("x-test-role", "admin")
      .send({ checkpointIds: [5], totalSales: 100_000, totalCommission: 4_450, payment });

    expect(res.body.success).toBe(true);
    expect(settleCheckpoints.mock.calls[0][5]).toEqual(payment);
    expect(settleCheckpoints.mock.calls[0][6]).toBeUndefined();
  });

  it("POST /checkpoints/settle-batch refuses payment AND payments together", async () => {
    const res = await request(app)
      .post("/api/loto/checkpoints/settle-batch")
      .set("x-test-role", "admin")
      .send({
        checkpointIds: [5],
        totalSales: 100_000,
        totalCommission: 4_450,
        payment: { method: "CASH", drawer_name: "General", currency_code: "LBP", amount: -95_550 },
        payments: [{ method: "CASH", currency_code: "LBP", amount: -95_550 }],
      });

    expect(res.body.success).toBe(false);
    expect(settleCheckpoints).not.toHaveBeenCalled();
  });

  it("POST /checkpoints/:id/settle forwards tender_exchange_rate", async () => {
    const res = await request(app)
      .post("/api/loto/checkpoints/5/settle")
      .set("x-test-role", "admin")
      .send({
        totalSales: 100_000,
        totalCommission: 4_450,
        totalPrizes: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: -1 }],
        tender_exchange_rate: 95_550,
      });

    expect(res.body.success).toBe(true);
    const call = settleCheckpoint.mock.calls[0];
    expect(call[0]).toBe(5);
    expect(call[7]).toEqual([{ method: "CASH", currency_code: "USD", amount: -1 }]);
    expect(call[8]).toBe(95_550);
  });
});
