/**
 * ActivityService Unit Tests
 * (Legacy adapter — delegates to TransactionService)
 */

import { jest } from "@jest/globals";

import {
  ActivityService,
  getActivityService,
  resetActivityService,
} from "@liratek/core";

describe("ActivityService", () => {
  let service: ActivityService;
  const mockGetRecent = jest.fn();
  const mockPrepareAll = jest.fn();
  const mockPrepare = jest.fn(() => ({ all: mockPrepareAll }));
  const mockTxnService = { getRecent: mockGetRecent } as any;
  const mockDbGetter = () => ({ prepare: mockPrepare }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetActivityService();
    service = new ActivityService(mockTxnService, mockDbGetter);
  });

  // ===========================================================================
  // getRecentLogs Tests
  // ===========================================================================

  describe("getRecentLogs", () => {
    it("should map transaction rows to legacy ActivityLogEntity format", () => {
      mockGetRecent.mockReturnValue([
        {
          id: 1,
          type: "SALE",
          source_table: "sales",
          source_id: 42,
          user_id: 1,
          username: "admin",
          client_name: "John",
          metadata_json: '{"amount":100}',
          created_at: "2025-01-15 10:00:00",
          amount_usd: 100,
          amount_lbp: 0,
          client_id: 5,
          exchange_rate: 90000,
          summary: "Sale #42",
          status: "ACTIVE",
        },
      ]);

      const result = service.getRecentLogs();

      expect(result).toEqual([
        {
          id: 1,
          user_id: 1,
          username: "admin",
          action: "SALE",
          table_name: "sales",
          record_id: 42,
          details_json: '{"amount":100}',
          customer_name: "John",
          created_at: "2025-01-15 10:00:00",
        },
      ]);
      expect(mockGetRecent).toHaveBeenCalledWith(undefined);
    });

    it("should pass limit to TransactionService", () => {
      mockGetRecent.mockReturnValue([]);
      service.getRecentLogs(5);
      expect(mockGetRecent).toHaveBeenCalledWith(5);
    });

    it("should return empty array on error", () => {
      mockGetRecent.mockImplementation(() => {
        throw new Error("Database error");
      });
      expect(service.getRecentLogs()).toEqual([]);
    });

    it("should return empty array when no logs", () => {
      mockGetRecent.mockReturnValue([]);
      expect(service.getRecentLogs()).toEqual([]);
    });
  });

  // ===========================================================================
  // getSyncErrors Tests
  // ===========================================================================

  describe("getSyncErrors", () => {
    it("should return sync errors", () => {
      const mockErrors = [
        {
          id: 1,
          endpoint: "api/sync",
          error: "Connection timeout",
          created_at: "2025-01-15 10:00:00",
        },
      ];
      mockPrepareAll.mockReturnValue(mockErrors);

      const result = service.getSyncErrors();

      expect(result).toEqual(mockErrors);
    });

    it("should return error object on exception", () => {
      const throwingService = new ActivityService(
        mockTxnService,
        () =>
          ({
            prepare: () => {
              throw new Error("Query failed");
            },
          }) as any,
      );
      const result = throwingService.getSyncErrors();
      expect(result).toEqual({ error: "Query failed" });
    });

    it("should return empty array when no errors", () => {
      mockPrepareAll.mockReturnValue([]);
      expect(service.getSyncErrors()).toEqual([]);
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
