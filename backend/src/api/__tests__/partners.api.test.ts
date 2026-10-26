/**
 * Partners REST route tests — CQ-11 (part A): split-leg settlement.
 *
 * docs/plans/done_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md, "Extension
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

// LIRA-340 T004 — the Partners page asks for one display group at a time.
describe("GET /api/partners/:id/ledger — group filter", () => {
  const partnerService = getPartnerService();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it.each(["transactions", "payments"])(
    "passes group=%s through to the statement read",
    async (group) => {
      const spy = jest
        .spyOn(partnerService, "getPartnerStatement")
        .mockReturnValue({ entries: [] } as never);
      const res = await request(buildApp())
        .get(`/api/partners/7/ledger?group=${group}&startDate=2026-10-01`)
        .set("x-test-role", "staff");
      expect(res.body.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(7, {
        startDate: "2026-10-01",
        group,
      });
    },
  );

  it("ignores any other group value", async () => {
    const spy = jest
      .spyOn(partnerService, "getPartnerStatement")
      .mockReturnValue({ entries: [] } as never);
    await request(buildApp())
      .get("/api/partners/7/ledger?group=everything")
      .set("x-test-role", "staff");
    expect(spy).toHaveBeenCalledWith(7, undefined);
  });
});

/**
 * LIRA-346 — settle partners by day over REST: the three reads and the
 * settle-picked-days write. Same gates as the partner reads / `settle`, the
 * actor from the JWT (never the body), the IPC-identical envelope, and the
 * shared core schema (an invalid month / day / payload is refused).
 * Rule 17: written and run before the routes existed (failing first).
 */
describe("Partners REST routes — LIRA-346 settle by day", () => {
  const partnerService = getPartnerService();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("GET /:id/settle-open-rows returns the queue rows", async () => {
    const spy = jest
      .spyOn(partnerService, "getSettleOpenRows")
      .mockReturnValue([{ id: 3 }] as never);
    const res = await request(buildApp())
      .get("/api/partners/7/settle-open-rows")
      .set("x-test-role", "staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, rows: [{ id: 3 }] });
    expect(spy).toHaveBeenCalledWith(7);
  });

  it("GET /:id/settle-month-rows validates the month and passes it through", async () => {
    const spy = jest
      .spyOn(partnerService, "getSettleMonthRows")
      .mockReturnValue([] as never);
    const ok = await request(buildApp())
      .get("/api/partners/7/settle-month-rows?month=2026-10")
      .set("x-test-role", "staff");
    expect(ok.body).toEqual({ success: true, rows: [] });
    expect(spy).toHaveBeenCalledWith(7, "2026-10");
    const bad = await request(buildApp())
      .get("/api/partners/7/settle-month-rows?month=2026-13")
      .set("x-test-role", "staff");
    expect(bad.body.success).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("GET /:id/settle-day-detail validates the day and passes it through", async () => {
    const spy = jest
      .spyOn(partnerService, "getSettleDayDetail")
      .mockReturnValue([] as never);
    const ok = await request(buildApp())
      .get("/api/partners/7/settle-day-detail?day=2026-10-21")
      .set("x-test-role", "staff");
    expect(ok.body).toEqual({ success: true, rows: [] });
    expect(spy).toHaveBeenCalledWith(7, "2026-10-21");
    const bad = await request(buildApp())
      .get("/api/partners/7/settle-day-detail?day=21-10-2026")
      .set("x-test-role", "staff");
    expect(bad.body.success).toBe(false);
  });

  const body = {
    partnerId: 7,
    selections: [11, 12],
    include_account_credits: true,
    credit_used: { usd: 5 },
    expected_owed: { usd: 95, lbp: 0 },
    per_currency: {
      USD: {
        payer: "PARTNER",
        payments: [{ method: "CASH", currency_code: "USD", amount: 90 }],
      },
    },
  };

  it("POST /settle-days injects the actor from the JWT and returns the envelope", async () => {
    const spy = jest
      .spyOn(partnerService, "settleDays")
      .mockReturnValue({ success: true, id: 501 });
    const res = await request(buildApp())
      .post("/api/partners/settle-days")
      .set("x-test-role", "staff")
      .send({ ...body, userId: 999 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 501 });
    const arg = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.userId).toBe(42);
    expect(arg.selections).toEqual([11, 12]);
    expect(arg.credit_used).toEqual({ usd: 5 });
    expect((arg.per_currency as { USD: { payer: string } }).USD.payer).toBe("PARTNER");
  });

  it("POST /settle-days refuses a leg in the other currency (shared schema)", async () => {
    const spy = jest.spyOn(partnerService, "settleDays");
    const res = await request(buildApp())
      .post("/api/partners/settle-days")
      .set("x-test-role", "admin")
      .send({
        ...body,
        per_currency: {
          USD: {
            payer: "PARTNER",
            payments: [{ method: "CASH", currency_code: "LBP", amount: 90 }],
          },
        },
      });
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST /settle-days passes a service failure through as HTTP 200", async () => {
    jest
      .spyOn(partnerService, "settleDays")
      .mockReturnValue({ success: false, error: "balance changed" });
    const res = await request(buildApp())
      .post("/api/partners/settle-days")
      .set("x-test-role", "staff")
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "balance changed" });
  });
});
