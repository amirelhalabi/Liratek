/**
 * ClosingService Unit Tests
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getClosingRepository: jest.fn(),
  };
});

import {
  ClosingService,
  getClosingService,
  resetClosingService,
  DailyStatsSnapshot,
  getClosingRepository,
} from "@liratek/core";

describe("ClosingService", () => {
  let service: ClosingService;
  let mockRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetClosingService();

    // Create mock repository matching the current ClosingRepository API
    mockRepo = {
      recalculateDrawerBalances: jest.fn(),
      getSystemExpectedBalancesDynamic: jest.fn(),
      getDailyStatsSnapshot: jest.fn(),
      getCheckpointTimeline: jest.fn(),
      getLastCheckpointActuals: jest.fn(),
      createCheckpoint: jest.fn(),
    };

    (getClosingRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new ClosingService(mockRepo);
  });

  // ===========================================================================
  // recalculateDrawerBalances Tests
  // ===========================================================================

  describe("recalculateDrawerBalances", () => {
    it("should return success when recalculation succeeds", () => {
      mockRepo.recalculateDrawerBalances.mockReturnValue({ success: true });

      const result = service.recalculateDrawerBalances();

      expect(result).toEqual({ success: true });
      expect(mockRepo.recalculateDrawerBalances).toHaveBeenCalled();
    });

    it("should return error result when repository returns error", () => {
      mockRepo.recalculateDrawerBalances.mockReturnValue({
        success: false,
        error: "Recalculation failed",
      });

      const result = service.recalculateDrawerBalances();

      expect(result).toEqual({ success: false, error: "Recalculation failed" });
    });

    it("should return failure result when repository throws", () => {
      mockRepo.recalculateDrawerBalances.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.recalculateDrawerBalances();

      expect(result.success).toBe(false);
      expect(result.error).toBe("DB error");
    });
  });

  // ===========================================================================
  // getSystemExpectedBalancesDynamic Tests
  // ===========================================================================

  describe("getSystemExpectedBalancesDynamic", () => {
    it("should return dynamic balances keyed by drawer and currency", () => {
      const mockBalances = {
        General: { USD: 1000, LBP: 90000000 },
        OMT: { USD: 500 },
      };
      mockRepo.getSystemExpectedBalancesDynamic.mockReturnValue(mockBalances);

      const result = service.getSystemExpectedBalancesDynamic();

      expect(result).toEqual(mockBalances);
      expect(mockRepo.getSystemExpectedBalancesDynamic).toHaveBeenCalled();
    });

    it("should return empty object when repository throws", () => {
      mockRepo.getSystemExpectedBalancesDynamic.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getSystemExpectedBalancesDynamic();

      expect(result).toEqual({});
    });
  });

  // ===========================================================================
  // getDailyStatsSnapshot Tests
  // ===========================================================================

  describe("getDailyStatsSnapshot", () => {
    it("should return daily stats snapshot", () => {
      const mockStats: DailyStatsSnapshot = {
        salesCount: 25,
        totalSalesUSD: 2500,
        totalSalesLBP: 225000000,
        debtPaymentsUSD: 300,
        debtPaymentsLBP: 27000000,
        totalExpensesUSD: 150,
        totalExpensesLBP: 13500000,
        totalProfitUSD: 500,
      };
      mockRepo.getDailyStatsSnapshot.mockReturnValue(mockStats);

      const result = service.getDailyStatsSnapshot();

      expect(result).toEqual(mockStats);
      expect(mockRepo.getDailyStatsSnapshot).toHaveBeenCalled();
    });

    it("should return default stats on error", () => {
      mockRepo.getDailyStatsSnapshot.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getDailyStatsSnapshot();

      expect(result).toEqual({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        totalProfitUSD: 0,
      });
    });

    it("should handle zero stats", () => {
      const mockStats: DailyStatsSnapshot = {
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        totalProfitUSD: 0,
      };
      mockRepo.getDailyStatsSnapshot.mockReturnValue(mockStats);

      const result = service.getDailyStatsSnapshot();

      expect(result).toEqual(mockStats);
    });
  });

  // ===========================================================================
  // getLastCheckpointActuals Tests
  // ===========================================================================

  describe("getLastCheckpointActuals", () => {
    it("should return last checkpoint actuals per drawer/currency", () => {
      const mockActuals = {
        General: { USD: 950, LBP: 88000000 },
        OMT: { USD: 480 },
      };
      mockRepo.getLastCheckpointActuals.mockReturnValue(mockActuals);

      const result = service.getLastCheckpointActuals();

      expect(result).toEqual(mockActuals);
      expect(mockRepo.getLastCheckpointActuals).toHaveBeenCalled();
    });

    it("should return empty object when repository throws", () => {
      mockRepo.getLastCheckpointActuals.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getLastCheckpointActuals();

      expect(result).toEqual({});
    });
  });

  // ===========================================================================
  // createCheckpoint Tests
  // ===========================================================================

  describe("createCheckpoint", () => {
    it("should create a checkpoint successfully", () => {
      const data = {
        user_id: 1,
        notes: "End of day",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 1000,
            physical_amount: 1000,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: 90000000,
            physical_amount: 90000000,
          },
        ],
      };
      mockRepo.createCheckpoint.mockReturnValue({ success: true, id: 5 });

      const result = service.createCheckpoint(data);

      expect(result).toEqual({ success: true, id: 5 });
      expect(mockRepo.createCheckpoint).toHaveBeenCalledWith(data);
    });

    it("should return failure result when repository throws", () => {
      mockRepo.createCheckpoint.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      const result = service.createCheckpoint({
        user_id: 1,
        amounts: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insert failed");
    });
  });

  // ===========================================================================
  // getCheckpointTimeline Tests
  // ===========================================================================

  describe("getCheckpointTimeline", () => {
    it("should return checkpoints for a given date", async () => {
      const mockCheckpoints = [
        {
          id: 1,
          closing_date: "2025-01-15",
          drawer_name: "General",
          checkpoint_type: "CLOSING",
          created_at: "2025-01-15T20:00:00",
          created_by: 1,
          user_name: "Admin",
          currencies: [],
        },
      ];
      mockRepo.getCheckpointTimeline.mockReturnValue(mockCheckpoints);

      const result = await service.getCheckpointTimeline({
        date: "2025-01-15",
      });

      expect(result.success).toBe(true);
      expect(result.checkpoints).toEqual(mockCheckpoints);
    });

    it("should return all checkpoints when no filters provided", async () => {
      mockRepo.getCheckpointTimeline.mockReturnValue([]);

      const result = await service.getCheckpointTimeline();

      expect(result.success).toBe(true);
      expect(result.checkpoints).toEqual([]);
    });

    it("should return failure result when repository throws", async () => {
      mockRepo.getCheckpointTimeline.mockImplementation(() => {
        throw new Error("Timeline query failed");
      });

      const result = await service.getCheckpointTimeline({
        date: "2025-01-15",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Timeline query failed");
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetClosingService();
      const instance1 = getClosingService();
      const instance2 = getClosingService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getClosingService();
      resetClosingService();
      const instance2 = getClosingService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
