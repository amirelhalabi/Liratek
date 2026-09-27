/**
 * LIRA-231 — POS "Refund Sale"/"Refund item" REST parity: the operator's
 * chosen return-method override (`refundLegs`, LIRA-078 contract) is
 * forwarded to the SAME core service the Electron IPC handlers use
 * (`salesHandlers.ts`'s `sales:refund` / `sales:refund-item` /
 * `sales:refund-preview`), and a session-paid sale is refused with the
 * exact POS message — {success:false}, HTTP 200 (rule 19c envelope parity).
 *
 * Follows the harness in `../__tests__/salesDeleteDraft.api.test.ts` /
 * `../__tests__/auditRoleGate.api.test.ts`: hits the REAL router
 * (`../sales.js`) through a minimal Express app, faking only
 * `../../server.js` (logger), `../../middleware/audit.js` (`auditRest`) and
 * `../../middleware/auth.js` (an `x-test-role` stand-in for
 * `authenticateJWT`/`requireRole`). `SalesService`/`TransactionService` are
 * the REAL singletons with their methods stubbed via `jest.spyOn`, so this
 * proves the routes wire the exact role/payload/envelope contract without a
 * real DB round trip (no better-sqlite3 dependency — this file runs even
 * when the native module's ABI is mismatched for `packages/core` jest).
 *
 * Rule 17 (failing-first) — verified by temporarily reverting
 * `backend/src/api/sales.ts`'s `/:id/refund` and `/:id/refund-item` routes
 * to their pre-LIRA-231 shape (no `refundLegs` parsing, `txnService.
 * refundBySaleId(saleId, userId)` with no third argument): the
 * "forwards refundLegs" cases below failed because the spy's second call
 * argument was `undefined` instead of the override object. Restored and
 * re-run green before finalizing this file.
 *
 * 2026-09-26 addition — the two "forwards unitExtras" cases below (POS
 * "Returned phones" per-unit flagging, extending the SAME contract these
 * routes already validated `refundLegs` with) are labelled NOT PROVEN
 * FAILING-FIRST: the route change in `sales.ts` landed in the same pass as
 * these tests (unlike the `refundLegs` cases above, which predate this
 * addition and WERE re-verified red/green per the note above), so there was
 * no separately-committed "before" state to run them against without
 * reverting finished code, which CLAUDE.md's task instructions for this
 * change explicitly forbid. The repository-layer proof for the same
 * capability (`SalesRepository.refundUnitExtras.test.ts`) WAS run
 * failing-first in the normal way.
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

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
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
import { getSalesService, getTransactionService } from "@liratek/core";
import salesRouter from "../sales.js";

const SESSION_MESSAGE =
  "This sale was paid through a customer session — refund it from the session basket.";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

describe("LIRA-231: POS refund-leg-override REST parity", () => {
  let app: Express;
  const salesService = getSalesService();
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("POST /:id/refund forwards refundLegs to TransactionService.refundBySaleId", async () => {
    const refundSpy = jest
      .spyOn(txnService, "refundBySaleId")
      .mockReturnValue(501);

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send({
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 501 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
    });
  });

  it("POST /:id/refund with no body still works exactly as before (refundLegs undefined)", async () => {
    const refundSpy = jest
      .spyOn(txnService, "refundBySaleId")
      .mockReturnValue(502);

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 502 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, { refundLegs: undefined });
  });

  it("POST /:id/refund forwards unitExtras to TransactionService.refundBySaleId as refundUnitExtras (not proven failing-first)", async () => {
    const refundSpy = jest
      .spyOn(txnService, "refundBySaleId")
      .mockReturnValue(503);

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send({
        unitExtras: [{ unit_id: 9, is_defective: true }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 503 });
    expect(refundSpy).toHaveBeenCalledWith(7, 42, {
      refundLegs: undefined,
      refundUnitExtras: [{ unit_id: 9, is_defective: true }],
    });
  });

  it("POST /:id/refund: a session-linked sale is refused — {success:false}, HTTP 200, exact message", async () => {
    jest.spyOn(txnService, "refundBySaleId").mockImplementation(() => {
      throw new Error(SESSION_MESSAGE);
    });

    const res = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "admin")
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: SESSION_MESSAGE });
  });

  it("POST /:id/refund-item forwards refundLegs to SalesService.refundSaleItem", async () => {
    const refundSpy = jest
      .spyOn(salesService, "refundSaleItem")
      .mockReturnValue({ success: true, refundId: 601 });

    const res = await request(app)
      .post("/api/sales/7/refund-item")
      .set("x-test-role", "admin")
      .send({
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 601 });
    expect(refundSpy).toHaveBeenCalledWith({
      saleId: 7,
      saleItemId: 3,
      refundQuantity: 1,
      refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
      userId: 42,
    });
  });

  it("POST /:id/refund-item forwards unitExtras to SalesService.refundSaleItem (not proven failing-first)", async () => {
    const refundSpy = jest
      .spyOn(salesService, "refundSaleItem")
      .mockReturnValue({ success: true, refundId: 602 });

    const res = await request(app)
      .post("/api/sales/7/refund-item")
      .set("x-test-role", "admin")
      .send({
        saleItemId: 3,
        refundQuantity: 1,
        unitExtras: [{ unit_id: 9, warranty_override_until: "2027-01-01" }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refundId: 602 });
    expect(refundSpy).toHaveBeenCalledWith({
      saleId: 7,
      saleItemId: 3,
      refundQuantity: 1,
      refundLegs: undefined,
      unitExtras: [{ unit_id: 9, warranty_override_until: "2027-01-01" }],
      userId: 42,
    });
  });

  it("POST /:id/refund-item: a session-linked sale is refused — {success:false}, HTTP 200, exact message", async () => {
    jest.spyOn(salesService, "refundSaleItem").mockReturnValue({
      success: false,
      error: SESSION_MESSAGE,
    });

    const res = await request(app)
      .post("/api/sales/7/refund-item")
      .set("x-test-role", "admin")
      .send({ saleItemId: 3, refundQuantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: SESSION_MESSAGE });
  });

  it("GET /:id/refund-preview (whole sale) forwards to SalesService.getRefundPreview", async () => {
    const previewSpy = jest.spyOn(salesService, "getRefundPreview").mockReturnValue({
      success: true,
      legs: [
        {
          direction: "in",
          amount: 500,
          signed_amount: 500,
          currency_code: "USD",
          method: "CASH",
          drawer_name: "General",
        },
      ],
      sessionLinked: false,
    });

    const res = await request(app)
      .get("/api/sales/7/refund-preview")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionLinked).toBe(false);
    expect(previewSpy).toHaveBeenCalledWith(7, undefined);
  });

  it("GET /:id/refund-preview (item) forwards saleItemId/refundQuantity as `item`", async () => {
    const previewSpy = jest.spyOn(salesService, "getRefundPreview").mockReturnValue({
      success: true,
      legs: [],
      sessionLinked: true,
    });

    const res = await request(app)
      .get("/api/sales/7/refund-preview")
      .query({ saleItemId: "3", refundQuantity: "1" })
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, legs: [], sessionLinked: true });
    expect(previewSpy).toHaveBeenCalledWith(7, {
      saleItemId: 3,
      refundQuantity: 1,
    });
  });

  it("staff cannot reach any of the three refund routes (403), service never called", async () => {
    const refundSpy = jest.spyOn(txnService, "refundBySaleId");
    const refundItemSpy = jest.spyOn(salesService, "refundSaleItem");
    const previewSpy = jest.spyOn(salesService, "getRefundPreview");

    const refundRes = await request(app)
      .post("/api/sales/7/refund")
      .set("x-test-role", "staff")
      .send();
    const refundItemRes = await request(app)
      .post("/api/sales/7/refund-item")
      .set("x-test-role", "staff")
      .send({ saleItemId: 3, refundQuantity: 1 });
    const previewRes = await request(app)
      .get("/api/sales/7/refund-preview")
      .set("x-test-role", "staff");

    expect(refundRes.status).toBe(403);
    expect(refundItemRes.status).toBe(403);
    expect(previewRes.status).toBe(403);
    expect(refundSpy).not.toHaveBeenCalled();
    expect(refundItemSpy).not.toHaveBeenCalled();
    expect(previewSpy).not.toHaveBeenCalled();
  });
});
