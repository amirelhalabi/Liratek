/**
 * RateService Unit Tests
 */

import { RateService, getRateService, resetRateService } from "../RateService";
import {
  RateRepository,
  getRateRepository,
  type ExchangeRateEntity,
  type SetRateData,
} from "@liratek/core";

// Mock the repository module
jest.mock("@liratek/core", () => ({
  ...jest.requireActual("@liratek/core"),
  getRateRepository: jest.fn(),
  RateRepository: jest.fn(),
}));

describe("RateService", () => {
  let service: RateService;
  let mockRepo: jest.Mocked<RateRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateService();

    // Create mock repository
    mockRepo = {
      findAllRates: jest.fn(),
      setRate: jest.fn(),
      getRate: jest.fn(),
    } as unknown as jest.Mocked<RateRepository>;

    (getRateRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new RateService(mockRepo);
  });

  // ===========================================================================
  // listRates Tests
  // ===========================================================================

  describe("listRates", () => {
    it("should return all exchange rates", () => {
      const mockRates: ExchangeRateEntity[] = [
        {
          id: 1,
          from_code: "USD",
          to_code: "LBP",
          rate: 90000,
          updated_at: "2025-01-15",
        },
        {
          id: 2,
          from_code: "EUR",
          to_code: "USD",
          rate: 1.08,
          updated_at: "2025-01-15",
        },
      ];
      mockRepo.findAllRates.mockReturnValue(mockRates);

      const result = service.listRates();

      expect(result).toEqual(mockRates);
      expect(mockRepo.findAllRates).toHaveBeenCalled();
    });

    it("should return empty array when no rates", () => {
      mockRepo.findAllRates.mockReturnValue([]);

      const result = service.listRates();

      expect(result).toEqual([]);
    });

    it("should return error object on exception", () => {
      mockRepo.findAllRates.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.listRates();

      expect(result).toEqual({ error: "Database error" });
    });
  });

  // ===========================================================================
  // setRate Tests
  // ===========================================================================

  describe("setRate", () => {
    it("should set a new rate successfully", () => {
      const rateData: SetRateData = {
        from_code: "USD",
        to_code: "LBP",
        rate: 90500,
      };
      mockRepo.setRate.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
      expect(mockRepo.setRate).toHaveBeenCalledWith(rateData);
    });

    it("should update an existing rate", () => {
      const rateData: SetRateData = {
        from_code: "USD",
        to_code: "LBP",
        rate: 91000,
      };
      mockRepo.setRate.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });

    it("should handle EUR to USD rate", () => {
      const rateData: SetRateData = {
        from_code: "EUR",
        to_code: "USD",
        rate: 1.1,
      };
      mockRepo.setRate.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });

    it("should return error on failure", () => {
      const rateData: SetRateData = {
        from_code: "USD",
        to_code: "LBP",
        rate: 90000,
      };
      mockRepo.setRate.mockImplementation(() => {
        throw new Error("Update failed");
      });

      const result = service.setRate(rateData);

      expect(result).toEqual({
        success: false,
        error: "Update failed",
      });
    });

    it("should handle zero rate", () => {
      const rateData: SetRateData = {
        from_code: "USD",
        to_code: "LBP",
        rate: 0,
      };
      mockRepo.setRate.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });

    it("should handle decimal rates", () => {
      const rateData: SetRateData = {
        from_code: "GBP",
        to_code: "USD",
        rate: 1.27345,
      };
      mockRepo.setRate.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });
  });

  // ===========================================================================
  // getRate Tests
  // ===========================================================================

  describe("getRate", () => {
    it("should return rate for currency pair", () => {
      mockRepo.getRate.mockReturnValue(90000);

      const result = service.getRate("USD", "LBP");

      expect(result).toBe(90000);
      expect(mockRepo.getRate).toHaveBeenCalledWith("USD", "LBP");
    });

    it("should return null for non-existent pair", () => {
      mockRepo.getRate.mockReturnValue(null);

      const result = service.getRate("ABC", "XYZ");

      expect(result).toBeNull();
    });

    it("should handle reverse currency pair", () => {
      mockRepo.getRate.mockReturnValue(0.0000111);

      const result = service.getRate("LBP", "USD");

      expect(result).toBe(0.0000111);
      expect(mockRepo.getRate).toHaveBeenCalledWith("LBP", "USD");
    });

    it("should handle decimal rate return", () => {
      mockRepo.getRate.mockReturnValue(1.08);

      const result = service.getRate("EUR", "USD");

      expect(result).toBe(1.08);
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetRateService();
      const instance1 = getRateService();
      const instance2 = getRateService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getRateService();
      resetRateService();
      const instance2 = getRateService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
