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
import { getFinancialService } from "@liratek/core";
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
