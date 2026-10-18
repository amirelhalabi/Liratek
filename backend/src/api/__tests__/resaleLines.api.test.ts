/**
 * Resale (for-sale) phone line REST routes — LIRA-309, HTTP twin of
 * electron-app/handlers/resaleLineHandlers.ts.
 *
 * Same pattern as productUnits.api.test.ts: the REAL router with only the
 * auth middleware faked (`x-test-role` header), the REAL service singleton
 * with its methods stubbed. Payload field names come from the core schema
 * (rule 24): the fixture is parsed through `saveResaleLineSchema` first.
 *
 * NOT proven failing-first (rule 17): the routes were written before this
 * file.
 */

import { jest } from "@jest/globals";

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 7,
      username: "tester",
      role,
      tenantId: 1,
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
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
  getResaleLineService,
  saveResaleLineSchema,
  writeOffResaleLineSchema,
  rechargeResaleLineSchema,
  giveBackResaleLineSchema,
} from "@liratek/core";
import resaleLinesRouter from "../resaleLines.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/resale-lines", resaleLinesRouter);
  return app;
}

const PAYLOAD = saveResaleLineSchema.parse({
  product_id: 5,
  carrier: "mtc",
  validity_expires_at: "2026-10-20",
  credits: 3,
});

describe("Resale line REST routes (LIRA-309)", () => {
  let app: Express;
  const service = getResaleLineService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("GET /api/resale-lines", () => {
    it("any signed-in user can list; include_sold is read as a boolean", async () => {
      const spy = jest.spyOn(service, "listLines").mockReturnValue([]);
      const res = await request(app)
        .get("/api/resale-lines?carrier=alfa&include_sold=true")
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
      expect(spy).toHaveBeenCalledWith({ carrier: "alfa", include_sold: true });
    });

    it("an unknown carrier is refused with HTTP 200 and an error string", async () => {
      const spy = jest.spyOn(service, "listLines");
      const res = await request(app)
        .get("/api/resale-lines?carrier=touch")
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/resale-lines/:productId", () => {
    it("admin saves — the validated payload reaches the service unchanged", async () => {
      const spy = jest
        .spyOn(service, "saveDetails")
        .mockReturnValue({ success: true, data: { id: 1 } as any });
      const res = await request(app)
        .put(`/api/resale-lines/${PAYLOAD.product_id}`)
        .set("x-test-role", "admin")
        .send(PAYLOAD);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(PAYLOAD);
    });

    it("a cashier (staff) is refused and never reaches the service", async () => {
      const spy = jest.spyOn(service, "saveDetails");
      const res = await request(app)
        .put(`/api/resale-lines/${PAYLOAD.product_id}`)
        .set("x-test-role", "staff")
        .send(PAYLOAD);
      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses when the path and body product ids differ", async () => {
      const spy = jest.spyOn(service, "saveDetails");
      const res = await request(app)
        .put(`/api/resale-lines/99`)
        .set("x-test-role", "admin")
        .send(PAYLOAD);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses an impossible date", async () => {
      const spy = jest.spyOn(service, "saveDetails");
      const res = await request(app)
        .put(`/api/resale-lines/${PAYLOAD.product_id}`)
        .set("x-test-role", "admin")
        .send({ ...PAYLOAD, validity_expires_at: "2026-02-30" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/resale-lines/:productId/write-off", () => {
    const WRITE_OFF = writeOffResaleLineSchema.parse({
      product_id: 5,
      note: "number burned",
      client_day: "2026-10-12",
    });

    it("admin writes off — validated payload + the JWT user reach the service", async () => {
      const spy = jest
        .spyOn(service, "writeOff")
        .mockReturnValue({ success: true, data: { expense_id: 55 } });
      const res = await request(app)
        .post(`/api/resale-lines/5/write-off`)
        .set("x-test-role", "admin")
        .send({ ...WRITE_OFF, userId: 999 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { expense_id: 55 } });
      // The actor is the JWT's user (7), never a body field.
      expect(spy).toHaveBeenCalledWith(WRITE_OFF, 7);
    });

    it("a cashier (staff) is refused and never reaches the service", async () => {
      const spy = jest.spyOn(service, "writeOff");
      const res = await request(app)
        .post(`/api/resale-lines/5/write-off`)
        .set("x-test-role", "staff")
        .send(WRITE_OFF);
      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/resale-lines/:productId/recharge", () => {
    const RECHARGE = rechargeResaleLineSchema.parse({
      product_id: 5,
      source: "DAYS",
      days: 30,
      days_cost_usd: 3,
      exchange_rate: 89000,
      client_day: "2026-10-13",
    });

    it("a cashier (staff) can recharge — payload + JWT user reach the service", async () => {
      const spy = jest.spyOn(service, "recharge").mockReturnValue({
        success: true,
        data: {
          transaction_id: 1,
          recharge_id: 1,
          cost_usd: 3,
          line: { cost_usd: 18, price_usd: 28, validity_expires_at: "2026-11-14", credits: 0 },
        },
      });
      const res = await request(app)
        .post(`/api/resale-lines/5/recharge`)
        .set("x-test-role", "staff")
        .send({ ...RECHARGE, userId: 999 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(RECHARGE, 7);
    });

    it("DAYS without a cost is refused with 200 and never reaches the service", async () => {
      const spy = jest.spyOn(service, "recharge");
      const res = await request(app)
        .post(`/api/resale-lines/5/recharge`)
        .set("x-test-role", "staff")
        .send({ product_id: 5, source: "DAYS", days: 30 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // LIRA-337 — NOT proven failing-first (rule 17): the route was written
  // before these tests.
  describe("POST /api/resale-lines/:productId/give-back", () => {
    const GIVE_BACK = giveBackResaleLineSchema.parse({
      product_id: 5,
      credits_kept: 9,
      credit_sell_price_lbp: 100000,
      exchange_rate: 89500,
      client_day: "2026-10-18",
    });

    it("a cashier (staff) can give credit back — payload + JWT user reach the service", async () => {
      const spy = jest.spyOn(service, "giveBack").mockReturnValue({
        success: true,
        data: {
          transaction_id: 1,
          give_back_id: 1,
          credits_sent: 5.68,
          sms_fee_usd: 0.32,
          price_drop_usd: 6.7,
          cost_drop_usd: 5.68,
          line: { credits: 9, price_usd: 18.3, cost_usd: 14.32 },
        },
      });
      const res = await request(app)
        .post(`/api/resale-lines/5/give-back`)
        .set("x-test-role", "staff")
        .send({ ...GIVE_BACK, userId: 999 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(GIVE_BACK, 7);
    });

    it("a missing credit price is refused with 200 and never reaches the service", async () => {
      const spy = jest.spyOn(service, "giveBack");
      const res = await request(app)
        .post(`/api/resale-lines/5/give-back`)
        .set("x-test-role", "staff")
        .send({ product_id: 5, credits_kept: 9 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses when the path and body product ids differ", async () => {
      const spy = jest.spyOn(service, "giveBack");
      const res = await request(app)
        .post(`/api/resale-lines/6/give-back`)
        .set("x-test-role", "staff")
        .send(GIVE_BACK);
      expect(res.body).toEqual({
        success: false,
        error: "Product id in the path and body do not match.",
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
