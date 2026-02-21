/** @jest-environment jsdom */

/**
 * Tests for useCustomServices Hook
 *
 * Now uses dedicated custom_services API (getCustomServices + getCustomServicesSummary).
 */

import { renderHook, waitFor } from "@testing-library/react";
import {
  useCustomServices,
  type CustomServiceEntry,
  type CustomServiceSummary,
} from "../useCustomServices";

// ── Mocks ──
const mockGetCustomServices = jest.fn();
const mockGetCustomServicesSummary = jest.fn();

jest.mock("@liratek/ui", () => ({
  useApi: () => ({
    getCustomServices: mockGetCustomServices,
    getCustomServicesSummary: mockGetCustomServicesSummary,
  }),
}));

jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

// ── Helpers ──
function makeEntry(
  overrides: Partial<CustomServiceEntry> = {},
): CustomServiceEntry {
  return {
    id: 1,
    description: "Test service",
    cost_usd: 5,
    cost_lbp: 0,
    price_usd: 10,
    price_lbp: 0,
    profit_usd: 5,
    profit_lbp: 0,
    paid_by: "CASH",
    status: "completed",
    client_id: null,
    client_name: null,
    phone_number: null,
    note: null,
    created_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const emptySummary: CustomServiceSummary = {
  count: 0,
  totalCostUsd: 0,
  totalCostLbp: 0,
  totalPriceUsd: 0,
  totalPriceLbp: 0,
  totalProfitUsd: 0,
  totalProfitLbp: 0,
};

describe("useCustomServices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCustomServices.mockResolvedValue([]);
    mockGetCustomServicesSummary.mockResolvedValue(emptySummary);
  });

  it("should load history and summary on mount", async () => {
    const entry1 = makeEntry({
      id: 1,
      cost_usd: 5,
      price_usd: 10,
      profit_usd: 5,
    });
    const entry2 = makeEntry({
      id: 2,
      cost_usd: 8,
      price_usd: 20,
      profit_usd: 12,
    });

    mockGetCustomServices.mockResolvedValue([entry1, entry2]);
    mockGetCustomServicesSummary.mockResolvedValue({
      count: 2,
      totalCostUsd: 13,
      totalCostLbp: 0,
      totalPriceUsd: 30,
      totalPriceLbp: 0,
      totalProfitUsd: 17,
      totalProfitLbp: 0,
    });

    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.summary.count).toBe(2);
    expect(result.current.summary.totalPriceUsd).toBe(30);
    expect(result.current.summary.totalProfitUsd).toBe(17);
  });

  it("should handle API error gracefully", async () => {
    mockGetCustomServices.mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network Error");
    expect(result.current.history).toEqual([]);
  });

  it("should handle non-Error rejection", async () => {
    mockGetCustomServices.mockRejectedValue("unknown");

    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load service history");
  });

  it("reload should re-fetch data", async () => {
    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCalls = mockGetCustomServices.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    // Reload
    mockGetCustomServices.mockResolvedValue([makeEntry()]);
    mockGetCustomServicesSummary.mockResolvedValue({
      ...emptySummary,
      count: 1,
    });

    await waitFor(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1);
    });

    expect(mockGetCustomServices.mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
  });

  it("should return zero stats when data is empty", async () => {
    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary.count).toBe(0);
    expect(result.current.summary.totalPriceUsd).toBe(0);
    expect(result.current.summary.totalProfitUsd).toBe(0);
  });

  it("should handle null response from API", async () => {
    mockGetCustomServices.mockResolvedValue(null);
    mockGetCustomServicesSummary.mockResolvedValue(null);

    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.summary.count).toBe(0);
  });

  it("should include dual-currency entries", async () => {
    const entry = makeEntry({
      id: 1,
      cost_usd: 10,
      cost_lbp: 500000,
      price_usd: 15,
      price_lbp: 750000,
      profit_usd: 5,
      profit_lbp: 250000,
    });

    mockGetCustomServices.mockResolvedValue([entry]);
    mockGetCustomServicesSummary.mockResolvedValue({
      count: 1,
      totalCostUsd: 10,
      totalCostLbp: 500000,
      totalPriceUsd: 15,
      totalPriceLbp: 750000,
      totalProfitUsd: 5,
      totalProfitLbp: 250000,
    });

    const { result } = renderHook(() => useCustomServices());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.history[0].cost_lbp).toBe(500000);
    expect(result.current.summary.totalProfitLbp).toBe(250000);
  });
});
