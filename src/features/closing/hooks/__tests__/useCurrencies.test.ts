/** @jest-environment jsdom */

/**
 * Tests for useCurrencies Hook
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useCurrencies } from "../useCurrencies";

// Mock window.api
const mockCurrenciesList = jest.fn();

describe("useCurrencies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).api = {
      currencies: {
        list: mockCurrenciesList,
      },
    };
  });

  afterEach(() => {
    // avoid leaking mocks across suites
    delete (window as any).api;
  });

  it("should initialize with loading state", () => {
    mockCurrenciesList.mockImplementation(() => new Promise(() => {})); // Never resolves
    const { result } = renderHook(() => useCurrencies());

    expect(result.current.loading).toBe(true);
    expect(result.current.currencies).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("should load currencies successfully", async () => {
    const mockCurrencies = [
      { code: "USD", name: "US Dollar", is_active: 1 },
      { code: "LBP", name: "Lebanese Pound", is_active: 1 },
      { code: "EUR", name: "Euro", is_active: 0 }, // Inactive
    ];

    mockCurrenciesList.mockResolvedValue(mockCurrencies);

    const { result } = renderHook(() => useCurrencies());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currencies).toEqual([
      { code: "USD", name: "US Dollar", is_active: 1 },
      { code: "LBP", name: "Lebanese Pound", is_active: 1 },
    ]);
    expect(result.current.error).toBeNull();
  });

  it("should filter out inactive currencies", async () => {
    const mockCurrencies = [
      { code: "USD", name: "US Dollar", is_active: 1 },
      { code: "OLD", name: "Old Currency", is_active: 0 },
    ];

    mockCurrenciesList.mockResolvedValue(mockCurrencies);

    const { result } = renderHook(() => useCurrencies());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currencies).toHaveLength(1);
    expect(result.current.currencies[0].code).toBe("USD");
  });

  it("should handle errors gracefully", async () => {
    const mockError = new Error("Failed to load currencies");
    mockCurrenciesList.mockRejectedValue(mockError);

    const { result } = renderHook(() => useCurrencies());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currencies).toEqual([]);
    expect(result.current.error).toBe("Failed to load currencies");
  });

  it("should handle non-Error objects", async () => {
    mockCurrenciesList.mockRejectedValue("String error");

    const { result } = renderHook(() => useCurrencies());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load currencies");
  });

  it("should allow reloading currencies", async () => {
    const mockCurrencies = [{ code: "USD", name: "US Dollar", is_active: 1 }];

    mockCurrenciesList.mockResolvedValue(mockCurrencies);

    const { result } = renderHook(() => useCurrencies());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Clear and reload
    mockCurrenciesList.mockClear();
    mockCurrenciesList.mockResolvedValue([
      { code: "EUR", name: "Euro", is_active: 1 },
    ]);

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.currencies[0].code).toBe("EUR");
    });

    expect(mockCurrenciesList).toHaveBeenCalledTimes(1);
  });
});
