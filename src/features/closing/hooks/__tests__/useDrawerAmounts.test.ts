/** @jest-environment jsdom */

/**
 * Tests for useDrawerAmounts Hook
 */

import { renderHook, act } from "@testing-library/react";
import { useDrawerAmounts } from "../useDrawerAmounts";
import type { Currency } from "../../types";

describe("useDrawerAmounts", () => {
  const mockCurrencies: Currency[] = [
    { code: "USD", name: "US Dollar", is_active: 1 },
    { code: "LBP", name: "Lebanese Pound", is_active: 1 },
  ];

  it("should initialize with empty amounts", () => {
    const { result } = renderHook(() => useDrawerAmounts({ currencies: [] }));

    expect(result.current.amounts).toEqual({});
    expect(result.current.hasAnyAmounts).toBe(false);
  });

  it("should initialize amounts for all drawers and currencies", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    expect(result.current.amounts.General).toEqual({ USD: 0, LBP: 0 });
    expect(result.current.amounts.OMT).toEqual({ USD: 0, LBP: 0 });
    expect(result.current.amounts.MTC).toEqual({ USD: 0, LBP: 0 });
    expect(result.current.amounts.Alfa).toEqual({ USD: 0, LBP: 0 });
  });

  it("should update amount for specific drawer and currency", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", 100);
    });

    expect(result.current.amounts.General.USD).toBe(100);
    expect(result.current.amounts.General.LBP).toBe(0);
  });

  it("should return string value for zero values in getDisplayValue", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    expect(result.current.getDisplayValue("General", "USD")).toBe("0");
  });

  it("should return string value for non-zero values in getDisplayValue", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", 150.5);
    });

    expect(result.current.getDisplayValue("General", "USD")).toBe("150.5");
  });

  it("should validate all amounts successfully", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", 100);
    });

    const validation = result.current.validate();
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("should detect negative amounts in validation", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", -50);
    });

    const validation = result.current.validate();
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain("Negative amount for General - USD");
  });

  it("should detect NaN values in validation", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", NaN);
    });

    const validation = result.current.validate();
    expect(validation.isValid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it("should detect when any amounts are entered", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    expect(result.current.hasAnyAmounts).toBe(false);

    act(() => {
      result.current.updateAmount("General", "USD", 100);
    });

    expect(result.current.hasAnyAmounts).toBe(true);
  });

  it("should reset all amounts to initial state", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", 100);
      result.current.updateAmount("OMT", "LBP", 50000);
    });

    expect(result.current.hasAnyAmounts).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.amounts.General.USD).toBe(0);
    expect(result.current.amounts.OMT.LBP).toBe(0);
    expect(result.current.hasAnyAmounts).toBe(false);
  });

  it("should handle multiple currency updates", () => {
    const { result } = renderHook(() =>
      useDrawerAmounts({ currencies: mockCurrencies }),
    );

    act(() => {
      result.current.initializeAmounts();
    });

    act(() => {
      result.current.updateAmount("General", "USD", 100);
      result.current.updateAmount("General", "LBP", 150000);
      result.current.updateAmount("OMT", "USD", 50);
    });

    expect(result.current.amounts.General.USD).toBe(100);
    expect(result.current.amounts.General.LBP).toBe(150000);
    expect(result.current.amounts.OMT.USD).toBe(50);
  });

  it("should handle empty currencies array", () => {
    const { result } = renderHook(() => useDrawerAmounts({ currencies: [] }));

    act(() => {
      result.current.initializeAmounts();
    });

    expect(result.current.amounts.General).toEqual({});
    expect(result.current.validate().isValid).toBe(true);
  });
});
