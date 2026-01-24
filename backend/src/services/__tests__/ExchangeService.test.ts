/**
 * ExchangeService Unit Tests
 */

import { jest } from '@jest/globals';
import {
  ExchangeService,
  getExchangeService,
  resetExchangeService,
} from "../ExchangeService";
import {
  ExchangeRepository,
  getExchangeRepository,
  type CreateExchangeData,
  type ExchangeTransactionEntity,
} from "../../database/repositories";

// Mock the repository module
jest.mock("../../database/repositories", () => ({
  getExchangeRepository: jest.fn(),
  ExchangeRepository: jest.fn(),
}));

describe("ExchangeService", () => {
  let service: ExchangeService;
  let mockRepo: jest.Mocked<ExchangeRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetExchangeService();

    // Create mock repository
    mockRepo = {
      createTransaction: jest.fn(),
      getHistory: jest.fn(),
      getTodayTransactions: jest.fn(),
      getTodayStats: jest.fn(),
      logActivity: jest.fn(),
    } as unknown as jest.Mocked<ExchangeRepository>;

    (getExchangeRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new ExchangeService(mockRepo);
  });

  // ===========================================================================
  // addTransaction Tests
  // ===========================================================================

  describe("addTransaction", () => {
    const mockExchangeData: CreateExchangeData = {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9000000,
      rate: 90000,
    };

    it("should add exchange transaction successfully", () => {
      mockRepo.createTransaction.mockReturnValue({ id: 1 });

      const result = service.addTransaction(mockExchangeData);

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(mockExchangeData);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(mockExchangeData);
    });

    it("should handle USD to LBP exchange", () => {
      const usdToLbp: CreateExchangeData = {
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 500,
        amountOut: 45000000,
        rate: 90000,
      };

      mockRepo.createTransaction.mockReturnValue({ id: 2 });

      const result = service.addTransaction(usdToLbp);

      expect(result).toEqual({ success: true, id: 2 });
    });

    it("should handle LBP to USD exchange", () => {
      const lbpToUsd: CreateExchangeData = {
        fromCurrency: "LBP",
        toCurrency: "USD",
        amountIn: 9000000,
        amountOut: 100,
        rate: 90000,
      };

      mockRepo.createTransaction.mockReturnValue({ id: 3 });

      const result = service.addTransaction(lbpToUsd);

      expect(result).toEqual({ success: true, id: 3 });
    });

    it("should handle EUR to USD exchange", () => {
      const eurToUsd: CreateExchangeData = {
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 100,
        amountOut: 108,
        rate: 1.08,
      };

      mockRepo.createTransaction.mockReturnValue({ id: 4 });

      const result = service.addTransaction(eurToUsd);

      expect(result).toEqual({ success: true, id: 4 });
    });

    it("should return error when createTransaction fails", () => {
      mockRepo.createTransaction.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.addTransaction(mockExchangeData);

      expect(result).toEqual({
        success: false,
        error: "Database error",
      });
    });

    it("should return error when logActivity fails", () => {
      mockRepo.createTransaction.mockReturnValue({ id: 1 });
      mockRepo.logActivity.mockImplementation(() => {
        throw new Error("Activity log failed");
      });

      const result = service.addTransaction(mockExchangeData);

      expect(result).toEqual({
        success: false,
        error: "Activity log failed",
      });
    });
  });

  // ===========================================================================
  // getHistory Tests
  // ===========================================================================

  describe("getHistory", () => {
    it("should return transaction history with default limit", () => {
      const mockHistory: ExchangeTransactionEntity[] = [
        {
          id: 1,
          type: "EXCHANGE",
          from_currency: "USD",
          to_currency: "LBP",
          amount_in: 100,
          amount_out: 9000000,
          rate: 90000,
          client_name: null,
          note: null,
          created_at: "2025-01-01",
          created_by: null,
        },
        {
          id: 2,
          type: "EXCHANGE",
          from_currency: "LBP",
          to_currency: "USD",
          amount_in: 4500000,
          amount_out: 50,
          rate: 90000,
          client_name: null,
          note: null,
          created_at: "2025-01-01",
          created_by: null,
        },
      ];
      mockRepo.getHistory.mockReturnValue(mockHistory);

      const result = service.getHistory();

      expect(result).toEqual(mockHistory);
      expect(mockRepo.getHistory).toHaveBeenCalledWith(50);
    });

    it("should return transaction history with custom limit", () => {
      const mockHistory: ExchangeTransactionEntity[] = [
        {
          id: 1,
          type: "EXCHANGE",
          from_currency: "USD",
          to_currency: "LBP",
          amount_in: 100,
          amount_out: 9000000,
          rate: 90000,
          client_name: null,
          note: null,
          created_at: "2025-01-01",
          created_by: null,
        },
      ];
      mockRepo.getHistory.mockReturnValue(mockHistory);

      const result = service.getHistory(10);

      expect(result).toEqual(mockHistory);
      expect(mockRepo.getHistory).toHaveBeenCalledWith(10);
    });

    it("should return empty array on error", () => {
      mockRepo.getHistory.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getHistory();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // getTodayTransactions Tests
  // ===========================================================================

  describe("getTodayTransactions", () => {
    it("should return today transactions", () => {
      const mockTransactions: ExchangeTransactionEntity[] = [
        {
          id: 1,
          type: "EXCHANGE",
          from_currency: "USD",
          to_currency: "LBP",
          amount_in: 200,
          amount_out: 18000000,
          rate: 90000,
          client_name: null,
          note: null,
          created_at: "2025-01-15",
          created_by: null,
        },
      ];
      mockRepo.getTodayTransactions.mockReturnValue(mockTransactions);

      const result = service.getTodayTransactions();

      expect(result).toEqual(mockTransactions);
      expect(mockRepo.getTodayTransactions).toHaveBeenCalled();
    });

    it("should return empty array when no transactions today", () => {
      mockRepo.getTodayTransactions.mockReturnValue([]);

      const result = service.getTodayTransactions();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // getTodayStats Tests
  // ===========================================================================

  describe("getTodayStats", () => {
    it("should return today stats", () => {
      const mockStats = {
        totalIn: 1000,
        totalOut: 500,
        count: 10,
      };
      mockRepo.getTodayStats.mockReturnValue(mockStats);

      const result = service.getTodayStats();

      expect(result).toEqual(mockStats);
      expect(mockRepo.getTodayStats).toHaveBeenCalled();
    });

    it("should return zeros when no transactions", () => {
      const mockStats = {
        totalIn: 0,
        totalOut: 0,
        count: 0,
      };
      mockRepo.getTodayStats.mockReturnValue(mockStats);

      const result = service.getTodayStats();

      expect(result).toEqual(mockStats);
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetExchangeService();
      const instance1 = getExchangeService();
      const instance2 = getExchangeService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getExchangeService();
      resetExchangeService();
      const instance2 = getExchangeService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
