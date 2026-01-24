/**
 * RechargeService Unit Tests
 */

import { jest } from '@jest/globals';
import {
  RechargeService,
  getRechargeService,
  resetRechargeService,
} from "../RechargeService";
import {
  RechargeRepository,
  getRechargeRepository,
  type VirtualStock,
  type RechargeData,
} from "../../database/repositories";

// Mock the repository module
jest.mock("../../database/repositories", () => ({
  getRechargeRepository: jest.fn(),
  RechargeRepository: jest.fn(),
}));

describe("RechargeService", () => {
  let service: RechargeService;
  let mockRepo: jest.Mocked<RechargeRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRechargeService();

    // Create mock repository
    mockRepo = {
      getVirtualStock: jest.fn(),
      processRecharge: jest.fn(),
    } as unknown as jest.Mocked<RechargeRepository>;

    (getRechargeRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new RechargeService(mockRepo);
  });

  // ===========================================================================
  // getStock Tests
  // ===========================================================================

  describe("getStock", () => {
    it("should return virtual stock for MTC and Alfa", () => {
      const mockStock: VirtualStock = {
        mtc: 500,
        alfa: 300,
      };
      mockRepo.getVirtualStock.mockReturnValue(mockStock);

      const result = service.getStock();

      expect(result).toEqual(mockStock);
      expect(mockRepo.getVirtualStock).toHaveBeenCalled();
    });

    it("should return zero stock when no recharge available", () => {
      const mockStock: VirtualStock = {
        mtc: 0,
        alfa: 0,
      };
      mockRepo.getVirtualStock.mockReturnValue(mockStock);

      const result = service.getStock();

      expect(result).toEqual({ mtc: 0, alfa: 0 });
    });

    it("should return default stock on error", () => {
      mockRepo.getVirtualStock.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.getStock();

      expect(result).toEqual({ mtc: 0, alfa: 0 });
    });

    it("should handle high stock values", () => {
      const mockStock: VirtualStock = {
        mtc: 50000,
        alfa: 30000,
      };
      mockRepo.getVirtualStock.mockReturnValue(mockStock);

      const result = service.getStock();

      expect(result).toEqual(mockStock);
    });
  });

  // ===========================================================================
  // processRecharge Tests
  // ===========================================================================

  describe("processRecharge", () => {
    it("should process MTC recharge successfully", () => {
      const rechargeData: RechargeData = {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 10,
        cost: 9,
        price: 10,
        phoneNumber: "03123456",
      };
      mockRepo.processRecharge.mockReturnValue({ success: true, saleId: 1 });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({ success: true, saleId: 1 });
      expect(mockRepo.processRecharge).toHaveBeenCalledWith(rechargeData);
    });

    it("should process Alfa recharge successfully", () => {
      const rechargeData: RechargeData = {
        provider: "Alfa",
        type: "CREDIT_TRANSFER",
        amount: 20,
        cost: 18,
        price: 20,
        phoneNumber: "70123456",
      };
      mockRepo.processRecharge.mockReturnValue({ success: true, saleId: 2 });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({ success: true, saleId: 2 });
    });

    it("should handle VOUCHER recharge type", () => {
      const rechargeData: RechargeData = {
        provider: "MTC",
        type: "VOUCHER",
        amount: 5,
        cost: 4.5,
        price: 5,
        phoneNumber: "03654321",
      };
      mockRepo.processRecharge.mockReturnValue({ success: true, saleId: 3 });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({ success: true, saleId: 3 });
    });

    it("should handle DAYS recharge type", () => {
      const rechargeData: RechargeData = {
        provider: "Alfa",
        type: "DAYS",
        amount: 15,
        cost: 13,
        price: 15,
        phoneNumber: "71987654",
      };
      mockRepo.processRecharge.mockReturnValue({ success: true, saleId: 4 });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({ success: true, saleId: 4 });
    });

    it("should return error when stock insufficient", () => {
      const rechargeData: RechargeData = {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 1000,
        cost: 900,
        price: 1000,
        phoneNumber: "03111111",
      };
      mockRepo.processRecharge.mockReturnValue({
        success: false,
        error: "Insufficient stock",
      });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({
        success: false,
        error: "Insufficient stock",
      });
    });

    it("should return error on database failure", () => {
      const rechargeData: RechargeData = {
        provider: "Alfa",
        type: "CREDIT_TRANSFER",
        amount: 10,
        cost: 9,
        price: 10,
        phoneNumber: "70222222",
      };
      mockRepo.processRecharge.mockReturnValue({
        success: false,
        error: "Database error",
      });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({
        success: false,
        error: "Database error",
      });
    });

    it("should handle recharge without phone number", () => {
      const rechargeData: RechargeData = {
        provider: "MTC",
        type: "VOUCHER",
        amount: 25,
        cost: 22,
        price: 25,
      };
      mockRepo.processRecharge.mockReturnValue({ success: true, saleId: 5 });

      const result = service.processRecharge(rechargeData);

      expect(result).toEqual({ success: true, saleId: 5 });
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetRechargeService();
      const instance1 = getRechargeService();
      const instance2 = getRechargeService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getRechargeService();
      resetRechargeService();
      const instance2 = getRechargeService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
