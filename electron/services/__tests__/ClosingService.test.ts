/**
 * ClosingService Unit Tests
 */

import {
  ClosingService,
  getClosingService,
  resetClosingService,
  SetOpeningBalancesData,
  CreateClosingData,
  UpdateClosingData,
} from "../ClosingService";
import {
  ClosingRepository,
  SystemExpectedBalances,
  DailyStatsSnapshot,
  getClosingRepository,
} from "../../database/repositories/ClosingRepository";

// Mock the repository module
jest.mock("../../database/repositories/ClosingRepository", () => ({
  getClosingRepository: jest.fn(),
  ClosingRepository: jest.fn(),
}));

describe("ClosingService", () => {
  let service: ClosingService;
  let mockRepo: jest.Mocked<ClosingRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetClosingService();

    // Create mock repository
    mockRepo = {
      setOpeningBalances: jest.fn(),
      createDailyClosing: jest.fn(),
      updateDailyClosing: jest.fn(),
      getSystemExpectedBalances: jest.fn(),
      getDailyStatsSnapshot: jest.fn(),
    } as unknown as jest.Mocked<ClosingRepository>;

    (getClosingRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new ClosingService();
  });

  // ===========================================================================
  // setOpeningBalances Tests
  // ===========================================================================

  describe("setOpeningBalances", () => {
    it("should set opening balances successfully", () => {
      const data: SetOpeningBalancesData = {
        closing_date: "2025-01-15",
        user_id: 1,
        amounts: [
          {
            drawer_name: "General_Drawer_A",
            currency_code: "USD",
            opening_amount: 500,
          },
          {
            drawer_name: "General_Drawer_A",
            currency_code: "LBP",
            opening_amount: 45000000,
          },
          {
            drawer_name: "OMT_Drawer",
            currency_code: "USD",
            opening_amount: 200,
          },
        ],
      };
      mockRepo.setOpeningBalances.mockReturnValue({ success: true, id: 1 });

      const result = service.setOpeningBalances(data);

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.setOpeningBalances).toHaveBeenCalledWith(
        "2025-01-15",
        data.amounts,
        1,
      );
    });

    it("should use default user_id when not provided", () => {
      const data: SetOpeningBalancesData = {
        closing_date: "2025-01-15",
        amounts: [
          {
            drawer_name: "General_Drawer_B",
            currency_code: "USD",
            opening_amount: 300,
          },
        ],
      };
      mockRepo.setOpeningBalances.mockReturnValue({ success: true, id: 2 });

      service.setOpeningBalances(data);

      expect(mockRepo.setOpeningBalances).toHaveBeenCalledWith(
        "2025-01-15",
        data.amounts,
        1, // Default user_id
      );
    });

    it("should handle error from repository", () => {
      const data: SetOpeningBalancesData = {
        closing_date: "2025-01-15",
        amounts: [],
      };
      mockRepo.setOpeningBalances.mockReturnValue({
        success: false,
        error: "Invalid amounts",
      });

      const result = service.setOpeningBalances(data);

      expect(result).toEqual({ success: false, error: "Invalid amounts" });
    });
  });

  // ===========================================================================
  // createDailyClosing Tests
  // ===========================================================================

  describe("createDailyClosing", () => {
    it("should create daily closing successfully", () => {
      const data: CreateClosingData = {
        closing_date: "2025-01-15",
        user_id: 1,
        variance_notes: "All balanced",
        system_expected_usd: 1000,
        system_expected_lbp: 90000000,
        amounts: [
          {
            drawer_name: "General_Drawer_A",
            currency_code: "USD",
            physical_amount: 1000,
          },
          {
            drawer_name: "General_Drawer_A",
            currency_code: "LBP",
            physical_amount: 90000000,
          },
        ],
      };
      mockRepo.createDailyClosing.mockReturnValue({ success: true, id: 1 });

      const result = service.createDailyClosing(data);

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createDailyClosing).toHaveBeenCalledWith(
        "2025-01-15",
        data.amounts,
        1000,
        90000000,
        "All balanced",
      );
    });

    it("should use default values for optional fields", () => {
      const data: CreateClosingData = {
        closing_date: "2025-01-15",
        amounts: [
          {
            drawer_name: "General_Drawer_A",
            currency_code: "USD",
            physical_amount: 500,
          },
        ],
      };
      mockRepo.createDailyClosing.mockReturnValue({ success: true, id: 2 });

      service.createDailyClosing(data);

      expect(mockRepo.createDailyClosing).toHaveBeenCalledWith(
        "2025-01-15",
        data.amounts,
        0, // default system_expected_usd
        0, // default system_expected_lbp
        undefined, // variance_notes
      );
    });

    it("should handle error from repository", () => {
      const data: CreateClosingData = {
        closing_date: "2025-01-15",
        amounts: [],
      };
      mockRepo.createDailyClosing.mockReturnValue({
        success: false,
        error: "Closing already exists",
      });

      const result = service.createDailyClosing(data);

      expect(result).toEqual({
        success: false,
        error: "Closing already exists",
      });
    });
  });

  // ===========================================================================
  // updateDailyClosing Tests
  // ===========================================================================

  describe("updateDailyClosing", () => {
    it("should update daily closing successfully", () => {
      const data: UpdateClosingData = {
        id: 1,
        physical_usd: 1050,
        physical_lbp: 92000000,
        variance_usd: 50,
        notes: "Found extra cash",
        user_id: 1,
      };
      mockRepo.updateDailyClosing.mockReturnValue({ success: true });

      const result = service.updateDailyClosing(data);

      expect(result).toEqual({ success: true });
      expect(mockRepo.updateDailyClosing).toHaveBeenCalledWith(1, {
        physical_usd: 1050,
        physical_lbp: 92000000,
        physical_eur: undefined,
        system_expected_usd: undefined,
        system_expected_lbp: undefined,
        variance_usd: 50,
        notes: "Found extra cash",
        report_path: undefined,
        updated_by: 1,
      });
    });

    it("should update only provided fields", () => {
      const data: UpdateClosingData = {
        id: 2,
        notes: "Updated notes",
      };
      mockRepo.updateDailyClosing.mockReturnValue({ success: true });

      const result = service.updateDailyClosing(data);

      expect(result).toEqual({ success: true });
      expect(mockRepo.updateDailyClosing).toHaveBeenCalledWith(2, {
        physical_usd: undefined,
        physical_lbp: undefined,
        physical_eur: undefined,
        system_expected_usd: undefined,
        system_expected_lbp: undefined,
        variance_usd: undefined,
        notes: "Updated notes",
        report_path: undefined,
        updated_by: undefined,
      });
    });

    it("should handle update with report path", () => {
      const data: UpdateClosingData = {
        id: 3,
        report_path: "/reports/closing_2025-01-15.pdf",
      };
      mockRepo.updateDailyClosing.mockReturnValue({ success: true });

      const result = service.updateDailyClosing(data);

      expect(result).toEqual({ success: true });
    });

    it("should handle error from repository", () => {
      const data: UpdateClosingData = {
        id: 999,
        notes: "Test",
      };
      mockRepo.updateDailyClosing.mockReturnValue({
        success: false,
        error: "Not found",
      });

      const result = service.updateDailyClosing(data);

      expect(result).toEqual({ success: false, error: "Not found" });
    });
  });

  // ===========================================================================
  // getSystemExpectedBalances Tests
  // ===========================================================================

  describe("getSystemExpectedBalances", () => {
    it("should return system expected balances", () => {
      const mockBalances: SystemExpectedBalances = {
        generalDrawer: { usd: 1500, lbp: 135000000, eur: 100 },
        omtDrawer: { usd: 500, lbp: 45000000, eur: 0 },
        mtcDrawer: { usd: 200, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 150, lbp: 0, eur: 0 },
      };
      mockRepo.getSystemExpectedBalances.mockReturnValue(mockBalances);

      const result = service.getSystemExpectedBalances();

      expect(result).toEqual(mockBalances);
      expect(mockRepo.getSystemExpectedBalances).toHaveBeenCalled();
    });

    it("should return default balances on error", () => {
      mockRepo.getSystemExpectedBalances.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getSystemExpectedBalances();

      expect(result).toEqual({
        generalDrawer: { usd: 0, lbp: 0, eur: 0 },
        omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        mtcDrawer: { usd: 0, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 0, lbp: 0, eur: 0 },
      });
    });

    it("should handle zero balances", () => {
      const mockBalances: SystemExpectedBalances = {
        generalDrawer: { usd: 0, lbp: 0, eur: 0 },
        omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        mtcDrawer: { usd: 0, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 0, lbp: 0, eur: 0 },
      };
      mockRepo.getSystemExpectedBalances.mockReturnValue(mockBalances);

      const result = service.getSystemExpectedBalances();

      expect(result).toEqual(mockBalances);
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
