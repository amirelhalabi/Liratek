/**
 * LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — two brand new IPC
 * channels, `transactions:refund-session-basket-item` and
 * `transactions:session-basket-item-refund-preview`, the item-level sibling
 * of `transactions:refund-session-basket` (LIRA-201c) immediately above them
 * in `transactionHandlers.ts`. Both channels don't exist before this change
 * (`handlers.get(...)` returns `undefined` and calling it throws), so this
 * whole file is a rule-17 failing-first proof by construction — run against
 * the pre-change handler file it fails at `handler is not a function`
 * (TypeError), and every assertion after that point is unreached.
 *
 * Mirrors `transactionHandlers.sessionBasketReversal.test.ts`'s mocking
 * shape (same file, same `registerTransactionHandlers`), with the real Zod
 * schema running (`jest.requireActual("@liratek/core")`), same as
 * `salesHandlers.refundLegOverride.test.ts` uses for its own schemas.
 */

import { ipcMain } from "electron";
import { registerTransactionHandlers } from "../transactionHandlers";
import { getTransactionService, getReportingService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getTransactionService: jest.fn(),
    getReportingService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("transactions:refund-session-basket-item / transactions:session-basket-item-refund-preview (LIRA-232 phase 2)", () => {
  const mockTxnService = {
    refundSessionBasketItem: jest.fn(),
    getSessionItemRefundPreview: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getTransactionService as jest.Mock).mockReturnValue(mockTxnService);
    (getReportingService as jest.Mock).mockReturnValue({});
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 3 });

    registerTransactionHandlers();
  });

  it("registers both channels", () => {
    expect(handlers.has("transactions:refund-session-basket-item")).toBe(
      true,
    );
    expect(
      handlers.has("transactions:session-basket-item-refund-preview"),
    ).toBe(true);
  });

  describe("transactions:refund-session-basket-item", () => {
    it("validates the payload, injects userId from the session (never the client), forwards to the service, and audits on success", async () => {
      mockTxnService.refundSessionBasketItem.mockReturnValue({
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmountUsd: 1500,
        itemAmountLbp: 0,
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderUsd: 0,
        remainderLbp: 0,
        legs: [],
      });
      const handler = handlers.get("transactions:refund-session-basket-item")!;

      const result = await handler(
        { sender: { id: 1 } },
        {
          sessionId: 7,
          transactionId: 42,
          saleItemId: 5,
          quantity: 1,
          // A client-supplied userId must never reach the service.
          userId: 999,
        },
      );

      expect(mockTxnService.refundSessionBasketItem).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 42,
        saleItemId: 5,
        quantity: 1,
        refundLegs: undefined,
        unitExtras: undefined,
        clientDay: undefined,
        userId: 3,
      });
      expect(result).toEqual({
        success: true,
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmountUsd: 1500,
        itemAmountLbp: 0,
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderUsd: 0,
        remainderLbp: 0,
        legs: [],
      });
      expect(audit).toHaveBeenCalled();
    });

    it("forwards an operator-chosen refundLegs override", async () => {
      mockTxnService.refundSessionBasketItem.mockReturnValue({
        refundTransactionId: 100,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmountUsd: 15,
        itemAmountLbp: 0,
        accountReductionUsd: 0,
        accountReductionLbp: 0,
        remainderUsd: 15,
        remainderLbp: 0,
        legs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
      });
      const handler = handlers.get("transactions:refund-session-basket-item")!;

      await handler(
        { sender: { id: 1 } },
        {
          sessionId: 7,
          transactionId: 42,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
        },
      );

      expect(mockTxnService.refundSessionBasketItem).toHaveBeenCalledWith(
        expect.objectContaining({
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
        }),
      );
    });

    it("rejects a malformed payload (missing transactionId) with the REAL schema, WITHOUT touching the service", async () => {
      const handler = handlers.get("transactions:refund-session-basket-item")!;

      const result = (await handler(
        { sender: { id: 1 } },
        { sessionId: 7 },
      )) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(mockTxnService.refundSessionBasketItem).not.toHaveBeenCalled();
    });

    it("rejects a non-positive quantity with the REAL schema, WITHOUT touching the service", async () => {
      const handler = handlers.get("transactions:refund-session-basket-item")!;

      const result = (await handler(
        { sender: { id: 1 } },
        { sessionId: 7, transactionId: 42, saleItemId: 5, quantity: 0 },
      )) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(mockTxnService.refundSessionBasketItem).not.toHaveBeenCalled();
    });

    it("enforces requireRole before touching the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Admin access required",
      });
      const handler = handlers.get("transactions:refund-session-basket-item")!;

      const result = await handler(
        { sender: { id: 1 } },
        { sessionId: 7, transactionId: 42 },
      );

      expect(result).toEqual({
        success: false,
        error: "Admin access required",
      });
      expect(mockTxnService.refundSessionBasketItem).not.toHaveBeenCalled();
    });

    it("surfaces a thrown business-rule error as { success: false } and does NOT audit", async () => {
      mockTxnService.refundSessionBasketItem.mockImplementation(() => {
        throw new Error("This basket was already whole-reversed.");
      });
      const handler = handlers.get("transactions:refund-session-basket-item")!;

      const result = await handler(
        { sender: { id: 1 } },
        { sessionId: 7, transactionId: 42 },
      );

      expect(result).toEqual({
        success: false,
        error: "This basket was already whole-reversed.",
      });
      expect(audit).not.toHaveBeenCalled();
    });
  });

  describe("transactions:session-basket-item-refund-preview", () => {
    it("validates the payload and forwards to the service, returning its envelope as-is", async () => {
      mockTxnService.getSessionItemRefundPreview.mockReturnValue({
        success: true,
        itemAmountUsd: 1500,
        itemAmountLbp: 0,
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderUsd: 0,
        remainderLbp: 0,
        defaultLegs: [],
      });
      const handler = handlers.get(
        "transactions:session-basket-item-refund-preview",
      )!;

      const result = await handler(
        { sender: { id: 1 } },
        { sessionId: 7, transactionId: 42, saleItemId: 5, quantity: 1 },
      );

      expect(mockTxnService.getSessionItemRefundPreview).toHaveBeenCalledWith(
        { sessionId: 7, transactionId: 42, saleItemId: 5, quantity: 1 },
      );
      expect(result).toEqual({
        success: true,
        itemAmountUsd: 1500,
        itemAmountLbp: 0,
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderUsd: 0,
        remainderLbp: 0,
        defaultLegs: [],
      });
    });

    it("rejects a malformed payload (missing transactionId) with the REAL schema, WITHOUT touching the service", async () => {
      const handler = handlers.get(
        "transactions:session-basket-item-refund-preview",
      )!;

      const result = (await handler(
        { sender: { id: 1 } },
        { sessionId: 7 },
      )) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(
        mockTxnService.getSessionItemRefundPreview,
      ).not.toHaveBeenCalled();
    });

    it("enforces requireRole before touching the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Admin access required",
      });
      const handler = handlers.get(
        "transactions:session-basket-item-refund-preview",
      )!;

      const result = await handler(
        { sender: { id: 1 } },
        { sessionId: 7, transactionId: 42 },
      );

      expect(result).toEqual({
        success: false,
        error: "Admin access required",
      });
      expect(
        mockTxnService.getSessionItemRefundPreview,
      ).not.toHaveBeenCalled();
    });
  });
});
