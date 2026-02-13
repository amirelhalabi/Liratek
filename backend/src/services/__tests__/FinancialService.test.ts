/**
 * FinancialService Unit Tests
 */

import { jest } from "@jest/globals";
import {
  FinancialService,
  getFinancialService,
  resetFinancialService,
} from "../FinancialService";
import {
  FinancialServiceRepository,
  getFinancialServiceRepository,
  type CreateFinancialServiceData,
  type FinancialServiceEntity,
  type FinancialServiceAnalytics,
} from "../../database/repositories";

// Mock the repository module
jest.mock("../../database/repositories", () => ({
  getFinancialServiceRepository: jest.fn(),
  FinancialServiceRepository: jest.fn(),
}));

describe("FinancialService", () => {
  let service: FinancialService;
  let mockRepo: jest.Mocked<FinancialServiceRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetFinancialService();

    // Create mock repository with all methods
    mockRepo = {
      createTransaction: jest.fn(),
      getHistory: jest.fn(),
      getAnalytics: jest.fn(),
      logActivity: jest.fn(),
    } as unknown as jest.Mocked<FinancialServiceRepository>;

    (getFinancialServiceRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new FinancialService(mockRepo);
  });

  // ===========================================================================
  // addTransaction Tests
  // ===========================================================================

  describe("addTransaction", () => {
    const mockTransactionData: CreateFinancialServiceData = {
      provider: "OMT",
      serviceType: "SEND",
      amountUSD: 100,
      amountLBP: 0,
      commissionUSD: 5,
      commissionLBP: 0,
      note: "Money transfer to Lebanon",
    };

    it("should add a transaction successfully", () => {
      mockRepo.createTransaction.mockReturnValue({
        id: 1,
        drawer: "OMT_Drawer",
      });

      const result = service.addTransaction(mockTransactionData);

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(
        mockTransactionData,
      );
      expect(mockRepo.logActivity).toHaveBeenCalledWith(
        mockTransactionData,
        "OMT_Drawer",
      );
    });

    it("should handle WHISH transactions", () => {
      const whishData: CreateFinancialServiceData = {
        provider: "WHISH",
        serviceType: "RECEIVE",
        amountUSD: 50,
        amountLBP: 0,
        commissionUSD: 3,
        commissionLBP: 150000,
        note: "Receive payment",
      };

      mockRepo.createTransaction.mockReturnValue({
        id: 2,
        drawer: "WHISH_Drawer",
      });

      const result = service.addTransaction(whishData);

      expect(result).toEqual({ success: true, id: 2 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(whishData);
    });

    it("should handle BOB transactions", () => {
      const bobData: CreateFinancialServiceData = {
        provider: "BOB",
        serviceType: "SEND",
        amountUSD: 200,
        amountLBP: 0,
        commissionUSD: 10,
        commissionLBP: 0,
        note: "BOB transfer",
      };

      mockRepo.createTransaction.mockReturnValue({
        id: 3,
        drawer: "BOB_Drawer",
      });

      const result = service.addTransaction(bobData);

      expect(result).toEqual({ success: true, id: 3 });
    });

    it("should return error when createTransaction fails", () => {
      mockRepo.createTransaction.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.addTransaction(mockTransactionData);

      expect(result).toEqual({
        success: false,
        error: "Database error",
      });
    });

    it("should return error when logActivity fails", () => {
      mockRepo.createTransaction.mockReturnValue({
        id: 1,
        drawer: "OMT_Drawer",
      });
      mockRepo.logActivity.mockImplementation(() => {
        throw new Error("Activity log failed");
      });

      const result = service.addTransaction(mockTransactionData);

      // Should catch and return error
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
    it("should return all history when no provider filter", () => {
      const mockHistory: FinancialServiceEntity[] = [
        {
          id: 1,
          provider: "OMT",
          service_type: "SEND",
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 5,
          commission_lbp: 0,
          client_name: null,
          reference_number: null,
          note: "Transfer 1",
          created_at: "2025-01-01",
          created_by: 1,
        },
        {
          id: 2,
          provider: "WHISH",
          service_type: "RECEIVE",
          amount_usd: 50,
          amount_lbp: 0,
          commission_usd: 3,
          commission_lbp: 0,
          client_name: null,
          reference_number: null,
          note: "Transfer 2",
          created_at: "2025-01-01",
          created_by: 1,
        },
      ];
      mockRepo.getHistory.mockReturnValue(mockHistory);

      const result = service.getHistory();

      expect(result).toEqual(mockHistory);
      expect(mockRepo.getHistory).toHaveBeenCalledWith(undefined);
    });

    it("should filter history by provider", () => {
      const mockHistory: FinancialServiceEntity[] = [
        {
          id: 1,
          provider: "OMT",
          service_type: "SEND",
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 5,
          commission_lbp: 0,
          client_name: null,
          reference_number: null,
          note: "Transfer 1",
          created_at: "2025-01-01",
          created_by: 1,
        },
      ];
      mockRepo.getHistory.mockReturnValue(mockHistory);

      const result = service.getHistory("OMT");

      expect(result).toEqual(mockHistory);
      expect(mockRepo.getHistory).toHaveBeenCalledWith("OMT");
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
  // getAnalytics Tests
  // ===========================================================================

  describe("getAnalytics", () => {
    it("should return analytics data", () => {
      const mockAnalytics: FinancialServiceAnalytics = {
        today: { commissionUSD: 50, commissionLBP: 2000000, count: 10 },
        month: { commissionUSD: 500, commissionLBP: 20000000, count: 100 },
        byProvider: [
          {
            provider: "OMT",
            commission_usd: 300,
            commission_lbp: 10000000,
            count: 60,
          },
          {
            provider: "WHISH",
            commission_usd: 150,
            commission_lbp: 8000000,
            count: 30,
          },
          {
            provider: "BOB",
            commission_usd: 50,
            commission_lbp: 2000000,
            count: 10,
          },
        ],
      };
      mockRepo.getAnalytics.mockReturnValue(mockAnalytics);

      const result = service.getAnalytics();

      expect(result).toEqual(mockAnalytics);
      expect(mockRepo.getAnalytics).toHaveBeenCalled();
    });

    it("should return default analytics on error", () => {
      mockRepo.getAnalytics.mockImplementation(() => {
        throw new Error("Analytics query failed");
      });

      const result = service.getAnalytics();

      expect(result).toEqual({
        today: { commissionUSD: 0, commissionLBP: 0, count: 0 },
        month: { commissionUSD: 0, commissionLBP: 0, count: 0 },
        byProvider: [],
      });
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetFinancialService();
      const instance1 = getFinancialService();
      const instance2 = getFinancialService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getFinancialService();
      resetFinancialService();
      const instance2 = getFinancialService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
