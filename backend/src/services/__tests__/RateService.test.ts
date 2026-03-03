/**
 * RateService Unit Tests
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getRateRepository: jest.fn(),
    RateRepository: jest.fn(),
  };
});

import {
  RateService,
  getRateService,
  resetRateService,
  RateRepository,
  getRateRepository,
  type ExchangeRateEntity,
  type SetRateData,
} from "@liratek/core";

describe("RateService", () => {
  let service: RateService;
  let mockRepo: jest.Mocked<RateRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateService();

    // Create mock repository
    mockRepo = {
      findAllRates: jest.fn(),
      findAll: jest.fn(),
      findByCode: jest.fn(),
      upsert: jest.fn(),
      deleteByCode: jest.fn(),
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
          to_code: "LBP",
          market_rate: 90000,
          delta: 500,
          is_stronger: 1,
          updated_at: "2025-01-15",
        },
        {
          id: 2,
          to_code: "EUR",
          market_rate: 1.08,
          delta: 0.02,
          is_stronger: -1,
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
        to_code: "LBP",
        market_rate: 90500,
        delta: 500,
        is_stronger: 1,
      };
      mockRepo.upsert.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
      expect(mockRepo.upsert).toHaveBeenCalledWith(rateData);
    });

    it("should update an existing rate", () => {
      const rateData: SetRateData = {
        to_code: "LBP",
        market_rate: 91000,
        delta: 500,
        is_stronger: 1,
      };
      mockRepo.upsert.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });

    it("should handle EUR rate", () => {
      const rateData: SetRateData = {
        to_code: "EUR",
        market_rate: 1.1,
        delta: 0.02,
        is_stronger: -1,
      };
      mockRepo.upsert.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });

    it("should return error on failure", () => {
      const rateData: SetRateData = {
        to_code: "LBP",
        market_rate: 90000,
        delta: 500,
        is_stronger: 1,
      };
      mockRepo.upsert.mockImplementation(() => {
        throw new Error("Update failed");
      });

      const result = service.setRate(rateData);

      expect(result).toEqual({
        success: false,
        error: "Update failed",
      });
    });

    it("should handle zero delta rate", () => {
      const rateData: SetRateData = {
        to_code: "LBP",
        market_rate: 90000,
        delta: 0,
        is_stronger: 1,
      };
      mockRepo.upsert.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });

    it("should handle decimal rates", () => {
      const rateData: SetRateData = {
        to_code: "GBP",
        market_rate: 1.27345,
        delta: 0.01,
        is_stronger: -1,
      };
      mockRepo.upsert.mockReturnValue(undefined);

      const result = service.setRate(rateData);

      expect(result).toEqual({ success: true });
    });
  });

  // ===========================================================================
  // getRate Tests
  // ===========================================================================

  describe("getRate", () => {
    it("should return rate for currency pair", () => {
      mockRepo.findByCode.mockReturnValue({
        id: 1,
        to_code: "LBP",
        market_rate: 90000,
        delta: 500,
        is_stronger: 1 as const,
        updated_at: "2025-01-15",
      });

      const result = service.getRate("USD", "LBP");

      expect(result).toBe(90000);
      expect(mockRepo.findByCode).toHaveBeenCalledWith("LBP");
    });

    it("should return null for non-existent pair", () => {
      mockRepo.findByCode.mockReturnValue(null);

      const result = service.getRate("ABC", "XYZ");

      expect(result).toBeNull();
    });

    it("should handle reverse currency pair (LBP from)", () => {
      mockRepo.findByCode.mockReturnValue({
        id: 1,
        to_code: "LBP",
        market_rate: 90000,
        delta: 500,
        is_stronger: 1 as const,
        updated_at: "2025-01-15",
      });

      const result = service.getRate("LBP", "USD");

      expect(result).toBe(90000);
      expect(mockRepo.findByCode).toHaveBeenCalledWith("LBP");
    });

    it("should handle decimal rate return", () => {
      mockRepo.findByCode.mockReturnValue({
        id: 2,
        to_code: "EUR",
        market_rate: 1.08,
        delta: 0.02,
        is_stronger: -1 as const,
        updated_at: "2025-01-15",
      });

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
