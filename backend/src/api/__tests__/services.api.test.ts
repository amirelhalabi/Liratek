/**
 * Services REST route tests — COMMISSION_AT_SETTLEMENT_PLAN.md §1.7 / §4
 * Phase 1 rule-19 gap: `validators/financial.ts`'s `serviceType` enum was
 * `['SEND', 'RECEIVE']` — REST hard-rejected every BILL (iPick/Katsh), even
 * though the desktop electron-app LOCAL `FinancialServiceSchema` already
 * accepted it (`electron-app/schemas/index.ts:333`). Bills were
 * desktop-IPC-only on the write path. Fixed by adding 'BILL' to the SHARED
 * core schema `backend/src/api/services.ts` validates against directly.
 *
 * Rule 17 — observed failing pre-fix:
 *   FAIL "POST /api/services/transactions accepts a BILL serviceType
 *         (iPick/Katsh) — REST parity with the desktop IPC schema"
 *     expect(received).toBe(expected) // Object.is equality
 *     Expected: 200
 *     Received: 400
 *   (res.body: { success: false, error: "Invalid enum value. Expected
 *    'SEND' | 'RECEIVE', received 'BILL'" })
 * Reproduced by temporarily reverting `createFinancialServiceSchema`'s
 * `serviceType` enum to `['SEND', 'RECEIVE']` — re-ran this file, watched
 * the test above fail with exactly that 400, then restored 'BILL' and
 * re-ran green.
 *
 * Follows suppliers.api.test.ts's pattern: hits the REAL router (../services.js)
 * — real Zod schema via validateRequest — through a minimal Express app.
 * Only ../../server.js (logger) and ../../middleware/auth.js
 * (x-test-role header stand-in) are faked. FinancialService is the REAL
 * singleton with `addTransaction` stubbed via `jest.spyOn` — this proves the
 * route's validation layer accepts the BILL payload and forwards it to the
 * exact core service call, without needing a full repository/DB round trip.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

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
import { getFinancialService, getAuditService } from "@liratek/core";
import servicesRouter from "../services.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/services", servicesRouter);
  return app;
}

describe("Services REST routes — BILL serviceType (COMMISSION_AT_SETTLEMENT_PLAN.md Phase 1)", () => {
  let app: Express;
  const financialService = getFinancialService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("POST /api/services/transactions", () => {
    it("accepts a BILL serviceType (iPick/Katsh) — REST parity with the desktop IPC schema", async () => {
      const spy = jest
        .spyOn(financialService, "addTransaction")
        .mockReturnValue({ success: true, id: 99 });

      const res = await request(app)
        .post("/api/services/transactions")
        .set("x-test-role", "staff")
        .send({
          provider: "Katsh",
          serviceType: "BILL",
          amount: 20,
          cost: 20,
          price: 20,
          currency: "USD",
          commission: 0,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: 99 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ serviceType: "BILL", provider: "Katsh" }),
      );
    });

    it("still accepts SEND/RECEIVE (unchanged) — the enum widened, it didn't replace", async () => {
      jest
        .spyOn(financialService, "addTransaction")
        .mockReturnValue({ success: true, id: 1 });

      const res = await request(app)
        .post("/api/services/transactions")
        .set("x-test-role", "staff")
        .send({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("still rejects an invalid serviceType — HTTP 200 with success:false (rule 19c envelope)", async () => {
      const res = await request(app)
        .post("/api/services/transactions")
        .set("x-test-role", "staff")
        .send({
          provider: "OMT",
          serviceType: "BOGUS",
          amount: 100,
          currency: "USD",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
    });
  });
});

/**
 * Adversarial-review blocker fix (LIRA-104): POST /api/services/self-charge
 * called `auditRest(...)` UNCONDITIONALLY after
 * `financialService.selfChargeTelecomItem(...)`, on the (false) premise that
 * the service "throws on any business-rule failure ... reaching this line
 * means it committed." It doesn't — `FinancialService.selfChargeTelecomItem`
 * (packages/core/src/services/FinancialService.ts:410-434) catches the
 * repository's throw and returns `{ success: false, error }` instead of
 * rethrowing. The IPC twin (electron-app/handlers/omtHandlers.ts) calls the
 * REPOSITORY method directly (which really does throw), so this divergence
 * is REST-only.
 *
 * Rule 17 — first run (pre-fix) with only the audit-gate `if` removed from
 * services.ts, reproducing the unconditional call, failed exactly as
 * expected:
 *   FAIL "records ZERO audit entries when the service returns
 *         { success: false } (no throw)"
 *     expect(jest.fn()).not.toHaveBeenCalled()
 *     Expected number of calls: 0
 *     Received number of calls: 1
 *     1: {"action": "create", "entity_type": "financial_transaction",
 *         "metadata": {"carrierLineId": undefined, "mobileServiceItemId": 1},
 *         "summary": "Telecom self-charge: item #1 (primary)",
 *         "role": "staff", "user_id": 42, "username": "tester"}
 */
describe("POST /api/services/self-charge — audit gating (LIRA-104 blocker fix)", () => {
  let app: Express;
  const financialService = getFinancialService();
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  it("records ZERO audit entries when the service returns { success: false } (no throw)", async () => {
    jest.spyOn(financialService, "selfChargeTelecomItem").mockReturnValue({
      success: false,
      error: "Mobile service item #1 not found",
    });

    const res = await request(app)
      .post("/api/services/self-charge")
      .set("x-test-role", "staff")
      .send({ mobileServiceItemId: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("records exactly one audit entry on a real success", async () => {
    jest.spyOn(financialService, "selfChargeTelecomItem").mockReturnValue({
      success: true,
      data: {
        transactionId: 10,
        carrierLineId: 2,
        costLbp: 100000,
        creditsAdded: 5,
        validityDaysAdded: 30,
      },
    });

    const res = await request(app)
      .post("/api/services/self-charge")
      .set("x-test-role", "staff")
      .send({ mobileServiceItemId: 1, carrierLineId: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        entity_type: "financial_transaction",
        user_id: 42,
        username: "tester",
        role: "staff",
      }),
    );
  });
});
