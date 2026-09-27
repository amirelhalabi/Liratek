/**
 * LIRA-231 — POS "Refund Sale"/"Refund item"/refund-preview IPC channels
 * (`sales:refund`, `sales:refund-item`, `sales:refund-preview`,
 * `electron-app/handlers/salesHandlers.ts`): the operator's chosen
 * return-method override (`refundLegs`, LIRA-078 contract) is validated with
 * the REAL core schema (`saleRefundSchema`/`saleRefundItemSchema`/
 * `saleRefundPreviewSchema` — rule 14, same contract the REST routes use,
 * `@liratek/core` mocked via `jest.requireActual` + override so real Zod
 * parsing runs) and forwarded to `TransactionService.refundBySaleId` /
 * `SalesService.refundSaleItem` / `SalesService.getRefundPreview`.
 *
 * Same mocking shape as `databaseResetHandlers.roleGate.test.ts`:
 * `../session.js`'s `requireRole` and `./auditHelper.js`'s `audit` are
 * mocked directly so no real session/audit machinery runs.
 *
 * Rule 17 (failing-first) — verified by temporarily reverting
 * `sales:refund`'s handler body to call `txnService.refundBySaleId(saleId,
 * userId)` (no third argument, the pre-LIRA-231 shape): the "forwards
 * refundLegs" case failed (`toHaveBeenCalledWith` received only 2 args
 * instead of 3). Restored and re-run green before finalizing this file.
 *
 * 2026-09-26 addition — the two "forwards unitExtras" cases below (POS
 * "Returned phones" per-unit flagging) are labelled NOT PROVEN
 * FAILING-FIRST: the handler change in `salesHandlers.ts` landed in the same
 * pass as these tests, so there was no separately-committed "before" state
 * to run them against without reverting finished code, which CLAUDE.md's
 * task instructions for this change explicitly forbid. The repository-layer
 * proof for the same capability (`SalesRepository.refundUnitExtras.test.ts`)
 * WAS run failing-first in the normal way.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { getSalesService, getTransactionService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSalesService: jest.fn(),
    getTransactionService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

const SESSION_MESSAGE =
  "This sale was paid through a customer session — refund it from the session basket.";

describe("sales:refund / sales:refund-item / sales:refund-preview — LIRA-231 override forwarding", () => {
  const mockSalesService = {
    refundSaleItem: jest.fn(),
    getRefundPreview: jest.fn(),
  };
  const mockTxnService = {
    refundBySaleId: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getSalesService as jest.Mock).mockReturnValue(mockSalesService);
    (getTransactionService as jest.Mock).mockReturnValue(mockTxnService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerSalesHandlers();
  });

  const forbidden = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });

  describe("sales:refund", () => {
    it("forwards refundLegs to TransactionService.refundBySaleId", async () => {
      mockTxnService.refundBySaleId.mockReturnValue(501);
      const handler = handlers.get("sales:refund")!;

      const result = await handler({ sender: { id: 1 } }, 7, [
        { method: "OMT", currencyCode: "USD", amount: 500 },
      ]);

      expect(mockTxnService.refundBySaleId).toHaveBeenCalledWith(7, 7, {
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
      });
      expect(result).toEqual({ success: true, refundId: 501 });
      expect(audit).toHaveBeenCalled();
    });

    it("omitting refundLegs reproduces the default reversal (refundLegs undefined)", async () => {
      mockTxnService.refundBySaleId.mockReturnValue(502);
      const handler = handlers.get("sales:refund")!;

      const result = await handler({ sender: { id: 1 } }, 7, undefined);

      expect(mockTxnService.refundBySaleId).toHaveBeenCalledWith(7, 7, {
        refundLegs: undefined,
      });
      expect(result).toEqual({ success: true, refundId: 502 });
    });

    it("forwards unitExtras to TransactionService.refundBySaleId as refundUnitExtras (not proven failing-first)", async () => {
      mockTxnService.refundBySaleId.mockReturnValue(503);
      const handler = handlers.get("sales:refund")!;

      const result = await handler(
        { sender: { id: 1 } },
        7,
        undefined,
        [{ unit_id: 9, is_defective: true }],
      );

      expect(mockTxnService.refundBySaleId).toHaveBeenCalledWith(7, 7, {
        refundLegs: undefined,
        refundUnitExtras: [{ unit_id: 9, is_defective: true }],
      });
      expect(result).toEqual({ success: true, refundId: 503 });
    });

    it("a malformed refundLegs entry is rejected by the REAL schema BEFORE the service is called", async () => {
      const handler = handlers.get("sales:refund")!;

      const result = await handler({ sender: { id: 1 } }, 7, [
        { method: "OMT", currencyCode: "USD", amount: -5 },
      ]);

      expect(mockTxnService.refundBySaleId).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });

    it("a session-linked sale is refused — {success:false}, exact POS message", async () => {
      mockTxnService.refundBySaleId.mockImplementation(() => {
        throw new Error(SESSION_MESSAGE);
      });
      const handler = handlers.get("sales:refund")!;

      const result = await handler({ sender: { id: 1 } }, 7, undefined);

      expect(result).toEqual({ success: false, error: SESSION_MESSAGE });
    });

    it("refuses a non-admin caller WITHOUT reaching the service", async () => {
      forbidden();
      const handler = handlers.get("sales:refund")!;

      const result = await handler({ sender: { id: 1 } }, 7, undefined);

      expect(mockTxnService.refundBySaleId).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "Forbidden" });
    });
  });

  describe("sales:refund-item", () => {
    it("forwards refundLegs to SalesService.refundSaleItem", async () => {
      mockSalesService.refundSaleItem.mockReturnValue({
        success: true,
        refundId: 601,
      });
      const handler = handlers.get("sales:refund-item")!;

      const result = await handler(
        { sender: { id: 1 } },
        {
          saleId: 7,
          saleItemId: 3,
          refundQuantity: 1,
          refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
        },
      );

      expect(mockSalesService.refundSaleItem).toHaveBeenCalledWith({
        saleId: 7,
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 500 }],
        userId: 7,
      });
      expect(result).toEqual({ success: true, refundId: 601 });
    });

    it("forwards unitExtras to SalesService.refundSaleItem (not proven failing-first)", async () => {
      mockSalesService.refundSaleItem.mockReturnValue({
        success: true,
        refundId: 602,
      });
      const handler = handlers.get("sales:refund-item")!;

      const result = await handler(
        { sender: { id: 1 } },
        {
          saleId: 7,
          saleItemId: 3,
          refundQuantity: 1,
          unitExtras: [{ unit_id: 9, warranty_override_until: "2027-01-01" }],
        },
      );

      expect(mockSalesService.refundSaleItem).toHaveBeenCalledWith({
        saleId: 7,
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: undefined,
        unitExtras: [{ unit_id: 9, warranty_override_until: "2027-01-01" }],
        userId: 7,
      });
      expect(result).toEqual({ success: true, refundId: 602 });
    });

    it("a session-linked sale is refused — {success:false}, exact POS message, service still called (repository owns the guard)", async () => {
      mockSalesService.refundSaleItem.mockReturnValue({
        success: false,
        error: SESSION_MESSAGE,
      });
      const handler = handlers.get("sales:refund-item")!;

      const result = await handler(
        { sender: { id: 1 } },
        { saleId: 7, saleItemId: 3, refundQuantity: 1 },
      );

      expect(result).toEqual({ success: false, error: SESSION_MESSAGE });
    });
  });

  describe("sales:refund-preview", () => {
    it("forwards saleId/item to SalesService.getRefundPreview", async () => {
      mockSalesService.getRefundPreview.mockReturnValue({
        success: true,
        legs: [],
        sessionLinked: false,
      });
      const handler = handlers.get("sales:refund-preview")!;

      const result = await handler(
        { sender: { id: 1 } },
        { saleId: 7, item: { saleItemId: 3, refundQuantity: 1 } },
      );

      expect(mockSalesService.getRefundPreview).toHaveBeenCalledWith(7, {
        saleItemId: 3,
        refundQuantity: 1,
      });
      expect(result).toEqual({ success: true, legs: [], sessionLinked: false });
    });

    it("refuses a non-admin caller WITHOUT reaching the service", async () => {
      forbidden();
      const handler = handlers.get("sales:refund-preview")!;

      const result = await handler({ sender: { id: 1 } }, { saleId: 7 });

      expect(mockSalesService.getRefundPreview).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "Forbidden" });
    });
  });
});
