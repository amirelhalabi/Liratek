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
  getClosingRepository,
} from "@liratek/core";

describe("ClosingService", () => {
  let service: ClosingService;
  let mockRepo: any;
  // LIRA-219 — `ClosingService.getDailyStatsSnapshot` now composes activity
  // stats (this repo) with GROSS profit from `ProfitService.getSummary`
  // (rule 14, the ONE definition — see
  // `packages/core/src/services/__tests__/ClosingService.profitParity.test.ts`
  // for the real-schema coverage of that composition itself). This file
  // stays a thin repo-delegation unit test, so profit is mocked too.
  let mockProfitService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetClosingService();

    // Create mock repository matching the current ClosingRepository API
    // (LIRA-219 renamed the profit-free activity read to
    // `getDailyActivityStats` — the old `getDailyStatsSnapshot` name/shape,
    // which used to carry its own profit SQL, no longer exists on the repo).
    mockRepo = {
      recalculateDrawerBalances: jest.fn(),
      getSystemExpectedBalancesDynamic: jest.fn(),
      getDailyActivityStats: jest.fn(),
      getCheckpointTimeline: jest.fn(),
      getLastCheckpointActuals: jest.fn(),
      createCheckpoint: jest.fn(),
    };
    mockProfitService = {
      getSummary: jest.fn(),
    };

    (getClosingRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new ClosingService(mockRepo, mockProfitService);
  });

  // ===========================================================================
  // recalculateDrawerBalances Tests
  // ===========================================================================

  describe("recalculateDrawerBalances", () => {
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
    const mockActivity = {
      salesCount: 25,
      totalSalesUSD: 2500,
      totalSalesLBP: 225000000,
      debtPaymentsUSD: 300,
      debtPaymentsLBP: 27000000,
      totalExpensesUSD: 150,
      totalExpensesLBP: 13500000,
    };

    it("returns default (zero) activity stats when the repository throws — profit stays hidden since includeProfit defaults false", () => {
      mockRepo.getDailyActivityStats.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getDailyStatsSnapshot({ day: "2026-09-20" });

      expect(result).toEqual({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        profitDay: "2026-09-20",
        profitHidden: true,
      });
    });

    it("handles all-zero activity stats", () => {
      const zeroActivity = {
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
      };
      mockRepo.getDailyActivityStats.mockReturnValue(zeroActivity);

      const result = service.getDailyStatsSnapshot({ day: "2026-09-20" });

      expect(result).toEqual({
        ...zeroActivity,
        profitDay: "2026-09-20",
        profitHidden: true,
      });
    });
  });

  // ===========================================================================
  // getLastCheckpointActuals Tests
  // ===========================================================================

  describe("getLastCheckpointActuals", () => {
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
