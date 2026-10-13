/**
 * LIRA-319 T055a (Maintenance) — `POST /api/maintenance/jobs` (web) carries
 * the extra charge the same way the desktop `maintenance:save` handler does:
 * both validate with core's `saveMaintenanceJobSchema` and call the same
 * `MaintenanceService.saveJob`.
 *
 * Without `extra_usd`/`extra_lbp` in the schema Zod strips them (rule 23) and
 * a web repair is booked at the labour price with the extra silently lost.
 * Refusals come back as HTTP 200 `{ success: false, error }` (rule 19c).
 * Fixtures are typed as the schema's input (rule 24).
 *
 * Rule 17: written after the schema change — NOT proven failing-first at the
 * route level. The failing-first evidence for the same keys is core's
 * `offline/__tests__/extraChargeReplayShape.test.ts` (extra_usd node was
 * undefined) and `repositories/__tests__/MaintenanceRepository.extraCharge.test.ts`.
 * The over-limit case mocks the service's refusal, so it proves only the
 * envelope passes through unchanged; the cap itself is owned by the core
 * test.
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
  MaintenanceService,
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  MAINTENANCE_EXTRA_CURRENCY_MESSAGE,
  type SaveMaintenanceJobPayload,
} from "@liratek/core";
import maintenanceRouter from "../api/maintenance.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", maintenanceRouter);
  return app;
}

const JOB: SaveMaintenanceJobPayload = {
  device_name: "Phone",
  currency: "USD",
  cost_usd: 8,
  price_usd: 20,
  final_amount_usd: 20,
  status: "Delivered_Paid",
  exchange_rate: 89_500,
  payments: [{ method: "CASH", currency_code: "USD", amount: 22 }],
  change_given_usd: 0,
  change_given_lbp: 0,
};

const LBP_JOB: SaveMaintenanceJobPayload = {
  device_name: "Tablet",
  currency: "LBP",
  cost_usd: 0,
  price_usd: 0,
  cost_lbp: 900_000,
  price_lbp: 1_800_000,
  final_amount_usd: 0,
  final_amount_lbp: 1_800_000,
  status: "Delivered_Paid",
  exchange_rate: 89_500,
  payments: [{ method: "CASH", currency_code: "LBP", amount: 1_900_000 }],
};

describe("POST /api/maintenance/jobs — LIRA-319 extra charge", () => {
  beforeEach(() => jest.restoreAllMocks());

  it.each([
    ["USD job", { ...JOB, extra_usd: 2 }, { extra_usd: 2 }],
    ["LBP job", { ...LBP_JOB, extra_lbp: 100_000 }, { extra_lbp: 100_000 }],
  ])("forwards the extra to the service (%s)", async (_n, body, expected) => {
    const spy = jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: true, id: 5 });
    const res = await request(buildApp())
      .post("/api/maintenance/jobs")
      .send(body)
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject(expected);
    // The acting user comes from the JWT, never the body.
    expect(spy.mock.calls[0]![1]).toBe(7);
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: true, id: 5 });
    await request(buildApp())
      .post("/api/maintenance/jobs")
      .send(JOB)
      .set("x-test-role", "staff");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it.each([
    [
      "discount + extra (USD job)",
      { ...JOB, discount_usd: 2, final_amount_usd: 18, extra_usd: 1 },
      DISCOUNT_AND_EXTRA_MESSAGE,
    ],
    [
      "discount + extra (LBP job, discount folded into final_amount_lbp)",
      { ...LBP_JOB, final_amount_lbp: 1_700_000, extra_lbp: 50_000 },
      DISCOUNT_AND_EXTRA_MESSAGE,
    ],
    [
      "an LBP extra on a USD job",
      { ...JOB, extra_lbp: 89_500 },
      MAINTENANCE_EXTRA_CURRENCY_MESSAGE,
    ],
  ])(
    "refuses %s with HTTP 200 { success: false } before the service runs",
    async (_name, body, message) => {
      const spy = jest.spyOn(MaintenanceService.prototype, "saveJob");
      const res = await request(buildApp())
        .post("/api/maintenance/jobs")
        .send(body)
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, error: message });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("an over-limit refusal from the service comes back as HTTP 200 { success: false }", async () => {
    jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: false, error: EXTRA_ABOVE_TOTAL_MESSAGE });
    const res = await request(buildApp())
      .post("/api/maintenance/jobs")
      .send({ ...JOB, extra_usd: 20.01 })
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: EXTRA_ABOVE_TOTAL_MESSAGE });
  });
});
