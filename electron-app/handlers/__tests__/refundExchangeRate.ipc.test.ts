/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — IPC parity: `exchangeRate`
 * (the cashier-typed rate) is validated with the REAL core schema and
 * forwarded to the SAME service the REST routes use, on every refund
 * channel it was added to:
 *   - sales:refund (4th positional arg)         → TransactionService.refundBySaleId
 *   - sales:refund-item (exchangeRate on params) → SalesService.refundSaleItem
 *   - transactions:refund (4th positional arg)   → TransactionService.refundTransaction
 *   - transactions:get-refund-booked-rate        → TransactionService.getRefundBookedRate
 *
 * Harness copied from `salesHandlers.refundLegOverride.test.ts` /
 * `transactionHandlers.refundSessionBasketItem.test.ts` (rule 14): mocks
 * `electron`, `@liratek/core` (via `jest.requireActual` + override so real
 * Zod validation runs), `../session.js`, and `./auditHelper.js`.
 *
 * Rule 17 (failing-first) — before this ticket, `exchangeRate` was not a
 * key `SaleRefundSchema`/`RefundExchangeRateSchema` accepted at all
 * (`RefundExchangeRateSchema` did not exist), so `transactions:refund`
 * only ever destructured 3 positional args — a 4th `exchangeRate` argument
 * would have been silently ignored, and `sales:refund`'s schema would have
 * stripped an `exchangeRate` key from its 4th positional arg the SAME way
 * (Zod strips unknown keys, CLAUDE.md rule 23). Every assertion below that
 * checks `exchangeRate` reaches the service would have failed against that
 * pre-fix shape.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { registerTransactionHandlers } from "../transactionHandlers";
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

describe("LIRA-236: exchangeRate IPC forwarding", () => {
  const mockSalesService = {
    refundSaleItem: jest.fn(),
  };
  const mockTxnService = {
    refundBySaleId: jest.fn(),
    refundTransaction: jest.fn(),
    getRefundBookedRate: jest.fn(),
    getRecent: jest.fn(),
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
    registerTransactionHandlers();
  });

  it("sales:refund forwards exchangeRate (4th positional arg) to TransactionService.refundBySaleId", async () => {
    mockTxnService.refundBySaleId.mockReturnValue(501);
    const handler = handlers.get("sales:refund")!;

    const result = await handler(
      { sender: { id: 1 } },
      7,
      [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
      undefined,
      89000,
    );

    expect(mockTxnService.refundBySaleId).toHaveBeenCalledWith(7, 7, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
      refundUnitExtras: undefined,
      exchangeRate: 89000,
    });
    expect(result).toEqual({ success: true, refundId: 501 });
    expect(audit).toHaveBeenCalled();
  });

  it("sales:refund-item forwards exchangeRate to SalesService.refundSaleItem", async () => {
    mockSalesService.refundSaleItem.mockReturnValue({ success: true, refundId: 601 });
    const handler = handlers.get("sales:refund-item")!;

    const result = await handler(
      { sender: { id: 1 } },
      { saleId: 7, saleItemId: 3, refundQuantity: 1, exchangeRate: 89000 },
    );

    expect(mockSalesService.refundSaleItem).toHaveBeenCalledWith({
      saleId: 7,
      saleItemId: 3,
      refundQuantity: 1,
      refundLegs: undefined,
      unitExtras: undefined,
      exchangeRate: 89000,
      userId: 7,
    });
    expect(result).toEqual({ success: true, refundId: 601 });
  });

  it("transactions:refund forwards exchangeRate (4th positional arg) to TransactionService.refundTransaction", async () => {
    mockTxnService.refundTransaction.mockReturnValue(701);
    const handler = handlers.get("transactions:refund")!;

    const result = await handler(
      { sender: { id: 1 } },
      7,
      [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
      undefined,
      89000,
    );

    expect(mockTxnService.refundTransaction).toHaveBeenCalledWith(7, 7, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }],
      refundUnitExtras: undefined,
      exchangeRate: 89000,
    });
    expect(result).toEqual({ success: true, refundId: 701 });
  });

  it("transactions:refund omits exchangeRate cleanly (backward compatible, byte-identical to pre-LIRA-236)", async () => {
    mockTxnService.refundTransaction.mockReturnValue(702);
    const handler = handlers.get("transactions:refund")!;

    const result = await handler({ sender: { id: 1 } }, 7);

    expect(mockTxnService.refundTransaction).toHaveBeenCalledWith(7, 7, {
      refundLegs: undefined,
      refundUnitExtras: undefined,
      exchangeRate: undefined,
    });
    expect(result).toEqual({ success: true, refundId: 702 });
  });

  it("transactions:refund rejects a garbage exchangeRate before the service is called", async () => {
    const handler = handlers.get("transactions:refund")!;

    const result = await handler({ sender: { id: 1 } }, 7, undefined, undefined, -5);

    expect(mockTxnService.refundTransaction).not.toHaveBeenCalled();
    expect((result as { success: boolean }).success).toBe(false);
  });

  // F13 (round-3 review) — a `null` exchangeRate must count as absent on
  // BOTH transports. `transactions:refund` already guarded this manually
  // (`exchangeRate !== undefined && exchangeRate !== null` before ever
  // calling the schema); `sales:refund`/`sales:refund-item` instead embed
  // `exchangeRate` directly inside `SaleRefundSchema`/`SaleRefundItemSchema`
  // (`refundExchangeRateSchema`, shared with REST, rule 14) — before this
  // fix that field was `.optional()` only, which rejects a literal `null`
  // with a type error, unlike an omitted key.
  it("sales:refund treats a null exchangeRate as absent (F13, round-3 review)", async () => {
    mockTxnService.refundBySaleId.mockReturnValue(504);
    const handler = handlers.get("sales:refund")!;

    const result = await handler(
      { sender: { id: 1 } },
      7,
      undefined,
      undefined,
      null,
    );

    expect(mockTxnService.refundBySaleId).toHaveBeenCalledWith(7, 7, {
      refundLegs: undefined,
      refundUnitExtras: undefined,
      exchangeRate: undefined,
    });
    expect(result).toEqual({ success: true, refundId: 504 });
  });

  it("sales:refund-item treats a null exchangeRate as absent (F13, round-3 review)", async () => {
    mockSalesService.refundSaleItem.mockReturnValue({ success: true, refundId: 604 });
    const handler = handlers.get("sales:refund-item")!;

    const result = await handler(
      { sender: { id: 1 } },
      { saleId: 7, saleItemId: 3, refundQuantity: 1, exchangeRate: null },
    );

    expect(mockSalesService.refundSaleItem).toHaveBeenCalledWith({
      saleId: 7,
      saleItemId: 3,
      refundQuantity: 1,
      refundLegs: undefined,
      unitExtras: undefined,
      exchangeRate: undefined,
      userId: 7,
    });
    expect(result).toEqual({ success: true, refundId: 604 });
  });

  it("transactions:get-refund-booked-rate forwards id to TransactionService.getRefundBookedRate", async () => {
    mockTxnService.getRefundBookedRate.mockReturnValue({
      success: true,
      bookedRate: 90000,
      bookedRateSource: "sale",
    });
    const handler = handlers.get("transactions:get-refund-booked-rate")!;

    const result = await handler({ sender: { id: 1 } }, 7);

    expect(mockTxnService.getRefundBookedRate).toHaveBeenCalledWith(7);
    expect(result).toEqual({
      success: true,
      bookedRate: 90000,
      bookedRateSource: "sale",
    });
  });
});
