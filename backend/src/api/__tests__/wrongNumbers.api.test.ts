/**
 * Wrong-number card REST routes — LIRA-312, HTTP twin of
 * electron-app/handlers/wrongNumberHandlers.ts.
 *
 * Same pattern as resaleLines.api.test.ts: the REAL router with only the
 * auth middleware faked (`x-test-role` header), the REAL service singleton
 * with its methods stubbed. Payload field names come from the core schemas
 * (rule 24).
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
  getWrongNumberService,
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
} from "@liratek/core";
import wrongNumbersRouter from "../wrongNumbers.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/wrong-numbers", wrongNumbersRouter);
  return app;
}

const RECORD = recordWrongNumberSchema.parse({
  provider: "iPick",
  mobile_service_item_id: 3,
  wrong_number: "03111111",
  right_number: "03222333",
  sale_transaction_id: 40,
  expense_date: "2026-10-14",
});

const CREDITS = wrongNumberCreditsSchema.parse({
  wrong_number_card_id: 5,
  amount_usd: 6.68,
  carrier_line_id: 2,
  client_day: "2026-10-14",
});

describe("Wrong-number REST routes (LIRA-312)", () => {
  let app: Express;
  const service = getWrongNumberService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("GET /api/wrong-numbers", () => {
    it("any signed-in user can list; ids arrive as numbers", async () => {
      const spy = jest.spyOn(service, "list").mockReturnValue([]);
      const res = await request(app)
        .get("/api/wrong-numbers?sale_transaction_id=40")
        .set("x-test-role", "staff");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
      expect(spy).toHaveBeenCalledWith({ sale_transaction_id: 40 });
    });
  });

  describe("POST /api/wrong-numbers", () => {
    it.each(["admin", "staff"])("%s records — payload + the JWT user reach the service", async (role) => {
      const spy = jest.spyOn(service, "recordWrongNumber").mockReturnValue({
        success: true,
        data: { id: 5, expense_transaction_id: 9, status: "WAITING", remaining_loss_lbp: 770000 },
      });
      const res = await request(app)
        .post("/api/wrong-numbers")
        .set("x-test-role", role)
        .send({ ...RECORD, userId: 999 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // The actor is the JWT's user (7), never a body field.
      expect(spy).toHaveBeenCalledWith(RECORD, 7);
    });

    it("a refusal comes back with HTTP 200 and the error", async () => {
      jest.spyOn(service, "recordWrongNumber").mockReturnValue({
        success: false,
        error: "The right number is the same as the wrong one.",
      });
      const res = await request(app)
        .post("/api/wrong-numbers")
        .set("x-test-role", "staff")
        .send(RECORD);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "The right number is the same as the wrong one.",
      });
    });

    it("a saved sale without the right number never reaches the service", async () => {
      const spy = jest.spyOn(service, "recordWrongNumber");
      const { right_number: _omit, ...body } = RECORD;
      const res = await request(app)
        .post("/api/wrong-numbers")
        .set("x-test-role", "staff")
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("an unknown role is refused", async () => {
      const spy = jest.spyOn(service, "recordWrongNumber");
      const res = await request(app)
        .post("/api/wrong-numbers")
        .set("x-test-role", "viewer")
        .send(RECORD);
      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/wrong-numbers/:id/credits", () => {
    it("staff enters credits — payload + the JWT user reach the service", async () => {
      const spy = jest.spyOn(service, "recordCreditsReceived").mockReturnValue({
        success: true,
        data: { transaction_id: 11, total_recovered_usd: 6.68, remaining_loss_lbp: 102000, status: "PARTLY_RECOVERED" },
      });
      const res = await request(app)
        .post(`/api/wrong-numbers/${CREDITS.wrong_number_card_id}/credits`)
        .set("x-test-role", "staff")
        .send(CREDITS);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(CREDITS, 7);
    });

    it("refuses when the path and body record ids differ", async () => {
      const spy = jest.spyOn(service, "recordCreditsReceived");
      const res = await request(app)
        .post("/api/wrong-numbers/99/credits")
        .set("x-test-role", "staff")
        .send(CREDITS);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
