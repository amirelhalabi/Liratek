/** @jest-environment jsdom */

/**
 * Tests for useSystemExpected Hook
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useSystemExpected } from "../useSystemExpected";

// Mock the API adapter returned by useApi
const mockGetSystemExpectedBalancesDynamic = jest.fn();

jest.mock("@liratek/ui", () => ({
  useApi: () => ({
    getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
  }),
}));

describe("useSystemExpected", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should initialize with null system expected", () => {
    const { result } = renderHook(() => useSystemExpected());

    expect(result.current.systemExpected).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should fetch system expected balances successfully", async () => {
    const mockBalances = {
      generalDrawer: { usd: 100, lbp: 150000, eur: 0 },
      omtDrawer: { usd: 50, lbp: 75000, eur: 0 },
      whishDrawer: { usd: 0, lbp: 0, eur: 0 },
      binanceDrawer: { usd: 0, lbp: 0, eur: 0 },
      mtcDrawer: { usd: 25, lbp: 0, eur: 0 },
      alfaDrawer: { usd: 30, lbp: 0, eur: 0 },
    };

    mockGetSystemExpectedBalancesDynamic.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.systemExpected).toEqual(mockBalances);
    expect(result.current.error).toBeNull();
  });

  it("should set loading state during fetch", async () => {
    mockGetSystemExpectedBalancesDynamic.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    const { result } = renderHook(() => useSystemExpected());

    act(() => {
      void result.current.fetchSystemExpected();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("should handle fetch errors gracefully", async () => {
    const mockError = new Error("Failed to fetch balances");
    mockGetSystemExpectedBalancesDynamic.mockRejectedValue(mockError);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.systemExpected).toBeNull();
    expect(result.current.error).toBe("Failed to fetch balances");
  });

  it("should handle non-Error objects in catch", async () => {
    mockGetSystemExpectedBalancesDynamic.mockRejectedValue("String error");

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch expected balances");
  });

  it("should get expected amount for drawer and currency", async () => {
    const mockBalances = {
      General: { USD: 100, LBP: 150000 },
      OMT_System: { USD: 50, LBP: 75000 },
      Whish: { USD: 0, LBP: 0 },
      Binance: { USD: 0, LBP: 0 },
      MTC: { USD: 25, LBP: 0 },
      Alfa: { USD: 30, LBP: 0 },
    };

    mockGetSystemExpectedBalancesDynamic.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    expect(result.current.getExpectedAmount("General", "USD")).toBe(100);
    expect(result.current.getExpectedAmount("OMT_System", "LBP")).toBe(75000);
    expect(result.current.getExpectedAmount("MTC", "USD")).toBe(25);
  });

  it("should return 0 for missing drawer", () => {
    const { result } = renderHook(() => useSystemExpected());

    expect(result.current.getExpectedAmount("General", "USD")).toBe(0);
  });

  it("should return 0 for missing currency in drawer", async () => {
    const mockBalances = {
      General: { USD: 100 },
      OMT_System: { USD: 50 },
      Whish: { USD: 0 },
      Binance: { USD: 0 },
      MTC: { USD: 25 },
      Alfa: { USD: 30 },
    };

    mockGetSystemExpectedBalancesDynamic.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    expect(result.current.getExpectedAmount("General", "EUR")).toBe(0);
  });

  it("should perform case-sensitive drawer and currency lookup", async () => {
    const mockBalances = {
      General: { USD: 100, LBP: 150000 },
      OMT_System: { USD: 50, LBP: 75000 },
      Whish: { USD: 0, LBP: 0 },
      Binance: { USD: 0, LBP: 0 },
      MTC: { USD: 25, LBP: 0 },
      Alfa: { USD: 30, LBP: 0 },
    };

    mockGetSystemExpectedBalancesDynamic.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    expect(result.current.getExpectedAmount("General", "USD")).toBe(100);
    // Case-sensitive: mismatched case returns 0
    expect(result.current.getExpectedAmount("general", "usd")).toBe(0);
  });
});
