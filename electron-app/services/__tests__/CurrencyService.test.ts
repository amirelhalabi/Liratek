/**
 * CurrencyService Unit Tests
 */

import {
  CurrencyService,
  getCurrencyService,
  resetCurrencyService,
} from "../CurrencyService";
import {
  CurrencyRepository,
  getCurrencyRepository,
  type CurrencyEntity,
  type CreateCurrencyData,
  type UpdateCurrencyData,
} from "@liratek/core";

// Mock the repository module
jest.mock("@liratek/core", () => ({
  ...jest.requireActual("@liratek/core"),
  getCurrencyRepository: jest.fn(),
  CurrencyRepository: jest.fn(),
}));

describe("CurrencyService", () => {
  let service: CurrencyService;
  let mockRepo: jest.Mocked<CurrencyRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCurrencyService();

    // Create mock repository
    mockRepo = {
      findAllCurrencies: jest.fn(),
      createCurrency: jest.fn(),
      updateCurrency: jest.fn(),
      deleteCurrency: jest.fn(),
    } as unknown as jest.Mocked<CurrencyRepository>;

    (getCurrencyRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new CurrencyService(mockRepo);
  });

  // ===========================================================================
  // listCurrencies Tests
  // ===========================================================================

  describe("listCurrencies", () => {
    it("should return all currencies", () => {
      const mockCurrencies: CurrencyEntity[] = [
        { id: 1, code: "USD", name: "US Dollar", is_active: 1 },
        { id: 2, code: "LBP", name: "Lebanese Pound", is_active: 1 },
        { id: 3, code: "EUR", name: "Euro", is_active: 1 },
      ];
      mockRepo.findAllCurrencies.mockReturnValue(mockCurrencies);

      const result = service.listCurrencies();

      expect(result).toEqual(mockCurrencies);
      expect(mockRepo.findAllCurrencies).toHaveBeenCalled();
    });

    it("should return empty array when no currencies", () => {
      mockRepo.findAllCurrencies.mockReturnValue([]);

      const result = service.listCurrencies();

      expect(result).toEqual([]);
    });

    it("should return error object on exception", () => {
      mockRepo.findAllCurrencies.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.listCurrencies();

      expect(result).toEqual({ error: "Database error" });
    });
  });

  // ===========================================================================
  // createCurrency Tests
  // ===========================================================================

  describe("createCurrency", () => {
    it("should create a currency successfully", () => {
      const currencyData: CreateCurrencyData = {
        code: "GBP",
        name: "British Pound",
      };
      mockRepo.createCurrency.mockReturnValue({ id: 4 });

      const result = service.createCurrency(currencyData);

      expect(result).toEqual({ success: true, id: 4 });
      expect(mockRepo.createCurrency).toHaveBeenCalledWith(currencyData);
    });

    it("should handle duplicate currency code", () => {
      const currencyData: CreateCurrencyData = {
        code: "USD",
        name: "US Dollar",
      };
      const error = new Error("Unique constraint failed") as Error & {
        code: string;
      };
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      mockRepo.createCurrency.mockImplementation(() => {
        throw error;
      });

      const result = service.createCurrency(currencyData);

      expect(result).toEqual({
        success: false,
        error: "Currency code already exists",
      });
    });

    it("should return generic error for other failures", () => {
      const currencyData: CreateCurrencyData = {
        code: "JPY",
        name: "Japanese Yen",
      };
      mockRepo.createCurrency.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      const result = service.createCurrency(currencyData);

      expect(result).toEqual({
        success: false,
        error: "Insert failed",
      });
    });

    it("should handle currency creation", () => {
      const currencyData: CreateCurrencyData = {
        code: "CHF",
        name: "Swiss Franc",
      };
      mockRepo.createCurrency.mockReturnValue({ id: 5 });

      const result = service.createCurrency(currencyData);

      expect(result).toEqual({ success: true, id: 5 });
    });
  });

  // ===========================================================================
  // updateCurrency Tests
  // ===========================================================================

  describe("updateCurrency", () => {
    it("should update a currency successfully", () => {
      const updateData: UpdateCurrencyData = {
        name: "Lebanese Lira",
      };
      mockRepo.updateCurrency.mockReturnValue(true);

      const result = service.updateCurrency(2, updateData);

      expect(result).toEqual({ success: true });
      expect(mockRepo.updateCurrency).toHaveBeenCalledWith(2, updateData);
    });

    it("should return not found when currency does not exist", () => {
      const updateData: UpdateCurrencyData = {
        name: "Nonexistent Currency",
      };
      mockRepo.updateCurrency.mockReturnValue(false);

      const result = service.updateCurrency(999, updateData);

      expect(result).toEqual({
        success: false,
        error: "Not found",
      });
    });

    it("should handle update failure", () => {
      const updateData: UpdateCurrencyData = {
        name: "Error Currency",
      };
      mockRepo.updateCurrency.mockImplementation(() => {
        throw new Error("Update failed");
      });

      const result = service.updateCurrency(1, updateData);

      expect(result).toEqual({
        success: false,
        error: "Update failed",
      });
    });

    it("should update only provided fields", () => {
      const updateData: UpdateCurrencyData = {
        is_active: 0,
      };
      mockRepo.updateCurrency.mockReturnValue(true);

      const result = service.updateCurrency(3, updateData);

      expect(result).toEqual({ success: true });
      expect(mockRepo.updateCurrency).toHaveBeenCalledWith(3, { is_active: 0 });
    });
  });

  // ===========================================================================
  // deleteCurrency Tests
  // ===========================================================================

  describe("deleteCurrency", () => {
    it("should delete a currency successfully", () => {
      mockRepo.deleteCurrency.mockReturnValue(undefined);

      const result = service.deleteCurrency(3);

      expect(result).toEqual({ success: true });
      expect(mockRepo.deleteCurrency).toHaveBeenCalledWith(3);
    });

    it("should return error on delete failure", () => {
      mockRepo.deleteCurrency.mockImplementation(() => {
        throw new Error("Delete failed - currency in use");
      });

      const result = service.deleteCurrency(1);

      expect(result).toEqual({
        success: false,
        error: "Delete failed - currency in use",
      });
    });

    it("should handle deleting non-existent currency", () => {
      mockRepo.deleteCurrency.mockReturnValue(undefined);

      const result = service.deleteCurrency(999);

      // Should still succeed (no-op)
      expect(result).toEqual({ success: true });
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetCurrencyService();
      const instance1 = getCurrencyService();
      const instance2 = getCurrencyService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getCurrencyService();
      resetCurrencyService();
      const instance2 = getCurrencyService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
