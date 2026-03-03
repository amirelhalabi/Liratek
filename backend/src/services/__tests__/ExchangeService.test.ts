/**
 * ExchangeService Unit Tests
 */

import { jest } from "@jest/globals";

// Mock rate repository that ExchangeService will use internally
const mockRateRepo = {
  findAllAsCurrencyRates: jest.fn().mockReturnValue([
    { to_code: "LBP", market_rate: 90000, delta: 500, is_stronger: 1 },
    { to_code: "EUR", market_rate: 1.08, delta: 0.02, is_stronger: -1 },
  ]),
};

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getExchangeRepository: jest.fn(),
    ExchangeRepository: jest.fn(),
    getRateRepository: jest.fn(() => mockRateRepo),
  };
});

// Mock the internal repositories module used by ExchangeService's relative imports
jest.mock("../../../../packages/core/src/repositories/index", () => {
  const actual = jest.requireActual<any>(
    "../../../../packages/core/src/repositories/index",
  );
  return {
    ...actual,
    getRateRepository: jest.fn(() => mockRateRepo),
  };
});

import {
  ExchangeService,
  getExchangeService,
  resetExchangeService,
  ExchangeRepository,
  getExchangeRepository,
  type ExchangeTransactionEntity,
} from "@liratek/core";

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
    } as unknown as jest.Mocked<ExchangeRepository>;

    (getExchangeRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new ExchangeService(mockRepo);
  });

  // ===========================================================================
  // addTransaction Tests
  // ===========================================================================

  describe("addTransaction", () => {
    const mockInput = {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
    };

    it("should add exchange transaction successfully", () => {
      mockRepo.createTransaction.mockReturnValue({ id: 1 });

      const result = service.addTransaction(mockInput);

      expect(result.success).toBe(true);
      expect(result.id).toBe(1);
      expect(mockRepo.createTransaction).toHaveBeenCalled();
    });

    it("should handle USD to LBP exchange", () => {
      const usdToLbp = {
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 500,
      };

      mockRepo.createTransaction.mockReturnValue({ id: 2 });

      const result = service.addTransaction(usdToLbp);

      expect(result).toEqual({ success: true, id: 2 });
    });

    it("should handle LBP to USD exchange", () => {
      const lbpToUsd = {
        fromCurrency: "LBP",
        toCurrency: "USD",
        amountIn: 9000000,
      };

      mockRepo.createTransaction.mockReturnValue({ id: 3 });

      const result = service.addTransaction(lbpToUsd);

      expect(result).toEqual({ success: true, id: 3 });
    });

    it("should handle EUR to USD exchange", () => {
      const eurToUsd = {
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 100,
      };

      mockRepo.createTransaction.mockReturnValue({ id: 4 });

      const result = service.addTransaction(eurToUsd);

      expect(result).toEqual({ success: true, id: 4 });
    });

    it("should return error when createTransaction fails", () => {
      mockRepo.createTransaction.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.addTransaction(mockInput);

      expect(result).toEqual({
        success: false,
        error: "Database error",
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
          base_rate: 90000,
          profit_usd: 0.56,
          leg1_rate: 90000,
          leg1_market_rate: 90000,
          leg1_profit_usd: 0.56,
          leg2_rate: null,
          leg2_market_rate: null,
          leg2_profit_usd: null,
          via_currency: null,
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
          base_rate: 90000,
          profit_usd: 0.28,
          leg1_rate: 90000,
          leg1_market_rate: 90000,
          leg1_profit_usd: 0.28,
          leg2_rate: null,
          leg2_market_rate: null,
          leg2_profit_usd: null,
          via_currency: null,
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
          base_rate: 90000,
          profit_usd: 0.56,
          leg1_rate: 90000,
          leg1_market_rate: 90000,
          leg1_profit_usd: 0.56,
          leg2_rate: null,
          leg2_market_rate: null,
          leg2_profit_usd: null,
          via_currency: null,
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
          base_rate: 90000,
          profit_usd: 1.11,
          leg1_rate: 90000,
          leg1_market_rate: 90000,
          leg1_profit_usd: 1.11,
          leg2_rate: null,
          leg2_market_rate: null,
          leg2_profit_usd: null,
          via_currency: null,
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
