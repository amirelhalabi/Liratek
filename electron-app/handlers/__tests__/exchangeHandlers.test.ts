/**
 * ExchangeHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to ExchangeService.
 *
 * Revived 2026-09-13: four things had drifted since this suite was written —
 * (1) `exchange:add-transaction` gained a `requireRole(event.sender.id, …)`
 *     gate that reads `event.sender.id`, while these tests still invoked
 *     handlers with a bare `{}` event, throwing `TypeError: Cannot read
 *     properties of undefined (reading 'id')`.
 * (2) `getExchangeService` is imported from "@liratek/core" (not a local
 *     "../../services" module — that mock target no longer matches
 *     anything exchangeHandlers.ts imports, so every test that got past the
 *     auth check was hitting the REAL ExchangeService against no DB —
 *     visible in the logs as "Failed to get exchange history" — and the
 *     mock's `getHistory`/`addTransaction` jest.fn()s were simply never
 *     called).
 * (3) unlike most handler files (which re-fetch the service fresh inside
 *     `register*Handlers()` on every call), exchangeHandlers.ts resolves
 *     the service through a MODULE-SCOPE singleton
 *     (`getExchangeServiceInstance()` caches into a private
 *     `_exchangeService`, set once and reused for the module's lifetime).
 *     With `registerExchangeHandlers` imported statically once at the top
 *     of this file, every test after the first would have shared the ONE
 *     cached instance from whichever test happened to trigger it first.
 *     This suite now resets the module registry per test
 *     (`jest.resetModules()`) and re-`require`s both "@liratek/core" and
 *     "../exchangeHandlers" inside `beforeEach`, so each test gets its own
 *     fresh singleton instead of a stale one leaked from a prior test.
 * (4) the service method the handler actually calls is
 *     `addDirectTransaction`, not `addTransaction`, and the payload shape is
 *     the real, shared `ExchangeTransactionSchema`
 *     (fromCurrency/toCurrency/amountIn/amountOut/leg1Rate/leg1MarketRate/
 *     leg1ProfitUsd/totalProfitUsd — packages/core/src/validators/
 *     exchange.ts), not the old from_currency/to_currency/from_amount/rate
 *     fields this suite used to send (which would now fail validation
 *     before ever reaching the service).
 */

jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getExchangeService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("ExchangeHandlers", () => {
  let mockService: any;
  let handlers: Map<string, Function>;
  let ipcMain: { handle: jest.Mock };
  let requireRole: jest.Mock;
  let registerExchangeHandlers: () => void;

  // Real ExchangeTransactionSchema shape (see header note (4)) — a minimal
  // direct USD->LBP exchange, no viaCurrency/payments/partner fields.
  const validTransactionData = {
    fromCurrency: "USD",
    toCurrency: "LBP",
    amountIn: 100,
    amountOut: 9000000,
    leg1Rate: 90000,
    leg1MarketRate: 90000,
    leg1ProfitUsd: 0,
    totalProfitUsd: 0,
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handlers = new Map();

    ({ ipcMain } = require("electron"));
    ({ requireRole } = require("../../session"));

    (ipcMain.handle as jest.Mock).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    );

    // Mock service
    mockService = {
      addDirectTransaction: jest.fn().mockReturnValue({ success: true, id: 1 }),
      getHistory: jest
        .fn()
        .mockReturnValue([
          { id: 1, from_currency: "USD", to_currency: "LBP", from_amount: 100 },
        ]),
    };
    const core = require("@liratek/core");
    (core.getExchangeService as jest.Mock).mockReturnValue(mockService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    ({ registerExchangeHandlers } = require("../exchangeHandlers"));
    registerExchangeHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all exchange handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "exchange:add-transaction",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "exchange:get-history",
        expect.any(Function),
      );
    });
  });

  describe("exchange:add-transaction", () => {
    it("should add an exchange transaction", async () => {
      const handler = handlers.get("exchange:add-transaction")!;

      const result = await handler({ sender: { id: 1 } }, validTransactionData);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
      expect(mockService.addDirectTransaction).toHaveBeenCalledWith(
        validTransactionData,
      );
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should handle service errors", async () => {
      mockService.addDirectTransaction.mockReturnValue({
        success: false,
        error: "Insufficient funds",
      });

      const handler = handlers.get("exchange:add-transaction")!;
      const result = await handler({ sender: { id: 1 } }, validTransactionData);

      expect(result).toEqual({ success: false, error: "Insufficient funds" });
    });
  });

  describe("exchange:get-history", () => {
    it("should get exchange history", async () => {
      // exchange:get-history never reads `event`.
      const handler = handlers.get("exchange:get-history")!;
      const result = await handler({});

      expect(mockService.getHistory).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].from_currency).toBe("USD");
    });

    it("should return empty array when no history", async () => {
      mockService.getHistory.mockReturnValue([]);

      const handler = handlers.get("exchange:get-history")!;
      const result = await handler({});

      expect(result).toEqual([]);
    });
  });
});
