/**
 * ActivityService Unit Tests
 */

import { jest } from '@jest/globals';
import {
  ActivityService,
  getActivityService,
  resetActivityService,
} from "../ActivityService";
import {
  ActivityLogEntity,
  SyncErrorEntity,
} from "@liratek/core";

// Mock the core repository module used by @liratek/core ActivityService
jest.mock("../../../../packages/core/src/repositories/ActivityRepository", () => ({
  getActivityRepository: jest.fn(),
}));

import { getActivityRepository } from "../../../../packages/core/src/repositories/ActivityRepository";

describe("ActivityService", () => {
  let service: ActivityService;
  let mockRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetActivityService();

    // Create mock repository
    mockRepo = {
      getRecentLogs: jest.fn(),
      logActivity: jest.fn(),
      getSyncErrors: jest.fn(),
    };

    (getActivityRepository as jest.Mock).mockReturnValue(mockRepo);
    service = new ActivityService();
  });

  // ===========================================================================
  // getRecentLogs Tests
  // ===========================================================================

  describe("getRecentLogs", () => {
    it("should return recent logs with default limit", () => {
      const mockLogs: ActivityLogEntity[] = [
        {
          id: 1,
          user_id: 1,
          action: "Sale Completed",
          details_json: JSON.stringify({ amount: 100 }),
          created_at: "2025-01-15 10:00:00",
        },
        {
          id: 2,
          user_id: 1,
          action: "Client Created",
          details_json: JSON.stringify({ name: "John Doe" }),
          created_at: "2025-01-15 09:00:00",
        },
      ];
      mockRepo.getRecentLogs.mockReturnValue(mockLogs);

      const result = service.getRecentLogs();

      expect(result).toEqual(mockLogs);
      expect(mockRepo.getRecentLogs).toHaveBeenCalledWith(undefined);
    });

    it("should return recent logs with custom limit", () => {
      const mockLogs: ActivityLogEntity[] = [
        {
          id: 1,
          user_id: 1,
          action: "Exchange Transaction",
          details_json: JSON.stringify({ from: "USD", to: "LBP" }),
          created_at: "2025-01-15 10:00:00",
        },
      ];
      mockRepo.getRecentLogs.mockReturnValue(mockLogs);

      const result = service.getRecentLogs(5);

      expect(result).toEqual(mockLogs);
      expect(mockRepo.getRecentLogs).toHaveBeenCalledWith(5);
    });

    it("should return empty array on error", () => {
      mockRepo.getRecentLogs.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.getRecentLogs();

      expect(result).toEqual([]);
    });

    it("should return empty array when no logs", () => {
      mockRepo.getRecentLogs.mockReturnValue([]);

      const result = service.getRecentLogs();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // logActivity Tests
  // ===========================================================================

  describe("logActivity", () => {
    it("should log activity successfully with basic params", () => {
      mockRepo.logActivity.mockReturnValue(1);

      const result = service.logActivity(1, "Login");

      expect(result).toBe(1);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(
        1,
        "Login",
        undefined,
        undefined,
        undefined,
      );
    });

    it("should log activity with details", () => {
      mockRepo.logActivity.mockReturnValue(2);

      const details = { ip_address: "192.168.1.1", browser: "Chrome" };
      const result = service.logActivity(1, "Login", details);

      expect(result).toBe(2);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(
        1,
        "Login",
        details,
        undefined,
        undefined,
      );
    });

    it("should log activity with table reference", () => {
      mockRepo.logActivity.mockReturnValue(3);

      const result = service.logActivity(
        1,
        "Client Updated",
        { old_name: "John", new_name: "Johnny" },
        "clients",
        42,
      );

      expect(result).toBe(3);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(
        1,
        "Client Updated",
        { old_name: "John", new_name: "Johnny" },
        "clients",
        42,
      );
    });

    it("should return 0 on error", () => {
      mockRepo.logActivity.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      const result = service.logActivity(1, "Failed Action");

      expect(result).toBe(0);
    });

    it("should handle complex details object", () => {
      mockRepo.logActivity.mockReturnValue(4);

      const details = {
        sale_id: 100,
        items: [
          { product_id: 1, qty: 2 },
          { product_id: 2, qty: 1 },
        ],
        total: 250,
        currency: "USD",
      };

      const result = service.logActivity(
        1,
        "Sale Completed",
        details,
        "sales",
        100,
      );

      expect(result).toBe(4);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(
        1,
        "Sale Completed",
        details,
        "sales",
        100,
      );
    });
  });

  // ===========================================================================
  // getSyncErrors Tests
  // ===========================================================================

  describe("getSyncErrors", () => {
    it("should return sync errors with default limit", () => {
      const mockErrors: SyncErrorEntity[] = [
        {
          id: 1,
          endpoint: "api/sync",
          error: "Connection timeout",
          created_at: "2025-01-15 10:00:00",
        },
        {
          id: 2,
          endpoint: "api/upload",
          error: "Authentication failed",
          created_at: "2025-01-15 09:00:00",
        },
      ];
      mockRepo.getSyncErrors.mockReturnValue(mockErrors);

      const result = service.getSyncErrors();

      expect(result).toEqual(mockErrors);
      expect(mockRepo.getSyncErrors).toHaveBeenCalledWith(undefined);
    });

    it("should return sync errors with custom limit", () => {
      const mockErrors: SyncErrorEntity[] = [
        {
          id: 1,
          endpoint: "api/data",
          error: "Network error",
          created_at: "2025-01-15",
        },
      ];
      mockRepo.getSyncErrors.mockReturnValue(mockErrors);

      const result = service.getSyncErrors(10);

      expect(result).toEqual(mockErrors);
      expect(mockRepo.getSyncErrors).toHaveBeenCalledWith(10);
    });

    it("should return error object on exception", () => {
      mockRepo.getSyncErrors.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getSyncErrors();

      expect(result).toEqual({ error: "Query failed" });
    });

    it("should return empty array when no errors", () => {
      mockRepo.getSyncErrors.mockReturnValue([]);

      const result = service.getSyncErrors();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetActivityService();
      const instance1 = getActivityService();
      const instance2 = getActivityService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getActivityService();
      resetActivityService();
      const instance2 = getActivityService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
