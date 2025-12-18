/**
 * ExchangeHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to ExchangeService.
 */

import { ipcMain } from "electron";
import { registerExchangeHandlers } from "../exchangeHandlers";
import { getExchangeService } from "../../services";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../services", () => ({
  getExchangeService: jest.fn(),
  resetExchangeService: jest.fn(),
}));

describe("ExchangeHandlers", () => {
  let mockService: any;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Mock service
    mockService = {
      addTransaction: jest.fn().mockReturnValue({ success: true, id: 1 }),
      getHistory: jest.fn().mockReturnValue([
        { id: 1, from_currency: "USD", to_currency: "LBP", from_amount: 100 },
      ]),
    };
    (getExchangeService as jest.Mock).mockReturnValue(mockService);

    registerExchangeHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all exchange handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith("exchange:add-transaction", expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith("exchange:get-history", expect.any(Function));
    });
  });

  describe("exchange:add-transaction", () => {
    it("should add an exchange transaction", async () => {
      const handler = handlers.get("exchange:add-transaction")!;
      const transactionData = {
        from_currency: "USD",
        to_currency: "LBP",
        from_amount: 100,
        to_amount: 9000000,
        rate: 90000,
      };

      const result = await handler({}, transactionData);

      expect(mockService.addTransaction).toHaveBeenCalledWith(transactionData);
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should handle service errors", async () => {
      mockService.addTransaction.mockReturnValue({ success: false, error: "Insufficient funds" });

      const handler = handlers.get("exchange:add-transaction")!;
      const result = await handler({}, { from_currency: "USD" });

      expect(result).toEqual({ success: false, error: "Insufficient funds" });
    });
  });

  describe("exchange:get-history", () => {
    it("should get exchange history", async () => {
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
