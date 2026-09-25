/**
 * SalesService Unit Tests
 *
 * Tests all business logic in SalesService with mocked repository.
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getSalesRepository: jest.fn(),
    SalesRepository: jest.fn(),
  };
});

import {
  SalesService,
  resetSalesService,
  SalesRepository,
  type ProfitService,
} from "@liratek/core";

describe("SalesService", () => {
  let service: SalesService;
  let mockRepo: jest.Mocked<SalesRepository>;

  beforeEach(() => {
    resetSalesService();

    // Create mock repository
    mockRepo = {
      processSale: jest.fn(),
      findDrafts: jest.fn(),
      getDashboardStats: jest.fn(),
      getDrawerBalances: jest.fn(),
      getTodaysSales: jest.fn(),
      getTopProducts: jest.fn(),
      getChartData: jest.fn(),
    } as unknown as jest.Mocked<SalesRepository>;

    service = new SalesService(mockRepo);
  });

  // ===========================================================================
  // Sales Operations
  // ===========================================================================

  const createSaleRequest = (overrides = {}) => ({
    client_id: 1,
    items: [{ product_id: 1, quantity: 2, price: 10 }],
    total_amount: 20,
    discount: 0,
    final_amount: 20,
    payment_usd: 20,
    payment_lbp: 0,
    exchange_rate: 90000,
    drawer_name: "General",
    status: "completed" as const,
    ...overrides,
  });

  describe("processSale", () => {
    it("processes sale successfully", () => {
      mockRepo.processSale.mockReturnValue({ success: true, id: 123 });

      const saleRequest = createSaleRequest();

      const result = service.processSale(saleRequest, 1);

      // Third arg: SalesService derives allowOutOfStock from the
      // 'allow_out_of_stock_sales' setting (unset here → false).
      expect(mockRepo.processSale).toHaveBeenCalledWith(saleRequest, 1, {
        allowOutOfStock: false,
      });
      expect(result).toEqual({ success: true, id: 123 });
    });

    it("handles repository error", () => {
      mockRepo.processSale.mockImplementation(() => {
        throw new Error("Transaction failed");
      });

      const saleRequest = createSaleRequest();

      const result = service.processSale(saleRequest, 1);

      expect(result).toEqual({ success: false, error: "Transaction failed" });
    });

    it("returns success with sale ID", () => {
      mockRepo.processSale.mockReturnValue({ success: true, id: 456 });

      const saleRequest = createSaleRequest({
        final_amount: 50,
        drawer_name: "OMT_Drawer",
        status: "draft" as const,
      });

      const result = service.processSale(saleRequest, 1);

      expect(result).toEqual({ success: true, id: 456 });
    });

    it("uses default drawer name when not specified", () => {
      mockRepo.processSale.mockReturnValue({ success: true, id: 789 });

      const saleRequest = createSaleRequest({
        final_amount: 30,
        drawer_name: undefined,
      });

      const result = service.processSale(saleRequest, 1);

      expect(result).toEqual({ success: true, id: 789 });
    });
  });

  describe("getDrafts", () => {
    it("returns draft sales from repository", () => {
      const mockDrafts = [
        { id: 1, client_name: "John", final_amount: 100, items: [] },
        { id: 2, client_name: "Jane", final_amount: 200, items: [] },
      ];
      mockRepo.findDrafts.mockReturnValue(mockDrafts as any);

      const result = service.getDrafts();

      expect(mockRepo.findDrafts).toHaveBeenCalled();
      expect(result).toEqual(mockDrafts);
    });

    it("returns empty array on error", () => {
      mockRepo.findDrafts.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.getDrafts();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // Dashboard Statistics
  // ===========================================================================

  describe("getDashboardStats", () => {
    it("returns dashboard stats from repository", () => {
      const mockStats = {
        totalSalesUSD: 1500,
        totalSalesLBP: 1350000,
        cashCollectedUSD: 1500,
        cashCollectedLBP: 1350000,
        ordersCount: 25,
        activeClients: 10,
        lowStockCount: 3,
      };
      mockRepo.getDashboardStats.mockReturnValue(mockStats);

      const result = service.getDashboardStats();

      expect(mockRepo.getDashboardStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });

    it("returns default stats on error", () => {
      mockRepo.getDashboardStats.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.getDashboardStats();

      expect(result).toEqual({
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        cashCollectedUSD: 0,
        cashCollectedLBP: 0,
        ordersCount: 0,
        activeClients: 0,
        lowStockCount: 0,
      });
    });

    it("returns dashboard stats from repository", () => {
      const expectedStats = {
        totalSalesUSD: 500,
        totalSalesLBP: 450000,
        cashCollectedUSD: 500,
        cashCollectedLBP: 450000,
        ordersCount: 5,
        activeClients: 2,
        lowStockCount: 1,
      };
      mockRepo.getDashboardStats.mockReturnValue(expectedStats);

      const result = service.getDashboardStats();

      expect(result).toEqual(expectedStats);
    });
  });

  describe("getDrawerBalances", () => {
    it("returns accumulated drawer balances from repository", () => {
      const mockBalances = {
        generalDrawer: { usd: 5000, lbp: 4500000 },
        omtDrawer: { usd: 250, lbp: 225000 },
      };
      mockRepo.getDrawerBalances.mockReturnValue(mockBalances);

      const result = service.getDrawerBalances();

      expect(mockRepo.getDrawerBalances).toHaveBeenCalled();
      expect(result).toEqual(mockBalances);
    });
  });

  describe("getTodaysSales", () => {
    it("returns recent sales from repository", () => {
      const mockSales = [
        {
          id: 1,
          client_name: "John",
          final_amount: 50,
          created_at: "2023-01-01",
        },
      ];
      mockRepo.getTodaysSales.mockReturnValue(mockSales as any);

      const result = service.getTodaysSales();

      expect(mockRepo.getTodaysSales).toHaveBeenCalledWith(50, undefined);
      expect(result).toEqual(mockSales);
    });
  });

  describe("getTopProducts", () => {
    it("returns top products from repository", () => {
      const mockProducts = [
        { id: 1, name: "Product A", total_quantity: 100 },
        { id: 2, name: "Product B", total_quantity: 80 },
      ];
      mockRepo.getTopProducts.mockReturnValue(mockProducts as any);

      const result = service.getTopProducts();

      expect(mockRepo.getTopProducts).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockProducts);
    });
  });

  // ===========================================================================
  // Chart Data
  // ===========================================================================

  describe("getChartData", () => {
    it("returns sales chart data", () => {
      const mockChartData = [
        { label: "Mon", value: 100 },
        { label: "Tue", value: 150 },
      ];
      mockRepo.getChartData.mockReturnValue(mockChartData as any);

      // DAY-1 (rule 27): the Sales series window is resolved ONCE in
      // SalesService.getChartData (endDay ?? clientDay()) and passed through
      // to the repository, so both series share one day source. Pass an
      // explicit endDay here so the assertion doesn't depend on the
      // machine's own clock.
      const endDay = "2026-09-24";
      const result = service.getChartData("Sales", endDay);

      expect(mockRepo.getChartData).toHaveBeenCalledWith("Sales", endDay);
      expect(result).toEqual(mockChartData);
    });

    // DC-10 (OWNER_NOTES_2026-09-21.md §7.2): "Profit" no longer delegates to
    // SalesRepository.getChartData (that per-unit query was deleted). It is
    // composed HERE from ProfitService.getByDate over the rolling 30-day
    // window ending on the caller's `endDay` — the exact same gross-profit
    // figures the Profits page's By Date tab reads (rule 13/14). This test
    // replaces the pre-DC-10 "delegates to the repo" case (CHART-V2-M1):
    // that assertion now fails deterministically since the repo is never
    // called for "Profit" any more.
    it("composes profit chart data from ProfitService.getByDate over the rolling 30-day window", () => {
      const mockProfitService = {
        getByDate: jest.fn(),
      } as unknown as jest.Mocked<ProfitService>;

      // endDay = 2026-09-24 → 30-day window starts 2026-08-26 (29 days back,
      // inclusive both ends = 30 days total).
      const endDay = "2026-09-24";
      const expectedFrom = "2026-08-26";

      mockProfitService.getByDate.mockReturnValue([
        {
          date: "2026-09-24",
          revenue_usd: 500,
          revenue_lbp: 0,
          cost_usd: 300,
          cost_lbp: 0,
          profit_usd: 100,
          profit_lbp: 9_000_000,
          expenses_usd: 20,
          expenses_lbp: 0,
          net_profit_usd: 80,
          net_profit_lbp: 9_000_000,
        },
      ]);

      const scopedService = new SalesService(mockRepo, mockProfitService);

      const result = scopedService.getChartData("Profit", endDay);

      expect(mockProfitService.getByDate).toHaveBeenCalledWith(
        expectedFrom,
        endDay,
      );
      // The old per-unit query path must never fire for "Profit" (DC-10).
      expect(mockRepo.getChartData).not.toHaveBeenCalled();

      expect(result).toHaveLength(30);
      // Days with no ProfitService row zero-fill.
      expect(result[0]).toEqual({ date: expectedFrom, profit: 0, lbp: 0 });
      // The one day with a row maps profit_usd -> profit, profit_lbp -> lbp
      // (gross, before expenses — owner decision 2026-09-24).
      expect(result[result.length - 1]).toEqual({
        date: endDay,
        profit: 100,
        lbp: 9_000_000,
      });
    });
  });
});
