/** @jest-environment jsdom */

/**
 * Tests for useSystemExpected Hook
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useSystemExpected } from "../useSystemExpected";

// Mock window.api
const mockGetSystemExpectedBalances = jest.fn();

describe("useSystemExpected", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).api = {
      closing: {
        getSystemExpectedBalances: mockGetSystemExpectedBalances,
      },
    };
  });

  afterEach(() => {
    delete (window as any).api;
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
      mtcDrawer: { usd: 25, lbp: 0, eur: 0 },
      alfaDrawer: { usd: 30, lbp: 0, eur: 0 },
    };

    mockGetSystemExpectedBalances.mockResolvedValue(mockBalances);

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
    mockGetSystemExpectedBalances.mockImplementation(
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
    mockGetSystemExpectedBalances.mockRejectedValue(mockError);

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
    mockGetSystemExpectedBalances.mockRejectedValue("String error");

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
      generalDrawer: { usd: 100, lbp: 150000 },
      omtDrawer: { usd: 50, lbp: 75000 },
      mtcDrawer: { usd: 25, lbp: 0 },
      alfaDrawer: { usd: 30, lbp: 0 },
    };

    mockGetSystemExpectedBalances.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    expect(result.current.getExpectedAmount("General", "USD")).toBe(100);
    expect(result.current.getExpectedAmount("OMT", "LBP")).toBe(75000);
    expect(result.current.getExpectedAmount("MTC", "USD")).toBe(25);
  });

  it("should return 0 for missing drawer", () => {
    const { result } = renderHook(() => useSystemExpected());

    expect(result.current.getExpectedAmount("General", "USD")).toBe(0);
  });

  it("should return 0 for missing currency in drawer", async () => {
    const mockBalances = {
      generalDrawer: { usd: 100 },
      omtDrawer: { usd: 50 },
      mtcDrawer: { usd: 25 },
      alfaDrawer: { usd: 30 },
    };

    mockGetSystemExpectedBalances.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    expect(result.current.getExpectedAmount("General", "EUR")).toBe(0);
  });

  it("should handle case-insensitive drawer and currency names", async () => {
    const mockBalances = {
      generalDrawer: { usd: 100, lbp: 150000 },
      omtDrawer: { usd: 50, lbp: 75000 },
      mtcDrawer: { usd: 25, lbp: 0 },
      alfaDrawer: { usd: 30, lbp: 0 },
    };

    mockGetSystemExpectedBalances.mockResolvedValue(mockBalances);

    const { result } = renderHook(() => useSystemExpected());

    await act(async () => {
      await result.current.fetchSystemExpected();
    });

    expect(result.current.getExpectedAmount("General", "USD")).toBe(100);
    expect(result.current.getExpectedAmount("general", "usd")).toBe(100);
  });
});
