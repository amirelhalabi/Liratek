/**
 * Refund kept change (owner decision 2026-10-07) — IPC parity:
 * `transactions:refund`'s fifth positional argument is validated with the
 * REAL core schema (`refundKeptChangeSchema`, shared with the REST route's
 * `keptChange` body key) and forwarded to the SAME service the REST route
 * uses, as `{ usd, lbp }` (same for `sales:refund`, the POS "Refund
 * Sale"). `transactions:refund-session-basket-item` takes
 * the schema's flat keys on its body and spreads them through.
 *
 * Field names come from the schema (rule 24): the fixtures are parsed
 * through it before being sent.
 *
 * Rule 17 disclosure: written AFTER the handler change, so NOT proven
 * failing-first. The repository-level guard
 * (packages/core TransactionRepository.refundKeptChange.test.ts) was.
 */

import { ipcMain } from "electron";
import { registerTransactionHandlers } from "../transactionHandlers";
import { registerSalesHandlers } from "../salesHandlers";
import {
  getTransactionService,
  refundKeptChangeSchema,
  sessionItemRefundSchema,
} from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getTransactionService: jest.fn(),
    getSalesService: jest.fn(() => ({})),
    getReportingService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("refund kept change — IPC forwarding", () => {
  const mockTxnService = {
    refundTransaction: jest.fn(),
    refundSessionBasketItem: jest.fn(),
    refundBySaleId: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getTransactionService as jest.Mock).mockReturnValue(mockTxnService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });
    registerTransactionHandlers();
    registerSalesHandlers();
  });

  const legs = [{ method: "CASH", currencyCode: "USD", amount: 20 }];

  it("transactions:refund forwards the 5th positional keptChange as { usd, lbp }", async () => {
    mockTxnService.refundTransaction.mockReturnValue(801);
    const kept = refundKeptChangeSchema.parse({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    });
    const result = await handlers.get("transactions:refund")!(
      { sender: { id: 1 } },
      42,
      legs,
      undefined,
      89000,
      kept,
    );
    expect(mockTxnService.refundTransaction).toHaveBeenCalledWith(42, 7, {
      refundLegs: legs,
      refundUnitExtras: undefined,
      exchangeRate: 89000,
      keptChange: { usd: 0.12, lbp: 0 },
    });
    expect(result).toEqual({ success: true, refundId: 801 });
  });

  it("transactions:refund without keptChange forwards keptChange undefined (unchanged call)", async () => {
    mockTxnService.refundTransaction.mockReturnValue(802);
    await handlers.get("transactions:refund")!({ sender: { id: 1 } }, 42, legs);
    expect(mockTxnService.refundTransaction).toHaveBeenCalledWith(42, 7, {
      refundLegs: legs,
      refundUnitExtras: undefined,
      exchangeRate: undefined,
      keptChange: undefined,
    });
  });

  it("transactions:refund rejects a negative kept amount BEFORE the service is called", async () => {
    const result = (await handlers.get("transactions:refund")!(
      { sender: { id: 1 } },
      42,
      legs,
      undefined,
      89000,
      { kept_change_usd: -0.12 },
    )) as { success: boolean };
    expect(result.success).toBe(false);
    expect(mockTxnService.refundTransaction).not.toHaveBeenCalled();
  });

  it("sales:refund (POS Refund Sale) forwards the 5th positional keptChange as { usd, lbp }", async () => {
    mockTxnService.refundBySaleId.mockReturnValue(803);
    const kept = refundKeptChangeSchema.parse({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    });
    const result = await handlers.get("sales:refund")!(
      { sender: { id: 1 } },
      9,
      legs,
      undefined,
      89000,
      kept,
    );
    expect(mockTxnService.refundBySaleId).toHaveBeenCalledWith(9, 7, {
      refundLegs: legs,
      refundUnitExtras: undefined,
      exchangeRate: 89000,
      keptChange: { usd: 0.12, lbp: 0 },
    });
    expect(result).toEqual({ success: true, refundId: 803 });
  });

  it("transactions:refund-session-basket-item spreads the schema's kept keys to the service", async () => {
    mockTxnService.refundSessionBasketItem.mockReturnValue({
      refundTransactionId: 900,
    });
    const body = sessionItemRefundSchema.parse({
      sessionId: 3,
      transactionId: 11,
      saleItemId: 5,
      quantity: 1,
      refundLegs: legs,
      kept_change_usd: 0.12,
    });
    await handlers.get("transactions:refund-session-basket-item")!(
      { sender: { id: 1 } },
      body,
    );
    expect(mockTxnService.refundSessionBasketItem).toHaveBeenCalledWith(
      expect.objectContaining({ kept_change_usd: 0.12, userId: 7 }),
    );
  });
});
