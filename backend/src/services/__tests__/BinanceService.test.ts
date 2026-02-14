/**
 * BinanceService Unit Tests
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getBinanceRepository: jest.fn(),
  };
});

import {
  BinanceService,
  resetBinanceService,
  getBinanceRepository,
} from "@liratek/core";
import type {
  CreateBinanceTransactionData,
  BinanceTransactionEntity,
  BinanceTodayStats,
} from "@liratek/core";

describe("BinanceService", () => {
  let service: BinanceService;
  let mockRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetBinanceService();

    mockRepo = {
      createTransaction: jest.fn(),
      logActivity: jest.fn(),
      getHistory: jest.fn(),
      getTodayTransactions: jest.fn(),
      getTodayStats: jest.fn(),
    };

    (getBinanceRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new BinanceService(mockRepo);
  });

  // ===========================================================================
  // addTransaction Tests
  // ===========================================================================

  describe("addTransaction", () => {
    it("should add a SEND transaction successfully", () => {
      const data: CreateBinanceTransactionData = {
        type: "SEND",
        amount: 150,
        currencyCode: "USDT",
        description: "Payment to supplier",
        clientName: "Ahmad",
      };
      mockRepo.createTransaction.mockReturnValue({ id: 1 });

      const result = service.addTransaction(data);

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(data);
    });

    it("should add a RECEIVE transaction successfully", () => {
      const data: CreateBinanceTransactionData = {
        type: "RECEIVE",
        amount: 500,
        currencyCode: "USDT",
        description: "Client payment",
        clientName: "Omar",
      };
      mockRepo.createTransaction.mockReturnValue({ id: 2 });

      const result = service.addTransaction(data);

      expect(result).toEqual({ success: true, id: 2 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(data);
    });

    it("should handle transaction without optional fields", () => {
      const data: CreateBinanceTransactionData = {
        type: "SEND",
        amount: 100,
      };
      mockRepo.createTransaction.mockReturnValue({ id: 3 });

      const result = service.addTransaction(data);

      expect(result).toEqual({ success: true, id: 3 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
    });

    it("should return error when transaction fails", () => {
      const data: CreateBinanceTransactionData = {
        type: "SEND",
        amount: 100,
      };
      mockRepo.createTransaction.mockImplementation(() => {
        throw new Error("Database constraint violation");
      });

      const result = service.addTransaction(data);

      expect(result).toEqual({
        success: false,
        error: "Database constraint violation",
      });
    });
  });

  // ===========================================================================
  // getHistory Tests
  // ===========================================================================

  describe("getHistory", () => {
    const mockTransactions: BinanceTransactionEntity[] = [
      {
        id: 1,
        type: "SEND",
        amount: 150,
        currency_code: "USDT",
        description: "Payment to supplier",
        client_name: "Ahmad",
        created_at: "2026-02-13T10:00:00",
        created_by: 1,
      },
      {
        id: 2,
        type: "RECEIVE",
        amount: 500,
        currency_code: "USDT",
        description: "Client payment",
        client_name: "Omar",
        created_at: "2026-02-13T11:00:00",
        created_by: 1,
      },
    ];

    it("should return transaction history with default limit", () => {
      mockRepo.getHistory.mockReturnValue(mockTransactions);

      const result = service.getHistory();

      expect(result).toEqual(mockTransactions);
      expect(mockRepo.getHistory).toHaveBeenCalledWith(50);
    });

    it("should return transaction history with custom limit", () => {
      mockRepo.getHistory.mockReturnValue([mockTransactions[0]]);

      const result = service.getHistory(1);

      expect(result).toEqual([mockTransactions[0]]);
      expect(mockRepo.getHistory).toHaveBeenCalledWith(1);
    });

    it("should return empty array on error", () => {
      mockRepo.getHistory.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.getHistory();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // getTodayStats Tests
  // ===========================================================================

  describe("getTodayStats", () => {
    it("should return today stats", () => {
      const mockStats: BinanceTodayStats = {
        totalSent: 250,
        totalReceived: 500,
        count: 3,
      };
      mockRepo.getTodayStats.mockReturnValue(mockStats);

      const result = service.getTodayStats();

      expect(result).toEqual(mockStats);
      expect(mockRepo.getTodayStats).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getTodayTransactions Tests
  // ===========================================================================

  describe("getTodayTransactions", () => {
    it("should return today's transactions", () => {
      const mockTx: BinanceTransactionEntity[] = [
        {
          id: 5,
          type: "RECEIVE",
          amount: 300,
          currency_code: "USDT",
          description: "Office payment",
          client_name: null,
          created_at: "2026-02-13T14:00:00",
          created_by: 1,
        },
      ];
      mockRepo.getTodayTransactions.mockReturnValue(mockTx);

      const result = service.getTodayTransactions();

      expect(result).toEqual(mockTx);
      expect(mockRepo.getTodayTransactions).toHaveBeenCalled();
    });
  });
});
