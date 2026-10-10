/**
 * LIRA-298 — `sales:process` (desktop) forwards the cashier's backdated
 * `transaction_time` to `SalesService.processSale`. The handler validates
 * with `SaleProcessSchema` (core's `saleProcessSchema`, re-exported in
 * electron-app/schemas/index.ts); while that schema had no
 * `transaction_time` key Zod stripped it (rule 23) and every backdated
 * desktop sale was booked at "now". `deferPayment` stays server-only
 * (session basket) and must never be forwarded from the renderer.
 *
 * Same mocking shape as `salesHandlers.updateMetadataValidation.test.ts`:
 * the real schema runs (jest.requireActual), only the service is mocked.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { getSalesService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSalesService: jest.fn(),
    getTransactionService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

const SALE = {
  client_id: null,
  items: [{ product_id: 1, quantity: 1, price: 10 }],
  total_amount: 10,
  discount: 0,
  final_amount: 10,
  payment_usd: 10,
  payment_lbp: 0,
  exchange_rate: 89500,
  status: "completed",
};

describe("sales:process — LIRA-298 backdating", () => {
  const mockService = { processSale: jest.fn() };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getSalesService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });
    mockService.processSale.mockReturnValue({ success: true, id: 5 });
    registerSalesHandlers();
  });

  it("forwards transaction_time to the service", async () => {
    const handler = handlers.get("sales:process")!;
    const result = await handler(
      { sender: { id: 1 } },
      { ...SALE, transaction_time: "2026-10-05T09:00:00.000Z" },
    );
    expect(result).toEqual({ success: true, id: 5 });
    expect(mockService.processSale).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_time: "2026-10-05T09:00:00.000Z",
      }),
      7,
    );
  });

  it("does not forward a renderer-sent deferPayment", async () => {
    const handler = handlers.get("sales:process")!;
    await handler({ sender: { id: 1 } }, { ...SALE, deferPayment: true });
    expect(mockService.processSale.mock.calls[0][0]).not.toHaveProperty(
      "deferPayment",
    );
  });
});
