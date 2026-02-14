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
    drawer_name: "General_Drawer_B",
    status: "completed" as const,
    ...overrides,
  });

  describe("processSale", () => {
    it("processes sale successfully", () => {
      mockRepo.processSale.mockReturnValue({ success: true, saleId: 123 });

      const saleRequest = createSaleRequest();

      const result = service.processSale(saleRequest);

      expect(mockRepo.processSale).toHaveBeenCalledWith(saleRequest);
      expect(result).toEqual({ success: true, saleId: 123 });
    });

    it("handles repository error", () => {
      mockRepo.processSale.mockImplementation(() => {
        throw new Error("Transaction failed");
      });

      const saleRequest = createSaleRequest();

      const result = service.processSale(saleRequest);

      expect(result).toEqual({ success: false, error: "Transaction failed" });
    });

    it("returns success with sale ID", () => {
      mockRepo.processSale.mockReturnValue({ success: true, saleId: 456 });

      const saleRequest = createSaleRequest({
        final_amount: 50,
        drawer_name: "OMT_Drawer",
        status: "draft" as const,
      });

      const result = service.processSale(saleRequest);

      expect(result).toEqual({ success: true, saleId: 456 });
    });

    it("uses default drawer name when not specified", () => {
      mockRepo.processSale.mockReturnValue({ success: true, saleId: 789 });

      const saleRequest = createSaleRequest({
        final_amount: 30,
        drawer_name: undefined,
      });

      const result = service.processSale(saleRequest);

      expect(result).toEqual({ success: true, saleId: 789 });
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
    it("returns drawer balances from repository", () => {
      const mockBalances = {
        usd: 1000,
        lbp: 5000000,
        eur: 200,
      };
      mockRepo.getDrawerBalances.mockReturnValue(mockBalances as any);

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

      expect(mockRepo.getTodaysSales).toHaveBeenCalledWith(5);
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

      const result = service.getChartData("Sales");

      expect(mockRepo.getChartData).toHaveBeenCalledWith("Sales");
      expect(result).toEqual(mockChartData);
    });

    it("returns profit chart data", () => {
      const mockChartData = [
        { label: "Mon", value: 50 },
        { label: "Tue", value: 75 },
      ];
      mockRepo.getChartData.mockReturnValue(mockChartData as any);

      const result = service.getChartData("Profit");

      expect(mockRepo.getChartData).toHaveBeenCalledWith("Profit");
      expect(result).toEqual(mockChartData);
    });
  });
});
