/**
 * OMTHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to FinancialService.
 */

import { ipcMain } from "electron";
import { registerOMTHandlers } from "../omtHandlers";
import { getFinancialService } from "../../services";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../services", () => ({
  getFinancialService: jest.fn(),
  resetFinancialService: jest.fn(),
}));

describe("OMTHandlers", () => {
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
      getHistory: jest
        .fn()
        .mockReturnValue([
          { id: 1, provider: "OMT", service_type: "SEND", commission_usd: 5 },
        ]),
      getAnalytics: jest.fn().mockReturnValue({
        today: { commissionUSD: 100, commissionLBP: 0, count: 10 },
        month: { commissionUSD: 2500, commissionLBP: 500000, count: 250 },
        byProvider: [],
      }),
    };
    (getFinancialService as jest.Mock).mockReturnValue(mockService);

    registerOMTHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all OMT handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "omt:add-transaction",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "omt:get-history",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "omt:get-analytics",
        expect.any(Function),
      );
    });
  });

  describe("omt:add-transaction", () => {
    it("should add an OMT transaction", async () => {
      const handler = handlers.get("omt:add-transaction")!;
      const transactionData = {
        provider: "OMT",
        serviceType: "SEND",
        amountUSD: 100,
        amountLBP: 0,
        commissionUSD: 5,
        commissionLBP: 0,
      };

      const result = await handler({}, transactionData);

      expect(mockService.addTransaction).toHaveBeenCalledWith(transactionData);
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should add a WHISH transaction", async () => {
      const handler = handlers.get("omt:add-transaction")!;
      const transactionData = {
        provider: "WHISH",
        serviceType: "RECEIVE",
        amountUSD: 50,
        amountLBP: 0,
        commissionUSD: 3,
        commissionLBP: 0,
      };

      const result = await handler({}, transactionData);

      expect(mockService.addTransaction).toHaveBeenCalledWith(transactionData);
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should handle service errors", async () => {
      mockService.addTransaction.mockReturnValue({
        success: false,
        error: "Transaction failed",
      });

      const handler = handlers.get("omt:add-transaction")!;
      const result = await handler({}, { provider: "OMT" });

      expect(result).toEqual({ success: false, error: "Transaction failed" });
    });
  });

  describe("omt:get-history", () => {
    it("should get all transaction history", async () => {
      const handler = handlers.get("omt:get-history")!;
      const result = await handler({}, undefined);

      expect(mockService.getHistory).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe("OMT");
    });

    it("should filter history by provider", async () => {
      const handler = handlers.get("omt:get-history")!;
      await handler({}, "WHISH");

      expect(mockService.getHistory).toHaveBeenCalledWith("WHISH");
    });
  });

  describe("omt:get-analytics", () => {
    it("should get analytics data", async () => {
      const handler = handlers.get("omt:get-analytics")!;
      const result = await handler({});

      expect(mockService.getAnalytics).toHaveBeenCalled();
      expect(result.today.commissionUSD).toBe(100);
      expect(result.month.count).toBe(250);
    });
  });
});
