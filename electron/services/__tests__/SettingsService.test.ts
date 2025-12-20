/**
 * SettingsService Unit Tests
 */

import {
  SettingsService,
  getSettingsService,
  resetSettingsService,
} from "../SettingsService";
import {
  SettingsRepository,
  SettingEntity,
  getSettingsRepository,
} from "../../database/repositories/SettingsRepository";

// Mock the repository module
jest.mock("../../database/repositories/SettingsRepository", () => ({
  getSettingsRepository: jest.fn(),
  SettingsRepository: jest.fn(),
}));

describe("SettingsService", () => {
  let service: SettingsService;
  let mockRepo: jest.Mocked<SettingsRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSettingsService();

    // Create mock repository
    mockRepo = {
      getAllSettings: jest.fn(),
      getSetting: jest.fn(),
      getSettingValue: jest.fn(),
      upsertSetting: jest.fn(),
    } as unknown as jest.Mocked<SettingsRepository>;

    (getSettingsRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new SettingsService();
  });

  // ===========================================================================
  // getAllSettings Tests
  // ===========================================================================

  describe("getAllSettings", () => {
    it("should return all settings", () => {
      const mockSettings: SettingEntity[] = [
        { key_name: "shop_name", value: "Liratek Store" },
        { key_name: "currency", value: "USD" },
        { key_name: "exchange_rate", value: "90000" },
      ];
      mockRepo.getAllSettings.mockReturnValue(mockSettings);

      const result = service.getAllSettings();

      expect(result).toEqual(mockSettings);
      expect(mockRepo.getAllSettings).toHaveBeenCalled();
    });

    it("should return empty array when no settings exist", () => {
      mockRepo.getAllSettings.mockReturnValue([]);

      const result = service.getAllSettings();

      expect(result).toEqual([]);
    });

    it("should return empty array on error", () => {
      mockRepo.getAllSettings.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.getAllSettings();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // getSetting Tests
  // ===========================================================================

  describe("getSetting", () => {
    it("should return a setting by key", () => {
      const mockSetting: SettingEntity = { key_name: "shop_name", value: "Liratek Store" };
      mockRepo.getSetting.mockReturnValue(mockSetting);

      const result = service.getSetting("shop_name");

      expect(result).toEqual(mockSetting);
      expect(mockRepo.getSetting).toHaveBeenCalledWith("shop_name");
    });

    it("should return undefined for non-existent key", () => {
      mockRepo.getSetting.mockReturnValue(undefined);

      const result = service.getSetting("nonexistent_key");

      expect(result).toBeUndefined();
    });

    it("should return undefined on error", () => {
      mockRepo.getSetting.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getSetting("error_key");

      expect(result).toBeUndefined();
    });
  });

  // ===========================================================================
  // getSettingValue Tests
  // ===========================================================================

  describe("getSettingValue", () => {
    it("should return value wrapper when setting exists", () => {
      mockRepo.getSettingValue.mockReturnValue("90000");

      const result = service.getSettingValue("exchange_rate");

      expect(result).toEqual({ value: "90000" });
      expect(mockRepo.getSettingValue).toHaveBeenCalledWith("exchange_rate");
    });

    it("should return undefined when setting does not exist", () => {
      mockRepo.getSettingValue.mockReturnValue(undefined);

      const result = service.getSettingValue("nonexistent_key");

      expect(result).toBeUndefined();
    });

    it("should return undefined on error", () => {
      mockRepo.getSettingValue.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getSettingValue("error_key");

      expect(result).toBeUndefined();
    });

    it("should handle empty string value", () => {
      mockRepo.getSettingValue.mockReturnValue("");

      const result = service.getSettingValue("empty_setting");

      expect(result).toEqual({ value: "" });
    });
  });

  // ===========================================================================
  // updateSetting Tests
  // ===========================================================================

  describe("updateSetting", () => {
    it("should update a setting successfully", () => {
      mockRepo.upsertSetting.mockReturnValue(undefined);

      const result = service.updateSetting("shop_name", "New Name");

      expect(result).toEqual({ success: true });
      expect(mockRepo.upsertSetting).toHaveBeenCalledWith("shop_name", "New Name");
    });

    it("should create a new setting if it does not exist (upsert)", () => {
      mockRepo.upsertSetting.mockReturnValue(undefined);

      const result = service.updateSetting("new_key", "new_value");

      expect(result).toEqual({ success: true });
      expect(mockRepo.upsertSetting).toHaveBeenCalledWith("new_key", "new_value");
    });

    it("should return error on failure", () => {
      mockRepo.upsertSetting.mockImplementation(() => {
        throw new Error("Update failed");
      });

      const result = service.updateSetting("shop_name", "value");

      expect(result).toEqual({
        success: false,
        error: "Update failed",
      });
    });

    it("should handle updating with empty value", () => {
      mockRepo.upsertSetting.mockReturnValue(undefined);

      const result = service.updateSetting("optional_key", "");

      expect(result).toEqual({ success: true });
      expect(mockRepo.upsertSetting).toHaveBeenCalledWith("optional_key", "");
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetSettingsService();
      const instance1 = getSettingsService();
      const instance2 = getSettingsService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getSettingsService();
      resetSettingsService();
      const instance2 = getSettingsService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
