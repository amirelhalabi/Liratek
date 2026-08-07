/**
 * Partners REST route tests — CQ-11 (part A): split-leg settlement.
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md, "Extension
 * (2026-07-18)". Scoped to POST /api/partners/settle's new optional
 * `payments[]` field — proving the REAL router + REAL partnerSettleSchema
 * (via validateRequest) accept/reject exactly what the schema-level tests in
 * packages/core assert, and that a valid payload's `payments` array survives
 * the REST round trip unchanged into the service call (rule 12/19b: nothing
 * strips the new field on the web transport).
 *
 * Pattern mirrors suppliers.api.test.ts / debts.api.test.ts: the REAL router
 * (../partners.js) with only ../../middleware/auth.js faked (header-driven
 * `x-test-role`); PartnerService is the REAL singleton with `settle` stubbed
 * via `jest.spyOn` so we can assert on the exact argument the route builds.
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
      userId: 42,
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
import { getPartnerService } from "@liratek/core";
import partnersRouter from "../partners.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/partners", partnersRouter);
  return app;
}

describe("Partners REST routes — CQ-11 split-leg settlement", () => {
  let app: Express;
  const partnerService = getPartnerService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("POST /api/partners/settle", () => {
    it("passes a well-formed payments[] array through to the service unchanged", async () => {
      const spy = jest.spyOn(partnerService, "settle").mockReturnValue({
        id: 1,
        partner_id: 1,
        transaction_type: "SETTLEMENT",
        reference_table: null,
        reference_id: null,
        amount: 100,
        currency: "USD",
        direction: "CREDIT",
        notes: null,
        user_id: 42,
        settlement_method: "CASH",
        created_at: "2026-07-18T00:00:00.000Z",
        fs_provider: null,
        fs_service_type: null,
        fs_amount: null,
        fs_currency: null,
        fs_fee: null,
        fs_customer: null,
        fs_reference_number: null,
        fs_phone_number: null,
      } as any);

      const res = await request(app)
        .post("/api/partners/settle")
        .set("x-test-role", "staff")
        .send({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "OMT", currency_code: "USD", amount: 40 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          userId: 42,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "OMT", currency_code: "USD", amount: 40 },
          ],
        }),
      );
    });

    it("rejects (never reaches the service) when legs don't sum to the settlement amount — rule 19c: 200 + string error", async () => {
      const spy = jest.spyOn(partnerService, "settle");

      const res = await request(app)
        .post("/api/partners/settle")
        .set("x-test-role", "staff")
        .send({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "OMT", currency_code: "USD", amount: 30 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects when a leg's currency_code differs from the settlement currency (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/partners/settle")
        .set("x-test-role", "staff")
        .send({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "OMT", currency_code: "LBP", amount: 40 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("rejects a CLIENT_ACCOUNT leg inside payments[] (rule 19c: 200 + string error)", async () => {
      const res = await request(app)
        .post("/api/partners/settle")
        .set("x-test-role", "staff")
        .send({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "CLIENT_ACCOUNT", currency_code: "USD", amount: 40 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe("string");
    });

    it("still accepts the legacy payload with no payments field (regression)", async () => {
      const spy = jest.spyOn(partnerService, "settle").mockReturnValue({
        id: 2,
        partner_id: 1,
        transaction_type: "SETTLEMENT",
        reference_table: null,
        reference_id: null,
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
        notes: null,
        user_id: 42,
        settlement_method: "CASH",
        created_at: "2026-07-18T00:00:00.000Z",
        fs_provider: null,
        fs_service_type: null,
        fs_amount: null,
        fs_currency: null,
        fs_fee: null,
        fs_customer: null,
        fs_reference_number: null,
        fs_phone_number: null,
      } as any);

      const res = await request(app)
        .post("/api/partners/settle")
        .set("x-test-role", "staff")
        .send({
          partnerId: 1,
          amount: 50,
          currency: "USD",
          settlementMethod: "CASH",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: 1,
          amount: 50,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 42,
        }),
      );
      const calledWith = spy.mock.calls[0][0] as { payments?: unknown };
      expect(calledWith.payments).toBeUndefined();
    });
  });
});
