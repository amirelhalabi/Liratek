/**
 * LIRA-319 T055a — `POST /api/loto/sell` (web) carries the extra charge the
 * same way the desktop `loto:sell` IPC handler does: both validate with
 * core's `lotoSellSchema` and call the same `LotoService.sellTicket`.
 *
 * Without `extra_lbp` in the schema Zod strips it (rule 23) and a web ticket
 * is booked at face value with the extra silently lost. Refusals come back
 * as HTTP 200 `{ success: false, error }` (rule 19c). Field names are the
 * schema's own (rule 24): the fixture is typed as its input.
 */
import { jest } from "@jest/globals";

jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
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
    req.user = {
      userId: 7,
      username: "t",
      role,
      tenantId: 1,
      sessionToken: "s",
    };
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
import {
  getLotoService,
  lotoSellSchema,
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  NO_EXTRA_FOR_PARTNER_MESSAGE,
  LOTO_EXTRA_LBP_ONLY_MESSAGE,
} from "@liratek/core";
import lotoRouter from "../api/loto.js";

type LotoPayload = z.input<typeof lotoSellSchema>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/loto", lotoRouter);
  return app;
}

const TICKET: LotoPayload = {
  sale_amount: 100_000,
  currency: "LBP",
  payments: [{ method: "CASH", currencyCode: "LBP", amount: 110_000 }],
};

describe("POST /api/loto/sell — LIRA-319 extra charge", () => {
  const service = getLotoService();
  beforeEach(() => jest.restoreAllMocks());

  it("forwards extra_lbp to the service", async () => {
    const spy = jest
      .spyOn(service, "sellTicket")
      .mockReturnValue({ id: 9 } as never);
    const body: LotoPayload = { ...TICKET, extra_lbp: 10_000 };
    const res = await request(buildApp())
      .post("/api/loto/sell")
      .send(body)
      .set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, ticket: { id: 9 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      extra_lbp: 10_000,
      userId: 7,
    });
  });

  it("no extra sent: no extra key invented (no default — offline replay)", async () => {
    const spy = jest
      .spyOn(service, "sellTicket")
      .mockReturnValue({ id: 9 } as never);
    await request(buildApp())
      .post("/api/loto/sell")
      .send({
        ...TICKET,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 100_000 }],
      })
      .set("x-test-role", "admin");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_usd");
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("extra_lbp");
  });

  it.each<[string, Partial<LotoPayload>, string]>([
    [
      "discount + extra",
      { extra_lbp: 10_000, discount_lbp: 1_000 },
      DISCOUNT_AND_EXTRA_MESSAGE,
    ],
    [
      "extra on a for-partner ticket",
      { extra_lbp: 10_000, partnerId: 3, partnerMode: "FOR", payments: [] },
      NO_EXTRA_FOR_PARTNER_MESSAGE,
    ],
    [
      "an extra above the ticket",
      { extra_lbp: 100_001 },
      EXTRA_ABOVE_TOTAL_MESSAGE,
    ],
    ["a USD extra", { extra_usd: 1 }, LOTO_EXTRA_LBP_ONLY_MESSAGE],
  ])(
    "refuses %s with HTTP 200 { success: false }",
    async (_name, patch, message) => {
      const spy = jest.spyOn(service, "sellTicket");
      const body: LotoPayload = { ...TICKET, ...patch };
      const res = await request(buildApp())
        .post("/api/loto/sell")
        .send(body)
        .set("x-test-role", "admin");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain(message);
      expect(spy).not.toHaveBeenCalled();
    },
  );
});
